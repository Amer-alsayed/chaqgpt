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

function clearModelModules() {
    const modules = [
        '../api/lib/model-catalog',
        '../api/lib/openrouter-models',
        '../api/lib/groq-models',
        '../api/lib/openrouter-key-pool',
        '../api/lib/groq-key-pool',
        '../api/lib/provider-key-pool',
    ];

    for (const id of modules) {
        delete require.cache[require.resolve(id)];
    }
}

test.afterEach(() => {
    restoreEnv();
    global.fetch = ORIGINAL_FETCH;
    clearModelModules();
});

test('model catalog merges providers with scoped ids and resolves legacy raw ids', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';

    global.fetch = async (url) => {
        const target = String(url || '');
        if (target.includes('openrouter.ai/api/v1/models')) {
            return new Response(JSON.stringify({
                data: [
                    {
                        id: 'shared/model',
                        name: 'Shared OpenRouter Model',
                        description: 'test model',
                        architecture: {
                            input_modalities: ['text'],
                            output_modalities: ['text'],
                        },
                        supported_parameters: ['max_tokens'],
                        pricing: {
                            prompt: '0',
                            completion: '0',
                        },
                    },
                ],
            }), { status: 200 });
        }

        if (target.includes('api.groq.com/openai/v1/models')) {
            return new Response(JSON.stringify({
                data: [
                    {
                        id: 'shared/model',
                        active: true,
                        owned_by: 'Groq',
                    },
                ],
            }), { status: 200 });
        }

        if (target.includes('api.groq.com/openai/v1/chat/completions')) {
            return new Response(JSON.stringify({
                choices: [{ message: { content: 'ok' } }],
            }), { status: 200 });
        }

        return new Response('{}', { status: 404 });
    };

    const { getModelCatalog, getModelById } = require('../api/lib/model-catalog');
    const payload = await getModelCatalog();

    assert.equal(Array.isArray(payload.models), true);
    assert.ok(payload.models.find((model) => model.id === 'openrouter::shared/model'));
    assert.ok(payload.models.find((model) => model.id === 'groq::shared/model'));
    assert.equal(payload.meta.providers.openrouter.source === 'live' || payload.meta.providers.openrouter.source === 'cache', true);
    assert.equal(payload.meta.providers.groq.source === 'live' || payload.meta.providers.groq.source === 'cache', true);

    const legacyResolved = await getModelById('shared/model');
    assert.equal(legacyResolved.provider, 'openrouter');

    const scopedResolved = await getModelById('groq::shared/model');
    assert.equal(scopedResolved.provider, 'groq');
});
