const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../api/lib/openrouter-key-pool');
const modelsLib = require('../api/lib/openrouter-models');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const REAL_GET_MODEL_BY_ID = modelsLib.getModelById;

function restoreEnv() {
    for (const key of Object.keys(process.env)) {
        delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
}

function createMockResponse() {
    return {
        statusCode: 200,
        headersSent: false,
        headers: {},
        body: null,
        chunks: [],
        ended: false,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            this.headersSent = true;
            return this;
        },
        writeHead(code, headers) {
            this.statusCode = code;
            this.headers = headers || {};
            this.headersSent = true;
        },
        write(chunk) {
            this.chunks.push(Buffer.from(chunk).toString('utf8'));
        },
        end() {
            this.ended = true;
        },
    };
}

test.afterEach(() => {
    pool.__resetForTests();
    restoreEnv();
    global.fetch = ORIGINAL_FETCH;
    modelsLib.getModelById = REAL_GET_MODEL_BY_ID;
});

test('chat handler fails over from 429 key to healthy key and streams response', async () => {
    process.env.OPENROUTER_API_KEYS_JSON = '["key-1","key-2"]';
    delete require.cache[require.resolve('../api/chat')];

    modelsLib.getModelById = async () => ({
        capabilities: { visionInput: true, fileInputPdf: true },
    });

    const calls = [];
    global.fetch = async (_url, options) => {
        const auth = String(options?.headers?.Authorization || '');
        const key = auth.replace('Bearer ', '');
        calls.push(key);

        if (key === 'key-1') {
            return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 });
        }

        return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n', { status: 200 });
    };

    const chatHandler = require('../api/chat');
    const req = {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: {
            model: 'fake-model',
            messages: [{ role: 'user', content: 'hello' }],
        },
    };
    const res = createMockResponse();
    await chatHandler(req, res);

    assert.deepEqual(calls, ['key-1', 'key-2']);
    assert.equal(res.statusCode, 200);
    assert.equal(res.ended, true);
    assert.ok(res.chunks.join('').includes('hello'));
});

test('chat handler agentic mode uses failover when search is enabled', async () => {
    process.env.OPENROUTER_API_KEYS_JSON = '["key-a","key-b"]';
    delete require.cache[require.resolve('../api/chat')];

    modelsLib.getModelById = async () => ({
        capabilities: { visionInput: true, fileInputPdf: true, toolUse: true },
    });

    const calls = [];
    global.fetch = async (_url, options) => {
        const auth = String(options?.headers?.Authorization || '');
        const key = auth.replace('Bearer ', '');
        calls.push(key);

        if (calls.length === 1) {
            return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 });
        }

        return new Response(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'Verified answer with [Source](https://example.com).' } }],
        }), { status: 200 });
    };

    const chatHandler = require('../api/chat');
    const req = {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: {
            model: 'fake-model',
            searchEnabled: true,
            messages: [{ role: 'user', content: 'latest info' }],
        },
    };
    const res = createMockResponse();
    await chatHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.ended, true);
    assert.deepEqual(calls.slice(0, 2), ['key-a', 'key-b']);
});

test('image handler fails over after upstream failure and returns image payload', async () => {
    process.env.OPENROUTER_API_KEYS_JSON = '["img-1","img-2","img-3"]';
    delete require.cache[require.resolve('../api/image')];

    modelsLib.getModelById = async () => ({
        capabilities: { imageOutput: true },
    });

    let attempt = 0;
    global.fetch = async () => {
        attempt += 1;
        if (attempt <= 2) {
            return new Response(JSON.stringify({ error: { message: 'rate limit reached' } }), { status: 429 });
        }

        return new Response(JSON.stringify({
            choices: [
                {
                    message: {
                        content: [{ type: 'text', text: 'done' }],
                        images: [{ url: 'https://example.com/image.png' }],
                    },
                },
            ],
        }), { status: 200 });
    };

    const imageHandler = require('../api/image');
    const req = {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: {
            model: 'fake-image-model',
            prompt: 'draw a skyline',
        },
    };
    const res = createMockResponse();
    await imageHandler(req, res);

    assert.equal(attempt, 3);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.images.length, 1);
    assert.equal(res.body.text, 'done');
});
