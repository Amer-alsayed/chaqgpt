const test = require('node:test');
const assert = require('node:assert/strict');

const tools = require('../lib/tools');
const searchModule = require('../api/search');

test('benchmark query profile enables trusted benchmark domains', () => {
    const profile = tools.__test.buildSearchProfile('latest ai model benchmark leaderboard');
    assert.equal(profile.intent, 'ai_benchmark');
    assert.ok(profile.trustedDomains.includes('paperswithcode.com'));
    assert.ok(profile.seedQueries.some((q) => /leaderboard/i.test(q)));
});

test('decomposeSearchQueries expands benchmark intents with focused queries', () => {
    const queries = tools.__test.decomposeSearchQueries('latest ai model benchmarks');
    assert.ok(queries.length >= 4);
    assert.ok(queries.some((q) => /paperswithcode/i.test(q) || /leaderboard/i.test(q)));
});

test('dedupeAndScore prioritizes benchmark domains over generic news for benchmark intent', () => {
    const ranked = searchModule.__test.dedupeAndScore([
        {
            title: 'AI benchmarks leaderboard',
            url: 'https://paperswithcode.com/sota',
            snippet: 'Latest benchmark leaderboard and evaluation scores.',
            sourceEngine: 'ddg_html',
            domain: 'paperswithcode.com',
            publishedAt: '2026-01-10',
        },
        {
            title: 'General AI news',
            url: 'https://apnews.com/article/ai-news',
            snippet: 'News coverage about AI trends.',
            sourceEngine: 'ddg_html',
            domain: 'apnews.com',
            publishedAt: '2026-01-10',
        },
    ], {
        query: 'latest ai model benchmark leaderboard',
        recencyDays: 14,
        trustedDomains: [],
        excludeDomains: [],
    });

    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].domain, 'paperswithcode.com');
});
