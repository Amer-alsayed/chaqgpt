const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getConfiguredKeys,
    pickNextKey,
    classifyFailure,
    withOpenRouterFailover,
    __resetForTests,
    __setKeyStateForTests,
} = require('../api/lib/openrouter-key-pool');

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
    for (const key of Object.keys(process.env)) {
        delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
}

test.afterEach(() => {
    __resetForTests();
    restoreEnv();
});

test('getConfiguredKeys parses JSON, trims, and deduplicates', () => {
    process.env.OPENROUTER_API_KEYS_JSON = '[" key-a ", "key-b", "key-a", ""]';
    process.env.OPENROUTER_API_KEY = 'single-fallback';
    assert.deepEqual(getConfiguredKeys(), ['key-a', 'key-b']);
});

test('getConfiguredKeys falls back to OPENROUTER_API_KEY when JSON is invalid', () => {
    process.env.OPENROUTER_API_KEYS_JSON = '{not-json}';
    process.env.OPENROUTER_API_KEY = 'single-fallback';
    assert.deepEqual(getConfiguredKeys(), ['single-fallback']);
});

test('pickNextKey rotates fairly and skips excluded keys', () => {
    const keys = ['k1', 'k2', 'k3'];
    assert.equal(pickNextKey(keys, new Set())?.apiKey, 'k1');
    assert.equal(pickNextKey(keys, new Set())?.apiKey, 'k2');
    assert.equal(pickNextKey(keys, new Set(['k3']))?.apiKey, 'k1');
});

test('pickNextKey returns earliest cooldown key if all candidates are cooling down', () => {
    const now = Date.now();
    __setKeyStateForTests('k1', { cooldownUntil: now + 10000 });
    __setKeyStateForTests('k2', { cooldownUntil: now + 2000 });
    __setKeyStateForTests('k3', { cooldownUntil: now + 5000 });
    const picked = pickNextKey(['k1', 'k2', 'k3'], new Set());
    assert.equal(picked?.apiKey, 'k2');
    assert.equal(picked?.coolingDown, true);
});

test('pickNextKey honors model-specific cooldowns without globally blocking key', () => {
    const now = Date.now();
    __setKeyStateForTests('k1', { modelCooldownUntil: { 'model-a': now + 5000 } });

    const pickedForModelA = pickNextKey(['k1', 'k2'], new Set(), 'model-a');
    const pickedForModelB = pickNextKey(['k1', 'k2'], new Set(), 'model-b');

    assert.equal(pickedForModelA?.apiKey, 'k2');
    assert.equal(pickedForModelB?.apiKey, 'k1');
});

test('classifyFailure maps rate/auth/transient categories', () => {
    assert.deepEqual(classifyFailure(429, ''), {
        retryable: true,
        category: 'rate_limit',
        cooldownMs: 15 * 60 * 1000,
    });
    assert.equal(classifyFailure(401, '').category, 'auth');
    assert.equal(classifyFailure(503, '').category, 'transient');
    assert.equal(classifyFailure(400, 'bad request').retryable, false);
    assert.equal(classifyFailure(400, 'quota exceeded').category, 'rate_limit');
});

test('withOpenRouterFailover retries on first key failure and succeeds on second key', async () => {
    process.env.OPENROUTER_API_KEYS_JSON = '["k1","k2","k3"]';
    const calls = [];

    const result = await withOpenRouterFailover({
        requestFactory: async ({ apiKey }) => {
            calls.push(apiKey);
            if (apiKey === 'k1') {
                return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 });
            }
            return new Response('ok', { status: 200 });
        },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['k1', 'k2']);
    assert.equal(result.attempts.length, 2);
});

test('withOpenRouterFailover returns last response error after exhausting keys', async () => {
    process.env.OPENROUTER_API_KEYS_JSON = '["k1","k2"]';

    const result = await withOpenRouterFailover({
        requestFactory: async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.lastFailure.type, 'response');
    assert.equal(result.lastFailure.status, 429);
    assert.equal(result.attempts.length, 2);
});

test('withOpenRouterFailover applies rate-limit cooldown per model only', async () => {
    process.env.OPENROUTER_API_KEYS_JSON = '["k1","k2"]';

    const firstRunCalls = [];
    const firstRun = await withOpenRouterFailover({
        modelId: 'model-a',
        requestFactory: async ({ apiKey }) => {
            firstRunCalls.push(apiKey);
            if (apiKey === 'k1') {
                return new Response(JSON.stringify({ error: { message: 'quota exceeded for this model' } }), { status: 429 });
            }
            return new Response('ok', { status: 200 });
        },
    });

    assert.equal(firstRun.ok, true);
    assert.deepEqual(firstRunCalls, ['k1', 'k2']);

    const secondRunCalls = [];
    const secondRun = await withOpenRouterFailover({
        modelId: 'model-b',
        maxAttempts: 1,
        requestFactory: async ({ apiKey }) => {
            secondRunCalls.push(apiKey);
            return new Response('ok', { status: 200 });
        },
    });

    assert.equal(secondRun.ok, true);
    assert.deepEqual(secondRunCalls, ['k1']);
});
