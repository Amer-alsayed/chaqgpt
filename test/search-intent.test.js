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

test('product specs query profile enables device-spec trusted domains', () => {
    const profile = tools.__test.buildSearchProfile('iphone 17 pro specs');
    assert.equal(profile.intent, 'product_specs');
    assert.ok(profile.trustedDomains.includes('apple.com'));
    assert.ok(profile.domainSeedQueries.some((q) => q.includes('site:gsmarena.com')));
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

test('dedupeAndScore filters benchmark-unrelated support pages for AI benchmark intent', () => {
    const ranked = searchModule.__test.dedupeAndScore([
        {
            title: 'Google Search Help',
            url: 'https://support.google.com/websearch/answer/134479',
            snippet: 'Learn search tips and how results are ranked.',
            sourceEngine: 'ddg_html',
            domain: 'google.com',
            publishedAt: '2026-01-10',
        },
        {
            title: 'Papers With Code - Language Model Evaluation',
            url: 'https://paperswithcode.com/task/language-modelling',
            snippet: 'Leaderboard benchmark results for language models.',
            sourceEngine: 'ddg_html',
            domain: 'paperswithcode.com',
            publishedAt: '2026-01-10',
        },
    ], {
        query: 'latest ai llms leaderboard',
        recencyDays: 14,
        trustedDomains: [],
        excludeDomains: [],
    });

    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].domain, 'paperswithcode.com');
    assert.equal(ranked.some((item) => item.url.includes('support.google.com')), false);
});

test('dedupeAndScore filters unrelated product-family pages for product specs intent', () => {
    const ranked = searchModule.__test.dedupeAndScore([
        {
            title: 'iPhone 17 Pro technical specifications',
            url: 'https://www.apple.com/iphone-17-pro/specs/',
            snippet: 'Full technical specifications for iPhone 17 Pro.',
            sourceEngine: 'ddg_html',
            domain: 'apple.com',
            publishedAt: '2026-01-10',
        },
        {
            title: 'MacBook Pro',
            url: 'https://en.wikipedia.org/wiki/MacBook_Pro',
            snippet: 'Laptop line from Apple.',
            sourceEngine: 'wikipedia',
            domain: 'wikipedia.org',
            publishedAt: null,
        },
        {
            title: 'iPhone 15 Pro',
            url: 'https://en.wikipedia.org/wiki/IPhone_15_Pro',
            snippet: 'Smartphone generation with A17 Pro.',
            sourceEngine: 'wikipedia',
            domain: 'wikipedia.org',
            publishedAt: null,
        },
    ], {
        query: 'iphone 17 pro specs',
        recencyDays: 120,
        trustedDomains: [],
        excludeDomains: [],
    });

    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].domain, 'apple.com');
    assert.equal(ranked.some((item) => item.url.includes('MacBook_Pro')), false);
    assert.equal(ranked.some((item) => item.url.includes('IPhone_15_Pro')), false);
});
