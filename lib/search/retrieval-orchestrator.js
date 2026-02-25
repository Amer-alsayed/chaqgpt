const RETRIEVAL_CACHE_TTL_MS = 5 * 60 * 1000;
const RETRIEVAL_STALE_TTL_MS = 30 * 60 * 1000;
const retrievalCache = new Map();

const QUALITY_CONFIGS = {
    fast: {
        globalBudgetMs: 2800,
        perProviderTimeoutMs: 1200,
        variantLimit: 2,
        minCandidates: 8,
        minHighTrustHits: 2,
    },
    balanced: {
        globalBudgetMs: 4500,
        perProviderTimeoutMs: 1800,
        variantLimit: 5,
        minCandidates: 12,
        minHighTrustHits: 2,
    },
    max: {
        globalBudgetMs: 8000,
        perProviderTimeoutMs: 2600,
        variantLimit: 5,
        minCandidates: 18,
        minHighTrustHits: 3,
    },
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

function getQualityConfig(mode) {
    return QUALITY_CONFIGS[String(mode || 'balanced').toLowerCase()] || QUALITY_CONFIGS.balanced;
}

function computeCacheKey(providerName, query, locale, maxResults) {
    return `${providerName}::${String(locale || 'en-US')}::${maxResults}::${String(query || '')}`;
}

function getCachedProviderResult(key) {
    const hit = retrievalCache.get(key);
    if (!hit) return null;
    const age = Date.now() - hit.cachedAt;
    if (age <= RETRIEVAL_CACHE_TTL_MS) {
        return { fresh: true, value: hit.value };
    }
    if (age <= RETRIEVAL_STALE_TTL_MS) {
        return { fresh: false, value: hit.value };
    }
    retrievalCache.delete(key);
    return null;
}

function setCachedProviderResult(key, value) {
    retrievalCache.set(key, { cachedAt: Date.now(), value });
    if (retrievalCache.size > 1000) {
        const first = retrievalCache.keys().next();
        if (!first.done) retrievalCache.delete(first.value);
    }
}

function normalizeProviderResult(item, providerName, normalizeResult) {
    const normalized = normalizeResult({ ...item, sourceEngine: item.sourceEngine || providerName });
    return {
        ...normalized,
        sourceEngine: providerName,
        _sourceEngines: [providerName],
    };
}

function isHighTrustDomain(domain) {
    const d = String(domain || '').toLowerCase();
    return d.endsWith('.gov') || d.endsWith('.edu')
        || ['wikipedia.org', 'arxiv.org', 'nature.com', 'science.org'].includes(d);
}

function shouldSkipProvider(plan, providerName, variantIndex) {
    const constraints = new Set(plan.hardConstraints || []);

    if (variantIndex === 0) {
        return !['ddg_html', 'ddg_lite'].includes(providerName);
    }

    if (constraints.has('benchmark') && providerName === 'wikipedia') return true;
    if (constraints.has('specs') && (providerName === 'wikipedia' || providerName === 'ddg_instant')) return true;

    if (constraints.has('current')) {
        return false;
    }
    return false;
}

async function runRetrievalOrchestrator(options = {}) {
    const startedAt = Date.now();
    const {
        plan,
        providers = {},
        locale = 'en-US',
        maxResults = 8,
        qualityMode = 'balanced',
        normalizeResult = (value) => value,
    } = options;
    const config = getQualityConfig(qualityMode);
    const deadline = startedAt + config.globalBudgetMs;
    const providerNames = Object.keys(providers);

    const providerSummary = {};
    providerNames.forEach((name) => {
        providerSummary[name] = { hits: 0, failures: 0, staleHits: 0, timeouts: 0 };
    });

    const byUrl = new Map();
    let isFallback = false;
    const variants = Array.isArray(plan?.queryVariants) ? plan.queryVariants.slice(0, config.variantLimit) : [];

    for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
        if (Date.now() > deadline) {
            isFallback = true;
            break;
        }
        const variant = variants[variantIndex];
        const remainingMs = Math.max(250, deadline - Date.now());
        const perProviderTimeout = Math.min(config.perProviderTimeoutMs, remainingMs);

        const tasks = providerNames
            .filter((name) => !shouldSkipProvider(plan, name, variantIndex))
            .map(async (providerName) => {
                const searchFn = providers[providerName];
                const cacheKey = computeCacheKey(providerName, variant, locale, maxResults * 2);
                const cached = getCachedProviderResult(cacheKey);
                if (cached?.fresh) {
                    providerSummary[providerName].hits += cached.value.length;
                    return { providerName, results: cached.value, fromCache: true };
                }

                try {
                    const results = await withTimeout((signal) => searchFn({
                        query: variant,
                        locale,
                        maxResults: maxResults * 2,
                        signal,
                        timeoutMs: perProviderTimeout,
                    }), perProviderTimeout);

                    const normalized = (Array.isArray(results) ? results : [])
                        .map((item) => normalizeProviderResult(item, providerName, normalizeResult));
                    setCachedProviderResult(cacheKey, normalized);
                    providerSummary[providerName].hits += normalized.length;

                    if (cached?.value) providerSummary[providerName].staleHits += 1;
                    return { providerName, results: normalized, fromCache: false };
                } catch (error) {
                    if (cached?.value) {
                        providerSummary[providerName].staleHits += 1;
                        setImmediate(async () => {
                            try {
                                const refresh = await searchFn({
                                    query: variant,
                                    locale,
                                    maxResults: maxResults * 2,
                                    timeoutMs: perProviderTimeout,
                                });
                                const normalizedRefresh = (Array.isArray(refresh) ? refresh : [])
                                    .map((item) => normalizeProviderResult(item, providerName, normalizeResult));
                                setCachedProviderResult(cacheKey, normalizedRefresh);
                            } catch {
                                // keep stale cache
                            }
                        });
                        return { providerName, results: cached.value, fromCache: true, stale: true };
                    }
                    providerSummary[providerName].failures += 1;
                    if (String(error?.name || '').toLowerCase().includes('abort')) {
                        providerSummary[providerName].timeouts += 1;
                    }
                    return { providerName, results: [], error };
                }
            });

        const settled = await Promise.all(tasks);
        for (const item of settled) {
            for (const result of item.results || []) {
                const key = String(result.url || '').trim();
                if (!key) continue;
                const existing = byUrl.get(key);
                if (!existing) {
                    byUrl.set(key, {
                        ...result,
                        _sourceEngines: new Set(result._sourceEngines || [item.providerName]),
                    });
                    continue;
                }
                if (String(result.snippet || '').length > String(existing.snippet || '').length) {
                    existing.snippet = result.snippet;
                }
                existing._sourceEngines.add(item.providerName);
                byUrl.set(key, existing);
            }
        }

        const candidates = [...byUrl.values()];
        const highTrustHits = candidates.filter((value) => isHighTrustDomain(value.domain)).length;
        if (candidates.length >= config.minCandidates && highTrustHits >= config.minHighTrustHits) {
            break;
        }

        // Tiny pause to avoid hammering providers when running multiple variants.
        await sleep(30);
    }

    const merged = [...byUrl.values()].map((item) => ({
        ...item,
        sourceAgreement: item._sourceEngines?.size || 1,
        sourceEngines: [...(item._sourceEngines || [])],
    }));

    return {
        candidates: merged,
        providerSummary,
        timingMs: {
            retrieval: Date.now() - startedAt,
        },
        isFallback,
    };
}

module.exports = {
    runRetrievalOrchestrator,
    __test: {
        getQualityConfig,
        shouldSkipProvider,
    },
};
