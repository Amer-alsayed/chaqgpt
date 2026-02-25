const { getConfiguredKeys } = require('../openrouter-key-pool');

const RERANK_CACHE_TTL_MS = 3 * 60 * 1000;
const rerankCache = new Map();

function parseBooleanEnv(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    return String(value).toLowerCase() === 'true';
}

function buildCacheKey(query, candidates) {
    const urls = (candidates || []).map((item) => String(item?.url || '')).join('|');
    return `${String(query || '').trim()}::${urls}`;
}

function extractJsonObject(text) {
    const raw = String(text || '');
    const direct = raw.trim();
    if (direct.startsWith('{') && direct.endsWith('}')) return direct;
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? match[0] : '';
}

function coerceOrder(order, maxIndex) {
    if (!Array.isArray(order)) return [];
    const seen = new Set();
    const normalized = [];
    for (const value of order) {
        const index = Number(value);
        if (!Number.isInteger(index)) continue;
        if (index < 0 || index > maxIndex) continue;
        if (seen.has(index)) continue;
        seen.add(index);
        normalized.push(index);
    }
    return normalized;
}

async function withTimeout(task, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await task(controller.signal);
    } finally {
        clearTimeout(timer);
    }
}

async function rerankSearchResults(options = {}) {
    const startedAt = Date.now();
    const {
        query,
        candidates = [],
        maxResults = 8,
        timeoutMs = 1200,
        qualityMode = 'balanced',
    } = options;

    const enabled = parseBooleanEnv(process.env.SEARCH_RERANK_ENABLED, false);
    if (!enabled || !Array.isArray(candidates) || candidates.length < 4) {
        return {
            results: candidates.slice(0, maxResults),
            meta: { used: false, reason: enabled ? 'insufficient_candidates' : 'disabled', timingMs: 0 },
        };
    }

    const cacheKey = buildCacheKey(query, candidates);
    const cacheHit = rerankCache.get(cacheKey);
    if (cacheHit && (Date.now() - cacheHit.cachedAt) < RERANK_CACHE_TTL_MS) {
        return {
            results: cacheHit.results.slice(0, maxResults),
            meta: { ...cacheHit.meta, cache: true, timingMs: Date.now() - startedAt },
        };
    }

    const keys = getConfiguredKeys();
    const apiKey = keys[0];
    if (!apiKey) {
        return {
            results: candidates.slice(0, maxResults),
            meta: { used: false, reason: 'no_api_key', timingMs: Date.now() - startedAt },
        };
    }

    const model = String(process.env.SEARCH_RERANK_MODEL || 'openrouter/auto').trim();
    const compactCandidates = candidates.slice(0, 12).map((item, index) => ({
        index,
        title: item.title,
        url: item.url,
        snippet: String(item.snippet || '').slice(0, 220),
        domain: item.domain,
    }));

    const system = 'You are a retrieval reranker. Output ONLY JSON object: {"order":[indices...],"confidence":0..1}.';
    const user = [
        `Query: ${String(query || '').trim()}`,
        `Quality mode: ${qualityMode}`,
        `Candidates: ${JSON.stringify(compactCandidates)}`,
        'Task: Return the best relevance ordering for this query.',
    ].join('\n');

    try {
        const response = await withTimeout((signal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'HTTP-Referer': process.env.APP_ORIGIN || 'http://localhost:3000',
                'X-Title': 'ChaqGPT Search Reranker',
            },
            body: JSON.stringify({
                model,
                temperature: 0,
                max_tokens: 220,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            }),
            signal,
        }), Math.max(300, Number(timeoutMs) || 1200));

        if (!response.ok) {
            throw new Error(`Reranker status ${response.status}`);
        }
        const payload = await response.json();
        const content = String(payload?.choices?.[0]?.message?.content || '');
        const parsedText = extractJsonObject(content);
        if (!parsedText) throw new Error('Missing reranker JSON');
        const parsed = JSON.parse(parsedText);
        const order = coerceOrder(parsed.order, compactCandidates.length - 1);
        if (order.length === 0) throw new Error('Invalid reranker order');

        const reordered = [];
        const seen = new Set();
        for (const index of order) {
            const item = compactCandidates[index];
            if (!item) continue;
            reordered.push(candidates[item.index]);
            seen.add(item.index);
        }
        for (let i = 0; i < compactCandidates.length; i++) {
            if (!seen.has(i)) reordered.push(candidates[i]);
        }

        const results = reordered.slice(0, maxResults);
        const meta = {
            used: true,
            cache: false,
            confidence: Number(parsed.confidence || 0),
            timingMs: Date.now() - startedAt,
        };
        rerankCache.set(cacheKey, { cachedAt: Date.now(), results: reordered, meta });
        if (rerankCache.size > 400) {
            const first = rerankCache.keys().next();
            if (!first.done) rerankCache.delete(first.value);
        }
        return { results, meta };
    } catch (error) {
        return {
            results: candidates.slice(0, maxResults),
            meta: {
                used: false,
                reason: String(error?.name || '').toLowerCase().includes('abort') ? 'timeout' : 'error',
                error: String(error?.message || 'rerank_failed').slice(0, 160),
                timingMs: Date.now() - startedAt,
            },
        };
    }
}

module.exports = {
    rerankSearchResults,
    __test: {
        extractJsonObject,
        coerceOrder,
    },
};
