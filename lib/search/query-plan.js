const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const planCache = new Map();

const NOISE_TOKENS = new Set([
    'search', 'find', 'look', 'latest', 'current', 'today', 'new', 'make', 'build',
    'create', 'show', 'tell', 'give', 'please', 'help', 'how', 'what', 'when',
    'where', 'who', 'which', 'would', 'could', 'should', 'about', 'with', 'without',
    'for', 'from', 'into', 'onto', 'near', 'over', 'under',
    'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on', 'at', 'by', 'and', 'or',
]);

const HARD_CONSTRAINT_PATTERNS = [
    { key: 'specs', re: /\b(spec|specs|specification|specifications|technical|camera|battery|ram|storage|chip|soc|display|dimensions)\b/i },
    { key: 'benchmark', re: /\b(benchmark|leaderboard|ranking|mmlu|gpqa|livebench|arena|swe-bench|eval|evaluation)\b/i },
    { key: 'current', re: /\b(latest|current|today|recent|incumbent|who is)\b/i },
    { key: 'docs', re: /\b(api|documentation|docs|reference|manual)\b/i },
    { key: 'compare', re: /\b(compare|comparison|vs|versus|difference)\b/i },
    { key: 'coding', re: /\b(code|coding|programming|developer)\b/i },
];

const OPTIONAL_CONSTRAINT_PATTERNS = [
    { key: 'price', re: /\b(price|pricing|cost|cheap|expensive)\b/i },
    { key: 'release', re: /\b(release|version|roadmap|launch)\b/i },
    { key: 'security', re: /\b(security|vulnerability|cve|safe|safety)\b/i },
    { key: 'performance', re: /\b(performance|latency|speed|throughput|fps)\b/i },
];

const SOURCE_HINT_BY_CONSTRAINT = {
    specs: 'official technical specifications',
    benchmark: 'official benchmark leaderboard',
    current: 'official latest source',
    docs: 'official documentation reference',
    compare: 'comparison review official source',
    coding: 'developer documentation benchmark',
};

function cleanWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function sanitizeQuery(query) {
    let q = cleanWhitespace(query);
    q = q
        .replace(/^(show me|tell me|can you|could you|please|i need|i want|search for|look up|find out)\s+/i, '')
        .replace(/[?]+$/g, '')
        .trim();
    return q.slice(0, 220);
}

function extractTokens(text) {
    return String(text || '')
        .toLowerCase()
        .split(/\W+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !NOISE_TOKENS.has(token));
}

function extractVersionTokens(tokens) {
    return tokens.filter((token) => /^\d+(?:\.\d+)?$/.test(token));
}

function extractNegativeTerms(query) {
    const matches = [...String(query || '').matchAll(/\b(?:without|except|excluding|not)\s+([a-z0-9-]+)/gi)];
    return [...new Set(matches.map((m) => String(m[1] || '').toLowerCase()).filter(Boolean))];
}

function collectConstraints(query, patterns) {
    const found = [];
    for (const item of patterns) {
        if (item.re.test(query)) found.push(item.key);
    }
    return found;
}

function dedupe(values) {
    return [...new Set(values.map((value) => cleanWhitespace(value)).filter(Boolean))];
}

function variantLimitForMode(qualityMode) {
    if (qualityMode === 'fast') return 3;
    if (qualityMode === 'max') return 5;
    return 5;
}

function buildVariants(plan, qualityMode) {
    const year = new Date().getFullYear();
    const entityPhrase = plan.entities.join(' ').trim() || plan.normalizedQuery;
    const primaryConstraint = plan.hardConstraints[0] || 'default';
    const constraintSet = new Set(plan.hardConstraints || []);
    const sourceHint = SOURCE_HINT_BY_CONSTRAINT[primaryConstraint] || 'official source';
    const variants = [
        plan.normalizedQuery,
        cleanWhitespace(`${entityPhrase} ${plan.hardConstraints.join(' ')}`),
        cleanWhitespace(`${entityPhrase} ${sourceHint}`),
    ];

    if (plan.freshnessSensitive) {
        variants.push(cleanWhitespace(`${entityPhrase} ${year}`));
    }

    if (plan.ambiguityHigh) {
        variants.push(cleanWhitespace(`${entityPhrase} disambiguation official source`));
    }
    if (constraintSet.has('current')) {
        variants.push(cleanWhitespace(`${entityPhrase} site:gov official`));
        const q = String(plan.normalizedQuery || '').toLowerCase();
        if (/\b(usa|united states|us president|president of the us|president of the united states)\b/.test(q)) {
            variants.push(cleanWhitespace(`site:whitehouse.gov ${entityPhrase}`));
            variants.push(cleanWhitespace(`site:usa.gov ${entityPhrase}`));
        }
    }

    return dedupe(variants).slice(0, variantLimitForMode(qualityMode));
}

function buildQueryPlan(query, options = {}) {
    const qualityMode = String(options.qualityMode || 'balanced').toLowerCase();
    const normalizedQuery = sanitizeQuery(query);
    const cacheKey = `${qualityMode}::${normalizedQuery}`;
    const hit = planCache.get(cacheKey);
    if (hit && (Date.now() - hit.cachedAt) < PLAN_CACHE_TTL_MS) {
        return hit.value;
    }

    const tokens = extractTokens(normalizedQuery);
    const versionTokens = extractVersionTokens(tokens);
    const hardConstraints = collectConstraints(normalizedQuery, HARD_CONSTRAINT_PATTERNS);
    const optionalConstraints = collectConstraints(normalizedQuery, OPTIONAL_CONSTRAINT_PATTERNS);
    const negativeTerms = extractNegativeTerms(normalizedQuery);
    const entities = tokens.filter((token) => !versionTokens.includes(token) && !hardConstraints.includes(token));
    const freshnessSensitive = /\b(latest|today|current|recent|new|update)\b/i.test(normalizedQuery);
    const ambiguityHigh = entities.length < 2 && versionTokens.length === 0;

    const plan = {
        originalQuery: String(query || ''),
        normalizedQuery,
        tokens,
        entities: dedupe(entities).slice(0, 8),
        versionTokens: dedupe(versionTokens),
        hardConstraints,
        optionalConstraints,
        freshnessSensitive,
        negativeTerms,
        ambiguityHigh,
        queryVariants: [],
    };
    plan.queryVariants = buildVariants(plan, qualityMode);

    planCache.set(cacheKey, { cachedAt: Date.now(), value: plan });
    if (planCache.size > 400) {
        const first = planCache.keys().next();
        if (!first.done) planCache.delete(first.value);
    }

    return plan;
}

module.exports = {
    buildQueryPlan,
    __test: {
        sanitizeQuery,
        extractTokens,
        extractVersionTokens,
        extractNegativeTerms,
        buildVariants,
        collectConstraints,
    },
};
