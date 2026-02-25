const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQueryPlan } = require('../lib/search/query-plan');
const { runRetrievalOrchestrator } = require('../lib/search/retrieval-orchestrator');
const { scoreAndRankCandidates } = require('../lib/search/relevance-scorer');
const { computeSearchConfidence } = require('../lib/search/confidence');
const searchModule = require('../api/search');

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
}

test.afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    restoreEnv();
});

test('query plan builds normalized variants and constraints', () => {
    const plan = buildQueryPlan('search for iphone 17 pro full specifications', { qualityMode: 'balanced' });
    assert.ok(plan.normalizedQuery.includes('iphone'));
    assert.ok(plan.hardConstraints.includes('specs'));
    assert.ok(plan.queryVariants.length >= 3);
});

test('retrieval orchestrator aggregates provider results and tracks summary', async () => {
    const plan = buildQueryPlan('latest llm leaderboard', { qualityMode: 'fast' });
    const providers = {
        ddg_html: async () => [{ title: 'A', url: 'https://example.com/a', snippet: 'llm leaderboard benchmark' }],
        ddg_lite: async () => [{ title: 'B', url: 'https://example.org/b', snippet: 'model ranking table' }],
        ddg_instant: async () => [{ title: 'C', url: 'https://example.net/c', snippet: 'benchmark scores' }],
    };
    const output = await runRetrievalOrchestrator({
        plan,
        providers,
        maxResults: 4,
        qualityMode: 'fast',
        normalizeResult: (item) => ({ ...item, domain: new URL(item.url).hostname.replace('www.', '') }),
    });

    assert.ok(output.candidates.length >= 2);
    assert.ok(output.providerSummary.ddg_html.hits >= 1);
    assert.ok(typeof output.timingMs.retrieval === 'number');
});

test('relevance scorer keeps entity-matching candidate first', () => {
    const plan = buildQueryPlan('iphone 17 pro specs');
    const scored = scoreAndRankCandidates({
        plan,
        candidates: [
            {
                title: 'iPhone 17 Pro technical specifications',
                url: 'https://apple.com/iphone-17-pro/specs',
                snippet: 'camera battery ram storage details',
                domain: 'apple.com',
                sourceAgreement: 2,
            },
            {
                title: 'MacBook Pro overview',
                url: 'https://en.wikipedia.org/wiki/MacBook_Pro',
                snippet: 'laptop line by Apple',
                domain: 'wikipedia.org',
                sourceAgreement: 1,
            },
        ],
        maxResults: 3,
    });

    assert.ok(scored.top.length >= 1);
    assert.equal(scored.top[0].domain, 'apple.com');
});

test('searchDuckDuckGoWithMeta returns v2 meta fields', async () => {
    process.env.SEARCH_PIPELINE_V2 = 'true';
    process.env.SEARCH_RERANK_ENABLED = 'false';

    global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('html.duckduckgo.com')) {
            return new Response(
                '<div class="result"><div class="result__body"><a class="result__a" href="https://example.com/source">Example Source</a><a class="result__snippet">official benchmark leaderboard results</a></div></div>',
                { status: 200 },
            );
        }
        if (u.includes('lite.duckduckgo.com')) {
            return new Response('<a href="https://example.org/reference">Example Ref</a>', { status: 200 });
        }
        if (u.includes('api.duckduckgo.com')) {
            return new Response(JSON.stringify({ RelatedTopics: [] }), { status: 200 });
        }
        if (u.includes('wikipedia.org/w/api.php')) {
            return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
        }
        if (u.includes('bing.com/search')) {
            return new Response('<rss><channel></channel></rss>', { status: 200 });
        }
        return new Response('', { status: 500 });
    };

    const payload = await searchModule.searchDuckDuckGoWithMeta('latest llm leaderboard', {
        maxResults: 3,
        qualityMode: 'balanced',
        debug: false,
    });
    const confidence = computeSearchConfidence({ ranked: payload.results, plan: buildQueryPlan('latest llm leaderboard') });

    assert.ok(Array.isArray(payload.results));
    assert.equal(payload.meta.pipelineVersion, 'v2');
    assert.ok(payload.meta.timingMs.total >= 0);
    assert.ok(payload.meta.providerSummary.ddg_html);
    assert.ok(['low', 'medium', 'high'].includes(payload.meta.confidence.level));
    assert.ok(confidence.score >= 0);
});
