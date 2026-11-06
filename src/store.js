// ============================================================
//  Technamooz AI — technamooz-ai-version2.0.0
//  Author: Amir Parsa (امیر پارسا)
//  src/store.js — Cloudflare Workers KV-only storage layer
//
//  KV holds: model cache, rate limits, short sessions, connect codes,
//            key cooldowns, feature flags, health status, ephemeral logs.
//  Structured data (users, conversations, memory, personas, …) lives in src/db.js (D1).
// ============================================================

import { KV_KEYS, DEFAULT_SETTINGS } from './config.js';

/* ============================ primitives ============================ */

export function hasKV(env) {
  return !!(env && env.KV && typeof env.KV.get === 'function' && typeof env.KV.put === 'function');
}

const kvOf = (env) => env.KV;

async function kvGet(env, key, type = 'json') {
  try {
    if (!env.KV) return null;
    return await env.KV.get(key, type);
  } catch {
    return null;
  }
}

async function kvPut(env, key, value, options) {
  if (!env.KV) throw new Error('KV binding is missing');
  await env.KV.put(key, value, options);
}

async function kvDelete(env, key) {
  try {
    if (env.KV) await env.KV.delete(key);
  } catch { /* ignore */ }
}

/* ============================ rate limit ============================ */

export async function rateLimit(env, bucket, limit, windowSec) {
  if (!hasKV(env)) {
    // Fail open when KV is unavailable.
    return { ok: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
  }
  const key = KV_KEYS.rateLimit(bucket);
  const now = Date.now();
  let rec = await kvGet(env, key, 'json');
  if (!rec || typeof rec !== 'object' || !rec.ts || now - rec.ts >= windowSec * 1000) {
    rec = { n: 1, ts: now };
    try {
      await kvPut(env, key, JSON.stringify(rec), { expirationTtl: Math.max(60, windowSec) });
    } catch { /* fail open */ }
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: now + windowSec * 1000 };
  }
  if (rec.n >= limit) {
    return { ok: false, remaining: 0, resetAt: rec.ts + windowSec * 1000 };
  }
  rec.n += 1;
  try {
    await kvPut(env, key, JSON.stringify(rec), { expirationTtl: Math.max(60, windowSec) });
  } catch { /* ignore */ }
  return { ok: true, remaining: Math.max(0, limit - rec.n), resetAt: rec.ts + windowSec * 1000 };
}

/* ============================ sessions (short-lived) ============================ */

export async function kvSessionGet(env, token) {
  if (!hasKV(env)) return null;
  try { return await env.KV.get('sess:' + token, 'json'); } catch { return null; }
}

export async function kvSessionPut(env, token, record, ttlSec) {
  if (!hasKV(env)) throw new Error('KV binding is missing');
  await env.KV.put('sess:' + token, JSON.stringify(record), { expirationTtl: ttlSec });
}

export async function kvSessionDelete(env, token) {
  await kvDelete(env, 'sess:' + token);
}

/* ============================ short tokens / connect codes ============================ */

export async function kvPutShort(env, key, value, ttlSec) {
  if (!hasKV(env)) throw new Error('KV binding is missing');
  await env.KV.put(key, String(value), { expirationTtl: ttlSec });
}

export async function kvGetShort(env, key) {
  if (!hasKV(env)) return null;
  try { return await env.KV.get(key); } catch { return null; }
}

export async function kvDeleteShort(env, key) {
  await kvDelete(env, key);
}

/* ============================ model cache ============================ */

export async function kvModelCacheGet(env, platform) {
  return kvGet(env, KV_KEYS.modelCache(platform), 'json');
}

export async function kvModelCachePut(env, platform, data, ttlSec) {
  return kvPut(env, KV_KEYS.modelCache(platform), JSON.stringify(data), { expirationTtl: ttlSec });
}

export async function kvModelCacheDelete(env, platform) {
  await kvDelete(env, KV_KEYS.modelCache(platform));
}

/* ============================ settings (KV) ============================ */

export async function getSettings(env) {
  try {
    const raw = await kvGet(env, KV_KEYS.settings, 'json');
    const custom = raw || {};
    return {
      ...DEFAULT_SETTINGS,
      ...custom,
      defaultModel: {
        ...DEFAULT_SETTINGS.defaultModel,
        ...(custom.defaultModel && typeof custom.defaultModel === 'object' ? custom.defaultModel : {})
      }
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(env, patch) {
  try {
    const current = await getSettings(env);
    const next = { ...current, ...patch, defaultModel: { ...current.defaultModel, ...(patch && patch.defaultModel && typeof patch.defaultModel === 'object' ? patch.defaultModel : {}) } };
    await kvPut(env, KV_KEYS.settings, JSON.stringify(next));
    return next;
  } catch {
    return patch || {};
  }
}

/* ============================ provider credentials (KV) ============================ */

export async function getProviderKey(env, platform) {
  try {
    const raw = await kvGet(env, KV_KEYS.providerKey(platform), 'json');
    if (!raw || !raw.key) return null;
    return String(raw.key);
  } catch {
    return null;
  }
}

export async function getProviderCredentials(env, platform) {
  try {
    const raw = await kvGet(env, KV_KEYS.providerKey(platform), 'json');
    if (!raw) return { key: null, baseUrl: null };
    return { key: raw.key || null, baseUrl: raw.baseUrl || null, updatedAt: raw.updatedAt || 0 };
  } catch {
    return { key: null, baseUrl: null };
  }
}

export async function setProviderKey(env, platform, key, baseUrl) {
  try {
    const record = { key: key ? String(key).trim() : null, baseUrl: baseUrl ? String(baseUrl).trim().replace(/\/+$/, '') : null, updatedAt: Date.now() };
    await kvPut(env, KV_KEYS.providerKey(platform), JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

/* Aliases for compatibility */

export async function getProviderCreds(env, platform) {
  return getProviderCredentials(env, platform);
}

export async function setProviderCreds(env, platform, key, baseUrl) {
  return setProviderKey(env, platform, key, baseUrl);
}

export async function deleteProviderCreds(env, platform) {
  try { await kvDelete(env, KV_KEYS.providerKey(platform)); } catch { /* ignore */ }
}

export async function deleteProviderCredsKV(env, platform) {
  return deleteProviderCreds(env, platform);
}

export async function getCfAccount(env) {
  try {
    const raw = await kvGet(env, KV_KEYS.cfAccount, 'json');
    if (!raw) return null;
    return { accountId: raw.accountId || null, token: raw.token || null, updatedAt: raw.updatedAt || 0 };
  } catch {
    return null;
  }
}

export async function setCfAccount(env, accountId, token) {
  try {
    const rec = { accountId: String(accountId || '').trim(), token: token ? String(token).trim() : null, updatedAt: Date.now() };
    await kvPut(env, KV_KEYS.cfAccount, JSON.stringify(rec));
    return rec;
  } catch {
    return null;
  }
}

/* ============================ user profiles (KV — ephemeral index only) ============================ */

export function newUid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function profileKey(source, id) {
  return 'profile:' + source + ':' + id;
}

function legacyProfileKey(id) {
  return 'upref:' + id;
}

export async function getProfile(env, source, id) {
  if (!id) return null;
  const fresh = await kvGet(env, profileKey(source, id), 'json');
  if (fresh) return fresh;
  const legacy = await kvGet(env, legacyProfileKey(id), 'json');
  if (legacy) {
    const migrated = { ...legacy, source: legacy.source || source };
    try {
      await kvPut(env, profileKey(source, id), JSON.stringify(migrated));
      await kvDelete(env, legacyProfileKey(id));
    } catch { /* ignore */ }
    return migrated;
  }
  return null;
}

export async function saveProfile(env, source, id, profile) {
  await kvPut(env, profileKey(source, id), JSON.stringify(profile));
  return profile;
}

export async function ensureProfile(env, source, id, patch = {}) {
  const existing = await getProfile(env, source, id);
  if (existing) {
    existing.lastSeen = Date.now();
    Object.assign(existing, patch);
    await saveProfile(env, source, id, existing);
    return { profile: existing, isNew: false };
  }
  const profile = {
    source,
    id,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    msgs: 0,
    banned: false,
    ...patch
  };
  await saveProfile(env, source, id, profile);
  await indexPush(env, source, id);
  return { profile, isNew: true };
}

export async function deleteProfile(env, source, id) {
  await kvDelete(env, profileKey(source, id));
  await kvDelete(env, legacyProfileKey(id));
  await indexRemove(env, source, id);
}

/* ============================ user index (KV) ============================ */

const CHUNK = 200;

function indexCountKey(source) { return 'uindex:' + source + ':count'; }
function indexNKey(source) { return 'uindex:' + source + ':n'; }
function indexChunkKey(source, i) { return 'uindex:' + source + ':' + i; }

export async function indexCount(env, source) {
  const stored = Number((await kvGet(env, indexCountKey(source), 'json')) || 0);
  if (stored > 0) return stored;
  const n = Number((await kvGet(env, indexNKey(source), 'json')) || 0);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const arr = (await kvGet(env, indexChunkKey(source, i), 'json')) || [];
    total += Array.isArray(arr) ? arr.length : 0;
  }
  if (total > 0) await kvPut(env, indexCountKey(source), String(total));
  return total;
}

export async function indexList(env, source, page = 1, pageSize = 50) {
  const total = await indexCount(env, source);
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.max(1, Math.min(pages, Number(page) || 1));
  const start = (safePage - 1) * Math.max(1, pageSize);
  const end = Math.min(total, start + Math.max(1, pageSize));
  const ids = [];
  if (total === 0) return { ids, page: 1, pages: 1, total: 0, pageSize: Math.max(1, pageSize) };
  let chunk = Math.floor(start / CHUNK);
  let offset = start % CHUNK;
  while (ids.length < end - start) {
    const arr = (await kvGet(env, indexChunkKey(source, chunk), 'json')) || [];
    if (!Array.isArray(arr) || !arr.length) break;
    for (let i = offset; i < arr.length && ids.length < end - start; i++) ids.push(arr[i]);
    chunk += 1;
    offset = 0;
  }
  return { ids, page: safePage, pages, total, pageSize: Math.max(1, pageSize) };
}

export async function indexPush(env, source, id) {
  const countBefore = await indexCount(env, source);
  const n = Number((await kvGet(env, indexNKey(source), 'json')) || 0);
  let last = n - 1;
  if (last < 0) {
    await kvPut(env, indexChunkKey(source, 0), JSON.stringify([id]));
    await kvPut(env, indexNKey(source), '1');
    await kvPut(env, indexCountKey(source), String(countBefore + 1));
    return;
  }
  const key = indexChunkKey(source, last);
  const arr = (await kvGet(env, key, 'json')) || [];
  if (arr.includes(id)) return;
  if (arr.length >= CHUNK) {
    await kvPut(env, indexChunkKey(source, last + 1), JSON.stringify([id]));
    await kvPut(env, indexNKey(source), String(last + 2));
  } else {
    arr.push(id);
    await kvPut(env, key, JSON.stringify(arr));
  }
  await kvPut(env, indexCountKey(source), String(countBefore + 1));
}

export async function indexRemove(env, source, id) {
  const countBefore = await indexCount(env, source);
  const n = Number((await kvGet(env, indexNKey(source), 'json')) || 0);
  for (let i = 0; i < n; i++) {
    const key = indexChunkKey(source, i);
    const arr = (await kvGet(env, key, 'json')) || [];
    const idx = Array.isArray(arr) ? arr.indexOf(id) : -1;
    if (idx >= 0) {
      arr.splice(idx, 1);
      await kvPut(env, key, JSON.stringify(arr));
      await kvPut(env, indexCountKey(source), String(Math.max(0, countBefore - 1)));
      return true;
    }
  }
  return false;
}

/* ============================ isolated memory (KV — ephemeral) ============================ */

const MIND_DEFAULT = { v: 1, rounds: [], summary: '', facts: [], updatedAt: 0 };

function mindKey(source, id) {
  return 'mind:' + source + ':' + id;
}

export async function getMind(env, source, id) {
  const raw = (await kvGet(env, mindKey(source, id), 'json')) || null;
  if (!raw) return { ...MIND_DEFAULT, rounds: [], facts: [] };
  return {
    ...MIND_DEFAULT,
    ...raw,
    rounds: Array.isArray(raw.rounds) ? raw.rounds : [],
    facts: Array.isArray(raw.facts) ? raw.facts : [],
    summary: typeof raw.summary === 'string' ? raw.summary : ''
  };
}

export async function saveMind(env, source, id, mind) {
  mind.updatedAt = Date.now();
  await kvPut(env, mindKey(source, id), JSON.stringify(mind));
  return mind;
}

export async function wipeMind(env, source, id, mode = 'all') {
  if (mode === 'all') {
    await kvDelete(env, mindKey(source, id));
    return { ok: true, mode };
  }
  const mind = await getMind(env, source, id);
  if (mode === 'chat') mind.rounds = [];
  if (mode === 'memory') {
    mind.summary = '';
    mind.facts = [];
    mind.rounds = mind.rounds.slice(-4);
  }
  await saveMind(env, source, id, mind);
  return { ok: true, mode };
}

/* ============================ logs ============================ */

const LOG_CAP = 200;

export async function addLog(env, type, msg) {
  try {
    const arr = (await kvGet(env, KV_KEYS.logs, 'json')) || [];
    arr.unshift({
      t: Date.now(),
      type: String(type || 'info').slice(0, 24),
      msg: String(msg == null ? '' : msg).slice(0, 600)
    });
    while (arr.length > LOG_CAP) arr.pop();
    await kvPut(env, KV_KEYS.logs, JSON.stringify(arr));
  } catch { /* logging never breaks a request */ }
}

export async function getLogs(env, limit = 100) {
  const arr = (await kvGet(env, KV_KEYS.logs, 'json')) || [];
  return arr.slice(0, Math.max(1, Math.min(LOG_CAP, limit)));
}

export async function clearLogs(env) {
  await kvPut(env, KV_KEYS.logs, JSON.stringify([]));
}

export async function log(env, type, msg) {
  await addLog(env, type, msg);
}

/* ============================ stats (KV) ============================ */

export async function bumpStat(env, field, amount = 1) {
  try {
    const safe = String(field).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'events';
    const day = new Date().toISOString().slice(0, 10);
    const key = 'stats:' + day;
    const stats = (await kvGet(env, key, 'json')) || {};
    stats[safe] = (Number(stats[safe]) || 0) + amount;
    await kvPut(env, key, JSON.stringify(stats));
  } catch { /* stats are best-effort */ }
}

export async function getStats(env, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const stats = (await kvGet(env, 'stats:' + date, 'json')) || {};
    out.push({ date, ...stats });
  }
  return out;
}

/* ============================ admin credentials (KV) ============================ */

export async function getCreds(env) {
  return (await kvGet(env, KV_KEYS.creds, 'json')) || null;
}

export async function setCreds(env, creds) {
  await kvPut(env, KV_KEYS.creds, JSON.stringify(creds));
  return creds;
}

/* ============================ telegram (KV) ============================ */

const TG_DEFAULT = {
  token: null,
  username: null,
  secret: null,
  webUrl: null,
  commandsSet: false,
  updatedAt: 0
};

export async function getTgBot(env) {
  return { ...TG_DEFAULT, ...((await kvGet(env, KV_KEYS.tgBot, 'json')) || {}) };
}

export async function saveTgBot(env, patch) {
  const current = await getTgBot(env);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await kvPut(env, KV_KEYS.tgBot, JSON.stringify(next));
  return next;
}

export async function getTgAdmins(env) {
  const ids = (await kvGet(env, KV_KEYS.tgAdmins, 'json')) || [];
  return Array.isArray(ids) ? [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n !== 0))] : [];
}

export async function saveTgAdmins(env, ids) {
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isFinite(n) && n !== 0))];
  await kvPut(env, KV_KEYS.tgAdmins, JSON.stringify(clean));
  return clean;
}

/* ============================ admin sessions (KV) ============================ */

export async function createAdminSession(env, username, epoch, token, csrf, ttlSec) {
  const now = Date.now();
  await env.KV.put('sess:' + token, JSON.stringify({ u: username, e: Number(epoch || 0), csrf, c: now }), { expirationTtl: ttlSec });
  return { token, csrf };
}

export async function getAdminSession(env, token) {
  if (!hasKV(env)) return null;
  try { return await env.KV.get('sess:' + token, 'json'); } catch { return null; }
}

export async function deleteAdminSession(env, token) {
  await kvDelete(env, 'sess:' + token);
}

export async function revokeAllAdminSessions(env) {
  try {
    if (!env.KV || !env.KV.list) return;
    const listed = await env.KV.list({ prefix: 'sess:' });
    for (const k of listed.keys || []) {
      await env.KV.delete(k.name);
    }
  } catch { /* ignore */ }
}

/* ============================ picker storage (KV — telegram inline pickers) ============================ */

const PICKER_TTL_SEC = 900;

export async function kvPickerGet(env, chatId) {
  if (!hasKV(env)) return null;
  try { return await env.KV.get('tgpick:' + chatId, 'json'); } catch { return null; }
}

export async function kvPickerPut(env, chatId, snap) {
  if (!hasKV(env)) return;
  snap.t = Date.now();
  await env.KV.put('tgpick:' + chatId, JSON.stringify(snap), { expirationTtl: PICKER_TTL_SEC });
}

/* ============================ backup / restore (KV) ============================ */

export async function backupAll(env) {
  try {
    if (!env.KV || !env.KV.list) return null;
    const out = {};
    const listed = await env.KV.list();
    for (const key of listed.keys || []) {
      try { out[key.name] = await env.KV.get(key.name, 'json'); } catch { out[key.name] = await env.KV.get(key.name); }
    }
    return { exportedAt: Date.now(), version: '2.0.0', data: out };
  } catch {
    return null;
  }
}

export async function restoreAll(env, data) {
  try {
    if (!env.KV) return false;
    for (const [key, value] of Object.entries(data || {})) {
      await env.KV.put(key, JSON.stringify(value));
    }
    return true;
  } catch {
    return false;
  }
}

/* ============================ shared utilities ============================ */

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
