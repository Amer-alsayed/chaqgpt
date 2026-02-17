const test = require('node:test');
const assert = require('node:assert/strict');

const { searchDuckDuckGo } = require('../api/search');
const { fetchUrlContent } = require('../api/fetch-url');
const executeModule = require('../api/execute');

const ORIGINAL_FETCH = global.fetch;

test.afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
});

test('searchDuckDuckGo returns scored enriched results', async () => {
    global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('html.duckduckgo.com')) {
            return new Response(
                '<div class="result"><a class="result__a" href="https://example.com/a">Example A</a><a class="result__snippet">Recent official update 2026.</a></div>',
                { status: 200 },
            );
        }
        if (u.includes('lite.duckduckgo.com')) {
            return new Response(
                '<a href="https://docs.python.org/3/">Python Docs</a>',
                { status: 200 },
            );
        }
        if (u.includes('api.duckduckgo.com')) {
            return new Response(
                JSON.stringify({
                    AbstractText: 'Duck abstract',
                    AbstractURL: 'https://en.wikipedia.org/wiki/Test',
                    Heading: 'Test',
                    RelatedTopics: [],
                }),
                { status: 200 },
            );
        }
        if (u.includes('wikipedia.org/w/api.php')) {
            return new Response(
                JSON.stringify({
                    query: { search: [{ title: 'Node.js', snippet: 'Node.js runtime', timestamp: '2025-01-01T00:00:00Z' }] },
                }),
                { status: 200 },
            );
        }
        return new Response('', { status: 500 });
    };

    const results = await searchDuckDuckGo('node runtime', { maxResults: 3, trustedDomains: ['docs.python.org'] });
    assert.ok(results.length > 0);
    assert.ok(results[0].url);
    assert.ok(typeof results[0].score === 'number');
    assert.ok(typeof results[0].trustScore === 'number');
    assert.ok(typeof results[0].freshnessScore === 'number');
    assert.ok(['high', 'medium', 'low'].includes(results[0].evidenceQuality));
    assert.ok(results[0].retrievedAt);
});

test('fetchUrlContent blocks private targets', async () => {
    await assert.rejects(
        () => fetchUrlContent('http://127.0.0.1'),
        /Private IP addresses are blocked|Local addresses are blocked/,
    );
});

test('safe execution limits reject oversized code', () => {
    const bigCode = 'x'.repeat(25_000);
    assert.throws(
        () => executeModule.__test.enforceExecutionLimits({
            language: 'python',
            code: bigCode,
            stdin: '',
            limits: { maxCodeSize: 1000 },
        }),
        /Code exceeds max allowed size/,
    );
});
