const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    getConfiguredGroqKeys,
    withGroqFailover,
    __resetForTests,
} = require('../api/lib/groq-key-pool');

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

test('getConfiguredGroqKeys reads GROQ_API_KEYS_JSON and deduplicates', () => {
    process.env.GROQ_API_KEYS_JSON = '["gsk-a"," gsk-b ","gsk-a"]';
    assert.deepEqual(getConfiguredGroqKeys(), ['gsk-a', 'gsk-b']);
});

test('getConfiguredGroqKeys falls back to GROQ_API_KEYS_FILE', () => {
    const tempFile = path.join(os.tmpdir(), `groq-keys-${Date.now()}.env`);
    fs.writeFileSync(tempFile, 'gsk-1\nGROQ_API_KEY=gsk-2\n["gsk-3","gsk-1"]\n', 'utf8');
    process.env.GROQ_API_KEYS_FILE = tempFile;
    delete process.env.GROQ_API_KEYS_JSON;
    delete process.env.GROQ_API_KEY;

    assert.deepEqual(getConfiguredGroqKeys(), ['gsk-1', 'gsk-2', 'gsk-3']);
    fs.unlinkSync(tempFile);
});

test('withGroqFailover retries second key when first key is rate-limited', async () => {
    process.env.GROQ_API_KEYS_JSON = '["gsk-1","gsk-2"]';
    const calls = [];

    const result = await withGroqFailover({
        requestFactory: async ({ apiKey }) => {
            calls.push(apiKey);
            if (apiKey === 'gsk-1') {
                return new Response(JSON.stringify({ error: { message: 'rate limit exceeded' } }), { status: 429 });
            }
            return new Response('ok', { status: 200 });
        },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['gsk-1', 'gsk-2']);
});
