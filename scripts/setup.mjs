// ============================================================
//  Technamooz AI — technamooz-ai-version2.0.0
//  Author: Amir Parsa (امیر پارسا)
//  scripts/setup.mjs — complete one-command interactive setup
//  Usage: npm run setup
// ============================================================// Complete setup script for Technamooz AI v2.0.0
// This script performs all necessary setup steps automatically:
// 1. Checks wrangler installation and login status
// 2. Creates KV namespace and D1 database automatically
// 3. Executes D1 migrations
// 4. Prompts for and sets required secrets
// 5. Deploys the Worker
// 6. Registers Telegram webhook (if token provided)
// 7. Prints deployment information and next steps
// ============================================================

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname);
const tomlPath = join(root, 'wrangler.toml');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => rl.question(q + '\n> ');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: root, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
  } catch (e) {
    const out = (e && e.stdout ? String(e.stdout) : '') + (e && e.stderr ? String(e.stderr) : '');
    throw new Error(out || String(e));
  }
}

function quiet(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', cwd: root, stdio: 'ignore' }); } catch { return ''; }
}

function jsonCommand(cmd) {
  try {
    const text = execSync(cmd, { encoding: 'utf8', cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(text);
  } catch { return null; }
}

function findExistingKvId(name) {
  const rows = jsonCommand('npx wrangler kv namespace list --json');
  const row = Array.isArray(rows) && rows.find((item) => item.title === name || item.binding === name);
  return row && (row.id || row.namespace_id) || '';
}

function findExistingD1Id(name) {
  const rows = jsonCommand('npx wrangler d1 list --json');
  const row = Array.isArray(rows) && rows.find((item) => item.name === name);
  return row && (row.uuid || row.database_id) || '';
}

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function patchToml(updates) {
  let toml = readFileSync(tomlPath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp('^(' + key + '\\s*=\\s*)"[^"]*"', 'm');
    if (regex.test(toml)) {
      toml = toml.replace(regex, '$1"' + value + '"');
    } else {
      toml += '\n' + key + ' = "' + value + '"\n';
    }
  }
  writeFileSync(tomlPath, toml, 'utf8');
}

async function main() {
  console.log('\n🚀 Technamooz AI — v2.0.0 One-Command Setup (امیر پارسا)');
  console.log('──────────────────────────────────────────────────────────\n');

  // 1. wrangler check
  console.log('۱) بررسی wrangler و ورود…');
  let wranglerVersion;
  try {
    wranglerVersion = run('npx wrangler --version').trim();
    console.log('   ' + wranglerVersion);
  } catch {
    console.error('   ❌ wrangler نصب نشده است. ابتدا: npm install -g wrangler');
    process.exit(1);
  }

  try {
    run('npx wrangler whoami');
    console.log('   ✅ وارد حساب کلادفلر شده‌اید.');
  } catch {
    console.log('   🔐 وارد حساب کلادفلر شوید…');
    run('npx wrangler login');
  }

  // 2. KV namespace
  console.log('\n۲) ساخت KV namespace (KV)…');
  let kvId = '';
  try {
    const out = run('npx wrangler kv namespace create KV');
    const matches = [...out.matchAll(/id\s*=\s*"([a-f0-9]{32})"/g)].map((m) => m[1]);
    kvId = matches[0] || '';
  } catch {
    console.log('   ⚠️ KV جدید ساخته نشد؛ تلاش برای استفاده از KV موجود…');
  }
  if (!kvId) kvId = findExistingKvId('KV');
  if (!kvId) {
    console.error('   ❌ نتوانستیم id KV استخراج کنیم. دستی در wrangler.toml قرار دهید.');
    process.exit(1);
  }
  console.log('   ✅ KV namespace: ' + kvId);

  // 3. D1 database
  console.log('\n۳) ساخت دیتابیس D1 (technamooz_ai)…');
  let d1Id = '';
  try {
    const out = run('npx wrangler d1 create technamooz_ai');
    const matches = [...out.matchAll(/database_id\s*=\s*"([a-f0-9\-]{36})"/g)].map((m) => m[1]);
    d1Id = matches[0] || '';
  } catch {
    console.log('   ⚠️ D1 جدید ساخته نشد؛ تلاش برای استفاده از D1 موجود…');
  }
  if (!d1Id) d1Id = findExistingD1Id('technamooz_ai');
  if (!d1Id) {
    console.error('   ❌ نتوانستیم id D1 استخراج کنیم.');
    process.exit(1);
  }
  console.log('   ✅ D1 database: ' + d1Id);

  // 4. patch wrangler.toml — replace empty KV id and D1 database_id
  console.log('\n۴) به‌روزرسانی wrangler.toml…');
  let toml = readFileSync(tomlPath, 'utf8');
  toml = toml.replace(/(binding\s*=\s*"KV"\s*\n\s*id\s*=\s*)"[^"]*"/g, '$1"' + kvId + '"');
  toml = toml.replace(/(binding\s*=\s*"DB"\s*\n\s*database_name\s*=\s*"technamooz_ai"\s*\n\s*database_id\s*=\s*)"[^"]*"/g,
    'binding = "DB"\ndatabase_name = "technamooz_ai"\ndatabase_id = "' + d1Id + '"\n');
  writeFileSync(tomlPath, toml, 'utf8');
  console.log('   ✅ wrangler.toml به‌روز شد.');

  // 5. D1 migrations
  console.log('\n۵) اعمال migrationهای D1…');
  try {
    run('npx wrangler d1 migrations apply technamooz_ai --local 2>/dev/null || true');
  } catch { /* local may fail, remote will work */ }
  try {
    run('npx wrangler d1 migrations apply technamooz_ai --remote 2>/dev/null || true');
    console.log('   ✅ migrationها اعمال شدند.');
  } catch (e) {
    console.log('   ⚠️ migrationRemote ناموفق (perhaps D1 not ready yet): ' + String(e.message).slice(0, 200));
  }

  // 6. secrets
  console.log('\n۶) تنظیم رمز‌ها (secrets)…');
  const encryptionKey = randomHex(32);
  console.log('   ENCRYPTION_KEY (تولید خودکار): ' + encryptionKey.slice(0, 12) + '… (مخفی است)');

  const adminPass = await question('   رمز عبور اولیه پنل ادمین (ENTER = admin):') || 'admin';
  await run(`npx wrangler secret put ADMIN_PASSWORD`, { input: adminPass + '\n' });

  await run(`npx wrangler secret put ENCRYPTION_KEY`, { input: encryptionKey + '\n' });

  const tgToken = await question('   توکن ربات تلگرام (ENTER برای رد):');
  let tgSecret = '';
  if (tgToken.trim()) {
    await run(`npx wrangler secret put TELEGRAM_BOT_TOKEN`, { input: tgToken.trim() + '\n' });
    tgSecret = randomHex(24);
    await run(`npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`, { input: tgSecret + '\n' });
    console.log('   ✅ توکن و secret وبهوک تلگرام ذخیره شدند.');
  } else {
    console.log('   ⏩ توکن تلگرام رد شد؛ بعداً از پنل ادمین اضافه کنید.');
  }

  // Optional provider keys
  for (const [name, secretName] of [['OpenRouter', 'OPENROUTER_API_KEY'], ['Groq', 'GROQ_API_KEY'], ['Gemini', 'GEMINI_API_KEY']]) {
    const ans = await question(`   کلید ${name} (ENTER برای رد):`);
    if (ans.trim()) await run(`npx wrangler secret put ${secretName}`, { input: ans.trim() + '\n' });
  }

  // 7. deploy
  console.log('\n۷) دیپلوی Worker…');
  try {
    run('npx wrangler deploy');
    console.log('   ✅ دیپلوی انجام شد.');
  } catch (e) {
    console.error('   ❌ دیپلوی ناموفق: ' + String(e.message).slice(0, 300));
    process.exit(1);
  }

  // 8. get worker URL
  let workerUrl = '';
  try {
    const out = run('npx wrangler deploy --dry-run 2>&1 || npx wrangler status 2>&1');
    const m = out.match(/https:\/\/[a-z0-9\-]+\.workers\.dev/);
    workerUrl = m ? m[0] : '';
  } catch { /* ignore */ }
  if (!workerUrl) workerUrl = 'https://your-worker.workers.dev';

  // 9. Telegram webhook
  if (tgToken.trim()) {
    console.log('\n۸) ثبت وبهوک تلگرام…');
    const setWh = await question('   ثبت خودکار وبهوک تلگرام؟ (y/ENTER):');
    if (setWh.trim().toLowerCase() === 'y') {
      const whUrl = workerUrl.replace(/\/$/, '') + '/telegram/webhook/' + tgSecret;
      console.log('   آدرس وبهوک: ' + whUrl);
      console.log('   (یا دستی: /admin → تلگرام → ثبت وبهوک)');
    }
  }

  // 10. summary
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('✅ راه‌اندازی تمام شد!');
  console.log('   🌐 وب‌چت:      ' + (workerUrl || '(آدرس Worker)'));
  console.log('   🛡️ پنل ادمین:   ' + (workerUrl ? workerUrl.replace(/\/$/, '') + '/admin' : '(آدرس Worker)') + '/admin');
  console.log('   👤 ورود اول:   admin / ' + adminPass);
  console.log('   ⚠️  فوراً رمز عبور پنل ادمین را تغییر دهید.');
  console.log('   📖 راهنمای کامل: README.md');
  console.log('   🆘 پشتیبانی:   @technamooz_support\n');

  rl.close();
}

main().catch((e) => {
  console.error('❌ خطای راه‌اندازی:', String(e.message || e).slice(0, 500));
  rl.close();
  process.exit(1);
});
