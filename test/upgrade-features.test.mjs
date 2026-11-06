import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, callWorker } from './helpers.mjs';
import worker from '../src/index.js';
import { recordProviderError, getLogs } from '../src/db.js';
import { testProvider } from '../src/providers.js';

test('health exposes binding and secret booleans without secret values', async () => {
  const env = createEnv();
  env.OPENROUTER_API_KEY = 'secret-value-must-not-leak';
  const result = await callWorker(worker, env, '/health');
  assert.equal(result.response.status, 200);
  assert.equal(result.data.bindings.kv, true);
  assert.equal(result.data.bindings.d1, false);
  assert.equal(result.data.secrets.OPENROUTER_API_KEY, true);
  assert.equal(JSON.stringify(result.data).includes('secret-value-must-not-leak'), false);
});

test('provider errors are structured and redacted in KV fallback logs', async () => {
  const env = createEnv();
  await recordProviderError(env, {
    requestId: 'req-test-1234', provider: 'openrouter', model: 'openrouter/free', status: 429,
    detail: 'rate limit\nBearer super-secret-token', durationMs: 42
  });
  const logs = await getLogs(env, 10);
  const item = JSON.parse(logs.find((entry) => entry.type === 'provider_error').msg);
  assert.equal(item.status, 429);
  assert.equal(item.requestId, 'req-test-1234');
  assert.equal(item.message.includes('\n'), false);
  assert.equal(item.message.includes('super-secret-token'), false);
});

test('provider JSON validation retries transient 503 once', async () => {
  const env = createEnv();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
    return new Response(JSON.stringify({ data: [{ id: 'model-after-retry' }] }), { status: 200 });
  };
  try {
    const result = await testProvider(env, 'openrouter', 'test-key');
    assert.equal(result.valid, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
