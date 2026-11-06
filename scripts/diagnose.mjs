#!/usr/bin/env node
// Technamooz AI v2.0.0 — provider diagnostics
// This Node CLI calls the same Worker adapters; it never prints API keys.
import { PLATFORMS, PLATFORM_ORDER } from '../src/config.js';
import { listModels, testProvider } from '../src/providers.js';

const json = process.argv.includes('--json');
const requested = process.argv.filter((value) => value.startsWith('--provider=')).map((value) => value.slice(11));
const env = { ...process.env };
const keyNames = {
  openrouter: 'OPENROUTER_API_KEY', orcarouter: 'ORCAROUTER_API_KEY', onerouter: 'ONEROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY',
  sambanova: 'SAMBANOVA_API_KEY', huggingface: 'HUGGINGFACE_API_KEY', github: 'GITHUB_MODELS_API_KEY',
  mistral: 'MISTRAL_API_KEY', nvidia: 'NVIDIA_API_KEY', cohere: 'COHERE_API_KEY'
};

function selectedPlatforms() {
  const ids = requested.length ? requested : PLATFORM_ORDER;
  return ids.filter((id) => PLATFORMS[id] && (
    (id === 'workersai' && (env.AI || (env.CF_ACCOUNT_ID && env.CF_API_TOKEN))) ||
    (id !== 'workersai' && env[keyNames[id]])
  ));
}

function safeMessage(value) {
  return String(value || 'بدون پیام').replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 260);
}

async function diagnose(platform) {
  const started = Date.now();
  const result = { platform, label: PLATFORMS[platform].faLabel, keyConfigured: platform === 'workersai' || !!env[keyNames[platform]], valid: false, modelCount: null, latencyMs: 0, message: '' };
  try {
    const validation = await testProvider(env, platform);
    result.valid = !!validation.valid;
    result.message = safeMessage(validation.message);
    if (result.valid) {
      try {
        const models = await listModels(env, platform, { refresh: true });
        result.modelCount = Array.isArray(models) ? models.length : 0;
      } catch (error) {
        result.modelsError = safeMessage(error && (error.detail || error.message));
      }
    }
  } catch (error) {
    result.message = safeMessage(error && (error.detail || error.message));
  }
  result.latencyMs = Date.now() - started;
  return result;
}

const results = [];
for (const platform of selectedPlatforms()) results.push(await diagnose(platform));
const output = { ok: results.every((item) => item.valid), checkedAt: new Date().toISOString(), results };
if (json) console.log(JSON.stringify(output, null, 2));
else {
  console.log('Technamooz AI provider diagnostics');
  console.log('Checked: ' + output.checkedAt);
  if (!results.length) console.log('هیچ provider دارای کلید پیدا نشد. کلیدها را به environment اضافه کنید.');
  for (const item of results) {
    const state = item.valid ? 'OK' : 'FAIL';
    console.log(`${state} ${item.platform} | ${item.latencyMs}ms | models=${item.modelCount ?? '-'} | ${item.message}`);
  }
}
process.exitCode = results.length > 0 && !output.ok ? 1 : 0;
