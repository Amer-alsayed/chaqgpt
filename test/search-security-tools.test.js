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

test('parseDuckDuckGoLiteHTML decodes redirect links with uddg target', () => {
    const html = '<a href=\"/l/?kh=-1&uddg=https%3A%2F%2Fwhitehouse.gov%2Fadministration\">White House</a>';
    const parsed = require('../api/search').__test.parseDuckDuckGoLiteHTML(html);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].url, 'https://whitehouse.gov/administration');
});

test('searchDuckDuckGo rescue pass adds non-Wikipedia official sources for current-office queries', async () => {
    global.fetch = async (url, options = {}) => {
        const u = String(url);
        const body = decodeURIComponent(String(options?.body || ''));

        if (u.includes('html.duckduckgo.com')) {
            if (body.includes('site:whitehouse.gov')) {
                return new Response(
                    '<div class="result"><div class="result__body"><a class="result__a" href="https://www.whitehouse.gov/administration/president-bio/">The President</a><a class="result__snippet">Official White House biography and current administration details.</a></div></div>',
                    { status: 200 },
                );
            }
            return new Response(
                '<div class="result"><div class="result__body"><a class="result__a" href="https://en.wikipedia.org/wiki/President_of_the_United_States">President of the United States</a><a class="result__snippet">List of past presidents and office history.</a></div></div>',
                { status: 200 },
            );
        }

        if (u.includes('lite.duckduckgo.com')) {
            return new Response(
                '<a href="/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FPresident_of_the_United_States">President of the United States</a>',
                { status: 200 },
            );
        }

        if (u.includes('api.duckduckgo.com')) {
            return new Response(
                JSON.stringify({
                    AbstractText: 'President office overview',
                    AbstractURL: 'https://en.wikipedia.org/wiki/President_of_the_United_States',
                    Heading: 'President of the United States',
                    RelatedTopics: [],
                }),
                { status: 200 },
            );
        }

        if (u.includes('wikipedia.org/w/api.php')) {
            return new Response(
                JSON.stringify({
                    query: { search: [{ title: 'President of the United States', snippet: 'Past presidents list and history' }] },
                }),
                { status: 200 },
            );
        }

        if (u.includes('bing.com/search')) {
            return new Response('', { status: 500 });
        }

        return new Response('', { status: 500 });
    };

    const results = await searchDuckDuckGo(`who is the president of the usa reliability-${Date.now()}`, { maxResults: 4 });
    assert.ok(results.length > 0);
    assert.ok(results.some((result) => String(result.domain || '').includes('whitehouse.gov')));
});
