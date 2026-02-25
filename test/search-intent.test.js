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

test('current office query profile enables official domains', () => {
    const profile = tools.__test.buildSearchProfile('who is the president of the usa');
    assert.equal(profile.intent, 'current_office');
    assert.ok(profile.trustedDomains.includes('whitehouse.gov'));
    assert.ok(profile.domainSeedQueries.some((q) => q.includes('site:whitehouse.gov')));
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

test('dedupeAndScore deprioritizes historical Wikipedia pages for current-office intent', () => {
    const ranked = searchModule.__test.dedupeAndScore([
        {
            title: 'List of presidents of the United States',
            url: 'https://en.wikipedia.org/wiki/List_of_presidents_of_the_United_States',
            snippet: 'History and former presidents.',
            sourceEngine: 'wikipedia',
            domain: 'wikipedia.org',
            publishedAt: null,
        },
        {
            title: 'The White House - President',
            url: 'https://www.whitehouse.gov/administration/president-bio/',
            snippet: 'Official current administration page.',
            sourceEngine: 'ddg_html',
            domain: 'whitehouse.gov',
            publishedAt: '2026-01-20',
        },
    ], {
        query: 'who is the president of the usa',
        recencyDays: 14,
        trustedDomains: [],
        excludeDomains: [],
    });

    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].domain, 'whitehouse.gov');
});
