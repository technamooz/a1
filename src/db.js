// ============================================================
//  Technamooz AI — technamooz-ai-version2.0.0
//  Author: Amir Parsa (امیر پارسا)
//  src/db.js — D1 structured data layer (Cloudflare D1)
//
//  D1 holds: users, conversations, memory, facts, personas,
//            assistants, provider credentials, custom providers,
//            cloudflare account, telegram bot, settings, admin creds,
//            admin sessions, logs, stats, webhook connect codes.
//  KV holds: cache (models), rate limits, sessions (short tokens),
//            connect codes, cooldowns (in src/store.js).
// ============================================================

import {
  setProviderKey as kvSetProviderKey,
  getProviderKey as kvGetProviderKey,
  getProviderCredentials as kvGetProviderCredentials,
  setCfAccount as kvSetCfAccount,
  getCfAccount as kvGetCfAccount,
  getProfile as kvGetProfile,
  saveProfile as kvSaveProfile,
  ensureProfile as kvEnsureProfile,
  deleteProfile as kvDeleteProfile,
  getMind as kvGetMind,
  saveMind as kvSaveMind,
  wipeMind as kvWipeMind,
  getSettings as kvGetSettings,
  saveSettings as kvSaveSettings,
  getTgBot as kvGetTgBot,
  saveTgBot as kvSaveTgBot,
  getTgAdmins as kvGetTgAdmins,
  saveTgAdmins as kvSaveTgAdmins,
  getCreds as kvGetCreds,
  setCreds as kvSetCreds,
  indexCount as kvIndexCount,
  indexList as kvIndexList,
  indexPush as kvIndexPush,
  indexRemove as kvIndexRemove,
  addLog as kvAddLog,
  getLogs as kvGetLogs,
  clearLogs as kvClearLogs,
  getStats as kvGetStats,
  bumpStat as kvBumpStat
} from './store.js';

export function hasD1(env) {
  return !!(env && env.DB && typeof env.DB.prepare === 'function');
}

/* ============================ query helpers ============================ */

/* ============================ query helpers ============================ */

function rowFirst(result) {
  if (!result || !result.results || result.results.length === 0) return null;
  return result.results[0];
}

function rowsAll(result) {
  if (!result || !result.results) return [];
  return result.results;
}

export async function dbExec(env, sql, params = []) {
  if (!hasD1(env)) throw new Error('D1 binding DB is missing');
  const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  return stmt.run();
}

export async function dbOne(env, sql, params = []) {
  if (!hasD1(env)) return null;
  const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  return stmt.first();
}

export async function dbAll(env, sql, params = []) {
  if (!hasD1(env)) return [];
  const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  const res = await stmt.all();
  return res.results || [];
}

/* ============================ users ============================ */

export async function ensureUser(env, source, id, patch = {}) {
  if (!hasD1(env)) return kvEnsureProfile(env, source, id, patch);
  const now = Date.now();
  const existing = await dbOne(env, 'SELECT * FROM users WHERE source=? AND id=?', [source, id]);
  const defaults = {
    platform: 'workersai',
    persona: 'general',
    deep: 0,
    banned: 0,
    msgs: 0
  };
  const row = existing || {
    id, source, name: patch.name || '', username: patch.username || '',
    platform: defaults.platform, model: patch.model || null,
    persona: defaults.persona, deep: defaults.deep,
    banned: defaults.banned, msgs: defaults.msgs,
    created_at: now, last_seen: now
  };
  if (!existing) {
    await dbExec(env,
      'INSERT INTO users (id,source,name,username,platform,model,persona,deep,banned,msgs,created_at,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [row.id, row.source, row.name, row.username, row.platform, row.model, row.persona, row.deep, row.banned, row.msgs, row.created_at, now]);
  } else {
    await dbExec(env,
      'UPDATE users SET name=?, username=?, platform=?, model=?, persona=?, deep=?, banned=?, msgs=?, last_seen=? WHERE source=? AND id=?',
      [patch.name != null ? patch.name : row.name, patch.username != null ? patch.username : row.username,
       patch.platform != null ? patch.platform : row.platform,
       patch.model != null ? patch.model : row.model,
       patch.persona != null ? patch.persona : row.persona,
       patch.deep != null ? patch.deep : row.deep,
       patch.banned != null ? patch.banned : row.banned,
       patch.msgs != null ? patch.msgs : row.msgs, now, source, id]);
  }
  return { ...row, last_seen: now, ...patch };
}

export async function getUser(env, source, id) {
  if (!hasD1(env)) return kvGetProfile(env, source, id);
  return dbOne(env, 'SELECT * FROM users WHERE source=? AND id=?', [source, id]);
}

/* Aliases for compatibility with store.js profile functions */

export async function ensureProfile(env, source, id, patch = {}) {
  return ensureUser(env, source, id, patch);
}

export async function getProfile(env, source, id) {
  return getUser(env, source, id);
}

export async function saveProfile(env, source, id, profile) {
  if (!hasD1(env)) return kvSaveProfile(env, source, id, profile);
  return await ensureUser(env, source, id, profile);
}

export async function deleteProfile(env, source, id) {
  if (!hasD1(env)) return kvDeleteProfile(env, source, id);
  return deleteUser(env, source, id);
}

/* ============================ memory (D1) ============================ */

export async function getMind(env, source, id) {
  if (!hasD1(env)) return kvGetMind(env, source, id);
  const mem = await dbOne(env, 'SELECT summary FROM memory WHERE user_source=? AND user_id=?', [source, id]);
  const facts = await dbAll(env, 'SELECT fact FROM facts WHERE user_source=? AND user_id=? ORDER BY created_at DESC', [source, id]);
  const rows = await dbAll(env,
    'SELECT q, a, persona, platform, model, deep, created_at FROM conversations WHERE user_source=? AND user_id=? ORDER BY created_at DESC LIMIT 50',
    [source, id]);
  return {
    summary: (mem && mem.summary) || '',
    facts: facts.map((f) => f.fact),
    rounds: rows
  };
}

export async function saveMind(env, source, id, mind) {
  if (!hasD1(env)) return kvSaveMind(env, source, id, mind);
  const now = Date.now();
  await dbExec(env,
    'INSERT INTO memory (user_source,user_id,summary,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_source,user_id) DO UPDATE SET summary=excluded.summary,updated_at=excluded.updated_at',
    [source, id, mind.summary || '', now]);
  if (mind.facts && mind.facts.length) {
    await dbExec(env, 'DELETE FROM facts WHERE user_source=? AND user_id=?', [source, id]);
    for (const f of mind.facts) {
      await dbExec(env, 'INSERT INTO facts (user_source,user_id,fact,created_at) VALUES (?,?,?,?)', [source, id, String(f).slice(0, 300), now]);
    }
  }
  return mind;
}

export async function wipeMind(env, source, id, mode = 'all') {
  if (!hasD1(env)) return kvWipeMind(env, source, id, mode);
  if (mode === 'all') {
    await dbExec(env, 'DELETE FROM memory WHERE user_source=? AND user_id=?', [source, id]);
    await dbExec(env, 'DELETE FROM facts WHERE user_source=? AND user_id=?', [source, id]);
    await dbExec(env, 'DELETE FROM conversations WHERE user_source=? AND user_id=?', [source, id]);
    return { ok: true, mode };
  }
  if (mode === 'chat') {
    await dbExec(env, 'DELETE FROM conversations WHERE user_source=? AND user_id=?', [source, id]);
    return { ok: true, mode };
  }
  if (mode === 'memory') {
    const rows = await dbAll(env,
      'SELECT id FROM conversations WHERE user_source=? AND user_id=? ORDER BY created_at DESC LIMIT 4', [source, id]);
    const keepIds = rows.map((r) => r.id);
    if (keepIds.length) {
      const placeholders = keepIds.map(() => '?').join(',');
      await dbExec(env, `DELETE FROM conversations WHERE user_source=? AND user_id=? AND id NOT IN (${placeholders})`, [source, id, ...keepIds]);
    } else {
      await dbExec(env, 'DELETE FROM conversations WHERE user_source=? AND user_id=?', [source, id]);
    }
    await dbExec(env, 'DELETE FROM memory WHERE user_source=? AND user_id=?', [source, id]);
    await dbExec(env, 'DELETE FROM facts WHERE user_source=? AND user_id=?', [source, id]);
    return { ok: true, mode };
  }
  return { ok: true, mode };
}

export async function listUsers(env, source, page = 1, pageSize = 20) {
  if (!hasD1(env)) return { users: [], page: 1, pages: 1, total: 0 };
  const offset = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  const totalRow = await dbOne(env, 'SELECT COUNT(*) AS c FROM users WHERE source=?', [source]);
  const total = totalRow ? Number(totalRow.c) : 0;
  const rows = await dbAll(env,
    'SELECT * FROM users WHERE source=? ORDER BY last_seen DESC LIMIT ? OFFSET ?',
    [source, Math.max(1, pageSize), offset]);
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return { users: rows, page: Math.max(1, page), pages, total, pageSize: Math.max(1, pageSize) };
}

export async function setUserBanned(env, source, id, banned) {
  if (!hasD1(env)) return false;
  await dbExec(env, 'UPDATE users SET banned=? WHERE source=? AND id=?', [banned ? 1 : 0, source, id]);
  return true;
}

export async function deleteUser(env, source, id) {
  if (!hasD1(env)) return false;
  await dbExec(env, 'DELETE FROM conversations WHERE user_source=? AND user_id=?', [source, id]);
  await dbExec(env, 'DELETE FROM facts WHERE user_source=? AND user_id=?', [source, id]);
  await dbExec(env, 'DELETE FROM memory WHERE user_source=? AND user_id=?', [source, id]);
  await dbExec(env, 'DELETE FROM users WHERE source=? AND id=?', [source, id]);
  return true;
}

/* ============================ conversations ============================ */

export async function addConversation(env, source, id, data) {
  if (!hasD1(env)) return null;
  const now = Date.now();
  const res = await dbExec(env,
    'INSERT INTO conversations (user_source,user_id,q,a,persona,platform,model,deep,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [source, id, data.q, data.a, data.persona || 'general', data.platform || 'workersai', data.model || '', data.deep ? 1 : 0, now]);
  return res.meta && res.meta.last_row_id ? res.meta.last_row_id : now;
}

export async function getConversations(env, source, id, limit = 60) {
  if (!hasD1(env)) return [];
  return dbAll(env,
    'SELECT * FROM conversations WHERE user_source=? AND user_id=? ORDER BY created_at DESC LIMIT ?',
    [source, id, Math.max(1, Math.min(limit, 500))]);
}

export async function replaceLastConversation(env, source, id, data) {
  if (!hasD1(env)) return null;
  const now = Date.now();
  await dbExec(env,
    'UPDATE conversations SET q=?, a=?, persona=?, platform=?, model=?, deep=?, created_at=? WHERE user_source=? AND user_id=? ORDER BY created_at DESC LIMIT 1',
    [data.q, data.a, data.persona || 'general', data.platform || 'workersai', data.model || '', data.deep ? 1 : 0, now, source, id]);
  return now;
}

export async function clearConversations(env, source, id, mode = 'all') {
  if (!hasD1(env)) return false;
  if (mode === 'all') {
    await dbExec(env, 'DELETE FROM conversations WHERE user_source=? AND user_id=?', [source, id]);
    await dbExec(env, 'UPDATE memory SET summary=\'\', updated_at=? WHERE user_source=? AND user_id=?', [Date.now(), source, id]);
    await dbExec(env, 'DELETE FROM facts WHERE user_source=? AND user_id=?', [source, id]);
  } else if (mode === 'chat') {
    await dbExec(env, 'DELETE FROM conversations WHERE user_source=? AND user_id=?', [source, id]);
  } else if (mode === 'memory') {
    const rows = await dbAll(env,
      'SELECT id FROM conversations WHERE user_source=? AND user_id=? ORDER BY created_at DESC LIMIT 4', [source, id]);
    const keepIds = rows.map((r) => r.id);
    if (keepIds.length) {
      const placeholders = keepIds.map(() => '?').join(',');
      await dbExec(env, `DELETE FROM conversations WHERE user_source=? AND user_id=? AND id NOT IN (${placeholders})`, [source, id, ...keepIds]);
    } else {
      await dbExec(env, 'DELETE FROM conversations WHERE user_source=? AND user_id=?', [source, id]);
    }
    await dbExec(env, 'UPDATE memory SET summary=\'\', updated_at=? WHERE user_source=? AND user_id=?', [Date.now(), source, id]);
    await dbExec(env, 'DELETE FROM facts WHERE user_source=? AND user_id=?', [source, id]);
  }
  return true;
}

/* ============================ memory & facts ============================ */

export async function getMemory(env, source, id) {
  if (!hasD1(env)) return { summary: '', facts: [], rounds: [] };
  const mem = await dbOne(env, 'SELECT summary FROM memory WHERE user_source=? AND user_id=?', [source, id]);
  const facts = await dbAll(env, 'SELECT fact FROM facts WHERE user_source=? AND user_id=? ORDER BY created_at DESC', [source, id]);
  const rounds = await getConversations(env, source, id, 50);
  return {
    summary: (mem && mem.summary) || '',
    facts: facts.map((f) => f.fact),
    rounds
  };
}

export async function setMemorySummary(env, source, id, summary) {
  if (!hasD1(env)) return;
  const now = Date.now();
  await dbExec(env,
    'INSERT INTO memory (user_source,user_id,summary,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_source,user_id) DO UPDATE SET summary=excluded.summary,updated_at=excluded.updated_at',
    [source, id, summary || '', now]);
}

export async function addFacts(env, source, id, facts) {
  if (!hasD1(env) || !facts.length) return;
  const now = Date.now();
  for (const f of facts) {
    await dbExec(env, 'INSERT INTO facts (user_source,user_id,fact,created_at) VALUES (?,?,?,?)', [source, id, String(f).slice(0, 300), now]);
  }
}

export async function clearFacts(env, source, id) {
  if (!hasD1(env)) return;
  await dbExec(env, 'DELETE FROM facts WHERE user_source=? AND user_id=?', [source, id]);
}

/* ============================ personas ============================ */

export async function listPersonas(env) {
  if (!hasD1(env)) return [];
  return dbAll(env, 'SELECT * FROM personas WHERE is_enabled=1 ORDER BY id');
}

export async function getPersona(env, id) {
  if (!hasD1(env)) return null;
  return dbOne(env, 'SELECT * FROM personas WHERE id=?', [id]);
}

export async function savePersona(env, persona) {
  if (!hasD1(env)) return false;
  const now = Date.now();
  await dbExec(env,
    'INSERT INTO personas (id,name,emoji,tagline,role,temperature,system_prompt,expertise,workflow,checklist,style,recommended,is_custom,is_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,emoji=excluded.emoji,tagline=excluded.tagline,role=excluded.role,temperature=excluded.temperature,system_prompt=excluded.system_prompt,expertise=excluded.expertise,workflow=excluded.workflow,checklist=excluded.checklist,style=excluded.style,recommended=excluded.recommended,is_custom=excluded.is_custom,is_enabled=excluded.is_enabled,updated_at=excluded.updated_at',
    [persona.id, persona.name, persona.emoji || '', persona.tagline || '', persona.role || '', Number(persona.temperature || 0.7),
     persona.system_prompt || '', JSON.stringify(persona.expertise || []), JSON.stringify(persona.workflow || []),
     JSON.stringify(persona.checklist || []), persona.style || '', JSON.stringify(persona.recommended || {}),
     persona.is_custom ? 1 : 0, persona.is_enabled !== false ? 1 : 0,
     persona.created_at || now, now]);
  return true;
}

export async function deletePersona(env, id) {
  if (!hasD1(env)) return false;
  await dbExec(env, 'DELETE FROM personas WHERE id=? AND is_custom=1', [id]);
  return true;
}

/* ============================ assistants ============================ */

export async function listAssistants(env, source, id) {
  if (!hasD1(env)) return [];
  return dbAll(env, 'SELECT * FROM assistants WHERE user_source=? AND user_id=? ORDER BY updated_at DESC', [source, id]);
}

export async function saveAssistant(env, assistant) {
  if (!hasD1(env)) return false;
  const now = Date.now();
  await dbExec(env,
    'INSERT INTO assistants (id,user_source,user_id,name,avatar,instructions,model,temperature,knowledge,is_shared,share_token,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar,instructions=excluded.instructions,model=excluded.model,temperature=excluded.temperature,knowledge=excluded.knowledge,is_shared=excluded.is_shared,share_token=excluded.share_token,updated_at=excluded.updated_at',
    [assistant.id, assistant.user_source, assistant.user_id, assistant.name, assistant.avatar || '', assistant.instructions,
     assistant.model || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', Number(assistant.temperature || 0.7),
     JSON.stringify(assistant.knowledge || []), assistant.is_shared ? 1 : 0, assistant.share_token || null,
     assistant.created_at || now, now]);
  return true;
}

export async function deleteAssistant(env, id) {
  if (!hasD1(env)) return false;
  await dbExec(env, 'DELETE FROM assistants WHERE id=?', [id]);
  return true;
}

/* ============================ provider credentials ============================ */

export async function getProviderCreds(env, platform) {
  if (hasD1(env)) {
    const row = await dbOne(env, 'SELECT key_enc, base_url FROM provider_credentials WHERE platform=?', [platform]);
    if (row) return { key: row.key_enc || null, baseUrl: row.base_url || null };
    return { key: secretProviderKey(env, platform), baseUrl: null };
  }
  const stored = await kvGetProviderCredentials(env, platform);
  return stored.key ? stored : { key: secretProviderKey(env, platform), baseUrl: stored.baseUrl || null };
}

function secretProviderKey(env, platform) {
  const names = {
    openrouter: 'OPENROUTER_API_KEY', orcarouter: 'ORCAROUTER_API_KEY', onerouter: 'ONEROUTER_API_KEY',
    gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY',
    sambanova: 'SAMBANOVA_API_KEY', huggingface: 'HUGGINGFACE_API_KEY', github: 'GITHUB_MODELS_API_KEY',
    mistral: 'MISTRAL_API_KEY', nvidia: 'NVIDIA_API_KEY', cohere: 'COHERE_API_KEY'
  };
  const name = names[platform];
  return name && env && env[name] ? String(env[name]).trim() : null;
}

/* Alias: getProviderKey for compatibility */
export async function getProviderKey(env, platform) {
  const c = await getProviderCreds(env, platform);
  return c.key || null;
}

export async function setProviderCreds(env, platform, keyEnc, baseUrl) {
  if (hasD1(env)) {
    const now = Date.now();
    await dbExec(env,
      'INSERT INTO provider_credentials (platform,key_enc,base_url,updated_at) VALUES (?,?,?,?) ON CONFLICT(platform) DO UPDATE SET key_enc=excluded.key_enc,base_url=excluded.base_url,updated_at=excluded.updated_at',
      [platform, keyEnc || null, baseUrl || null, now]);
    return true;
  }
  return kvSetProviderKey(env, platform, keyEnc, baseUrl);
}

export async function deleteProviderCreds(env, platform) {
  if (hasD1(env)) {
    await dbExec(env, 'DELETE FROM provider_credentials WHERE platform=?', [platform]);
    return true;
  }
  try { await env.KV.delete('keys:provider:' + platform); } catch { /* ignore */ }
  return true;
}

/* ============================ cloudflare account ============================ */

export async function getCfAccount(env) {
  if (hasD1(env)) {
    const row = await dbOne(env, 'SELECT account_id, token_enc FROM cloudflare_account WHERE id=1');
    if (!row) return null;
    return { accountId: row.account_id || null, token: row.token_enc || null };
  }
  return kvGetCfAccount(env);
}

export async function setCfAccount(env, accountId, tokenEnc) {
  if (hasD1(env)) {
    const now = Date.now();
    await dbExec(env,
      'INSERT INTO cloudflare_account (id,account_id,token_enc,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,token_enc=excluded.token_enc,updated_at=excluded.updated_at',
      [accountId || null, tokenEnc || null, now]);
    return true;
  }
  return kvSetCfAccount(env, accountId, tokenEnc);
}

/* ============================ telegram ============================ */

export async function getTgBot(env) {
  if (!hasD1(env)) return kvGetTgBot(env);
  const row = await dbOne(env, 'SELECT token_enc, username, secret, webhook_url, commands_set, updated_at FROM telegram_bot WHERE id=1');
  if (!row) return { token: null, username: null, secret: null, webhookUrl: null, commandsSet: false, updatedAt: 0 };
  return { token: row.token_enc || null, username: row.username || null, secret: row.secret || null, webhookUrl: row.webhook_url || null, commandsSet: !!row.commands_set, updatedAt: row.updated_at || 0 };
}

export async function saveTgBot(env, patch) {
  if (!hasD1(env)) return kvSaveTgBot(env, patch);
  const now = Date.now();
  const current = await getTgBot(env);
  await dbExec(env,
    'INSERT INTO telegram_bot (id,token_enc,username,secret,webhook_url,commands_set,updated_at) VALUES (1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET token_enc=excluded.token_enc,username=excluded.username,secret=excluded.secret,webhook_url=excluded.webhook_url,commands_set=excluded.commands_set,updated_at=excluded.updated_at',
    [patch.token != null ? patch.token : current.token,
     patch.username != null ? patch.username : current.username,
     patch.secret != null ? patch.secret : current.secret,
     patch.webhookUrl != null ? patch.webhookUrl : current.webhookUrl,
     patch.commandsSet != null ? (patch.commandsSet ? 1 : 0) : (current.commandsSet ? 1 : 0), now]);
  return true;
}

export async function getTgAdmins(env) {
  if (!hasD1(env)) return kvGetTgAdmins(env);
  const rows = await dbAll(env, 'SELECT chat_id FROM telegram_admins ORDER BY chat_id');
  return rows.map((r) => Number(r.chat_id));
}

export async function saveTgAdmins(env, ids) {
  if (!hasD1(env)) return kvSaveTgAdmins(env, ids);
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isFinite(n) && n !== 0))];
  await dbExec(env, 'DELETE FROM telegram_admins');
  const now = Date.now();
  for (const cid of clean) {
    await dbExec(env, 'INSERT INTO telegram_admins (chat_id,added_at) VALUES (?,?)', [cid, now]);
  }
  return clean;
}

/* ============================ settings ============================ */

export async function getSettings(env) {
  if (!hasD1(env)) return kvGetSettings(env);
  const rows = await dbAll(env, 'SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function saveSettings(env, patch) {
  if (!hasD1(env)) return kvSaveSettings(env, patch);
  const now = Date.now();
  for (const [k, v] of Object.entries(patch)) {
    await dbExec(env,
      'INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      [k, String(v), now]);
  }
  return true;
}

/* ============================ admin ============================ */

export async function getAdminCreds(env) {
  if (!hasD1(env)) return kvGetCreds(env);
  return dbOne(env, 'SELECT * FROM admin_creds WHERE id=1');
}

export async function setAdminCreds(env, creds) {
  if (!hasD1(env)) return kvSetCreds(env, creds);
  const now = Date.now();
  await dbExec(env,
    'INSERT INTO admin_creds (id,username,salt,iter,hash,epoch,must_change,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,salt=excluded.salt,iter=excluded.iter,hash=excluded.hash,epoch=excluded.epoch,must_change=excluded.must_change,updated_at=excluded.updated_at',
    [creds.username, creds.salt, Number(creds.iter), creds.hash, Number(creds.epoch || 0), creds.mustChange ? 1 : 0, creds.createdAt || now, now]);
  return true;
}

export async function createAdminSession(env, username, epoch, token, csrf, ttlSec) {
  if (!hasD1(env)) return { token, csrf };
  const now = Date.now();
  await dbExec(env,
    'INSERT INTO admin_sessions (token,username,epoch,csrf,created_at,expires_at) VALUES (?,?,?,?,?,?)',
    [token, username, Number(epoch || 0), csrf, now, now + ttlSec * 1000]);
  return { token, csrf };
}

export async function getAdminSession(env, token) {
  if (!hasD1(env)) return null;
  const row = await dbOne(env, 'SELECT * FROM admin_sessions WHERE token=? AND expires_at>?', [token, Date.now()]);
  return row;
}

export async function deleteAdminSession(env, token) {
  if (!hasD1(env)) return;
  await dbExec(env, 'DELETE FROM admin_sessions WHERE token=?', [token]);
}

export async function revokeAllAdminSessions(env) {
  if (!hasD1(env)) return;
  await dbExec(env, 'DELETE FROM admin_sessions');
}

/* Compatibility aliases (store.js → db.js) */

export async function getCreds(env) {
  return getAdminCreds(env);
}

export async function setCreds(env, creds) {
  return setAdminCreds(env, creds);
}

export async function getProviderCredentials(env, platform) {
  const row = await dbOne(env, 'SELECT key_enc, base_url FROM provider_credentials WHERE platform=?', [platform]);
  if (!row) return { key: null, baseUrl: null };
  return { key: row.key_enc || null, baseUrl: row.base_url || null };
}

export async function setProviderKey(env, platform, key, baseUrl) {
  return setProviderCreds(env, platform, key, baseUrl);
}

export async function deleteKey(env, platform) {
  return deleteProviderCreds(env, platform);
}

/* ============================ logs ============================ */

export async function addLog(env, type, msg) {
  if (!hasD1(env)) return kvAddLog(env, type, msg);
  try {
    await dbExec(env, 'INSERT INTO logs (ts,type,msg) VALUES (?,?,?)', [Date.now(), String(type || 'info').slice(0, 24), String(msg == null ? '' : msg).slice(0, 600)]);
    await dbExec(env, 'DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY ts DESC LIMIT -1 OFFSET 200)');
  } catch { /* logging never breaks a request */ }
}

export async function getLogs(env, limit = 100) {
  if (!hasD1(env)) return kvGetLogs(env, limit);
  return dbAll(env, 'SELECT * FROM logs ORDER BY ts DESC LIMIT ?', [Math.max(1, Math.min(limit, 200))]);
}

export async function clearLogs(env) {
  if (!hasD1(env)) return kvClearLogs(env);
  await dbExec(env, 'DELETE FROM logs');
}

/* ============================ stats ============================ */

export async function bumpStat(env, field, amount = 1) {
  if (!hasD1(env)) return kvBumpStat(env, field, amount);
  const safe = String(field).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'events';
  const day = new Date().toISOString().slice(0, 10);
  await dbExec(env,
    'INSERT INTO stats (date,' + safe + ',web_msgs,tg_msgs,feedbacks,broadcasts) VALUES (?,0,0,0,0,0) ON CONFLICT(date) DO UPDATE SET ' + safe + '=' + safe + '+excluded.' + safe,
    [day, amount]);
}

export async function getStats(env, days = 7) {
  if (!hasD1(env)) return kvGetStats(env, days);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    try {
      const row = await dbOne(env, 'SELECT * FROM stats WHERE date=?', [date]);
      out.push({ date, ...(row || {}) });
    } catch {
      out.push({ date });
    }
  }
  return out;
}

export async function recordProviderError(env, error) {
  const item = {
    requestId: String(error && error.requestId || '').slice(0, 80),
    provider: String(error && error.provider || '').slice(0, 40),
    model: String(error && error.model || '').slice(0, 160),
    status: Number(error && error.status) || 0,
    code: String(error && error.code || '').slice(0, 60),
    message: redactProviderMessage(String(error && (error.detail || error.message) || 'provider error')).replace(/[\r\n]+/g, ' ').slice(0, 500),
    durationMs: Math.max(0, Number(error && error.durationMs) || 0),
    createdAt: Date.now()
  };
  if (!hasD1(env)) {
    await kvAddLog(env, 'provider_error', JSON.stringify(item));
    return item;
  }
  try {
    await dbExec(env,
      'INSERT INTO error_logs (request_id,provider,model,status,code,message,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [item.requestId || 'unknown', item.provider || null, item.model || null, item.status, item.code || null, item.message, item.durationMs, item.createdAt]
    );
    await dbExec(env, 'DELETE FROM error_logs WHERE id IN (SELECT id FROM error_logs ORDER BY created_at DESC LIMIT -1 OFFSET 500)');
  } catch {
    await kvAddLog(env, 'provider_error', JSON.stringify(item));
  }
  return item;
}

function redactProviderMessage(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(?:sk-or-|sk-|gsk_|AIza|hf_|xai-)[A-Za-z0-9._-]+/g, '[redacted]');
}

export async function getProviderErrors(env, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  if (!hasD1(env)) {
    const logs = await kvGetLogs(env, safeLimit * 2);
    return logs.filter((entry) => entry.type === 'provider_error').slice(0, safeLimit).map((entry) => {
      try { return JSON.parse(entry.msg); } catch { return { message: String(entry.msg || ''), createdAt: entry.t }; }
    });
  }
  try {
    return await dbAll(env, 'SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?', [safeLimit]);
  } catch {
    return [];
  }
}

/* ============================ user index (D1) ============================ */

export async function indexPush(env, source, id) {
  if (!hasD1(env)) return kvIndexPush(env, source, id);
  await ensureUser(env, source, id);
}

export async function indexCount(env, source) {
  if (!hasD1(env)) return kvIndexCount(env, source);
  const row = await dbOne(env, 'SELECT COUNT(*) AS c FROM users WHERE source=?', [source]);
  return row ? Number(row.c) : 0;
}

export async function indexList(env, source, page = 1, pageSize = 50) {
  if (!hasD1(env)) return kvIndexList(env, source, page, pageSize);
  const offset = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  const rows = await dbAll(env,
    'SELECT id FROM users WHERE source=? ORDER BY last_seen DESC LIMIT ? OFFSET ?',
    [source, Math.max(1, pageSize), offset]);
  const total = await indexCount(env, source);
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return {
    ids: rows.map((r) => r.id),
    page: Math.max(1, page),
    pages,
    total,
    pageSize: Math.max(1, pageSize)
  };
}

export async function indexRemove(env, source, id) {
  if (!hasD1(env)) return kvIndexRemove(env, source, id);
  await deleteUser(env, source, id);
  return true;
}

/* ============================ backup / restore (D1) ============================ */

export async function backupAll(env) {
  if (!hasD1(env)) return null;
  const out = {};
  for (const table of ['users','conversations','memory','facts','personas','assistants','provider_credentials','custom_providers','cloudflare_account','telegram_bot','telegram_admins','settings','admin_creds','admin_sessions','logs','stats','error_logs']) {
    try { out[table] = await dbAll(env, 'SELECT * FROM ' + table); } catch { out[table] = []; }
  }
  return { exportedAt: Date.now(), version: '2.0.0', data: out };
}

export async function restoreAll(env, data) {
  if (!hasD1(env)) return false;
  for (const table of Object.keys(data || {})) {
    await dbExec(env, 'DELETE FROM ' + table);
    for (const row of data[table]) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => row[c]);
      await dbExec(env, 'INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')', vals);
    }
  }
  return true;
}

/* ============================ health ============================ */

export async function healthCheck(env) {
  const kv = !!env.KV;
  const d1 = hasD1(env);
  const ai = !!env.AI;
  let d1Ok = false;
  if (d1) {
    try { await dbOne(env, 'SELECT 1 AS ok'); d1Ok = true; } catch { d1Ok = false; }
  }
  let kvOk = false;
  if (kv) {
    try { await env.KV.get('__health__'); kvOk = true; } catch { kvOk = false; }
  }
  return { kv: kvOk, d1: d1Ok, ai };
}

/* Shared utilities (re-exported for convenience) */

export function jsonResp(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

export function htmlResp(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function maskKey(key) {
  if (!key) return null;
  const s = String(key);
  if (s.length <= 10) return '••••••';
  return s.slice(0, 7) + '…' + s.slice(-4);
}

export function safeInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
