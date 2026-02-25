const test = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function restoreEnv() {
    for (const key of Object.keys(process.env)) {
        delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
}

function clearGroqModules() {
    const modules = [
        '../lib/groq-models',
        '../lib/groq-key-pool',
        '../lib/provider-key-pool',
    ];
    for (const id of modules) {
        delete require.cache[require.resolve(id)];
    }
}

test.afterEach(() => {
    restoreEnv();
    global.fetch = ORIGINAL_FETCH;
    clearGroqModules();
});

test('getGroqModels returns only active chat-usable models from probing', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';

    global.fetch = async (url, options = {}) => {
        const target = String(url || '');
        if (target.includes('/models')) {
            return new Response(JSON.stringify({
                data: [
                    { id: 'usable-model', active: true, owned_by: 'Groq' },
                    { id: 'unsupported-model', active: true, owned_by: 'Groq' },
                    { id: 'inactive-model', active: false, owned_by: 'Groq' },
                ],
            }), { status: 200 });
        }

        if (target.includes('/chat/completions')) {
            const body = JSON.parse(String(options.body || '{}'));
            if (body.model === 'unsupported-model') {
                return new Response(JSON.stringify({
                    error: { message: 'The model `unsupported-model` does not support chat completions' },
                }), { status: 400 });
            }
            return new Response(JSON.stringify({
                choices: [{ message: { content: 'ok' } }],
            }), { status: 200 });
        }

        return new Response('{}', { status: 404 });
    };

    const { getGroqModels } = require('../lib/groq-models');
    const payload = await getGroqModels();

    assert.equal(payload.models.length, 1);
    assert.equal(payload.models[0].id, 'usable-model');
    assert.equal(payload.models[0].capabilities.textChat, true);
});
