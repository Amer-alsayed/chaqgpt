const HIGH_TRUST_DOMAINS = new Set([
    'wikipedia.org',
    'arxiv.org',
    'nature.com',
    'science.org',
    'openai.com',
    'anthropic.com',
    'deepmind.google',
    'paperswithcode.com',
    'huggingface.co',
    'lmarena.ai',
    'github.com',
]);

function cleanWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeDomain(hostname) {
    const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
}

function getDomainFromUrl(url) {
    try {
        return normalizeDomain(new URL(String(url || '')).hostname);
    } catch {
        return '';
    }
}

function extractYearSignals(text) {
    return (String(text || '').match(/\b(19|20)\d{2}\b/g) || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
}

function inferPublishedDate(candidate) {
    if (candidate.publishedAt) return candidate.publishedAt;
    const yearFromUrl = String(candidate.url || '').match(/(?:19|20)\d{2}/g);
    if (yearFromUrl?.length) {
        const maxYear = Math.max(...yearFromUrl.map((value) => Number(value)).filter(Number.isFinite));
        if (maxYear >= 1990 && maxYear <= 2100) return `${maxYear}-01-01`;
    }
    const years = extractYearSignals(`${candidate.title} ${candidate.snippet}`);
    if (years.length === 0) return null;
    const latest = Math.max(...years);
    if (latest < 1990 || latest > 2100) return null;
    return `${latest}-01-01`;
}

function scoreFreshness(candidate, plan) {
    const publishedAt = inferPublishedDate(candidate);
    if (!publishedAt) return plan.freshnessSensitive ? 0.2 : 0.45;
    const date = Date.parse(publishedAt);
    if (!Number.isFinite(date)) return 0.45;
    const days = Math.max(0, (Date.now() - date) / (24 * 60 * 60 * 1000));
    if (days <= 30) return 1;
    if (days <= 90) return 0.8;
    if (days <= 365) return 0.55;
    return plan.freshnessSensitive ? 0.25 : 0.4;
}

function scoreSourceQuality(domain, trustedDomains = []) {
    if (!domain) return 0.2;
    if (trustedDomains.includes(domain)) return 1;
    if (HIGH_TRUST_DOMAINS.has(domain)) return 0.92;
    if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 0.9;
    if (domain.endsWith('.org')) return 0.75;
    return 0.55;
}

function scoreEntityCoverage(text, entities = []) {
    if (!entities.length) return 1;
    let matched = 0;
    for (const entity of entities) {
        if (text.includes(entity)) matched += 1;
    }
    return matched / entities.length;
}

function scoreConstraintCoverage(text, constraints = []) {
    if (!constraints.length) return 0.6;
    const maps = {
        specs: /\b(spec|specs|specification|technical|camera|battery|ram|storage|chip|display)\b/,
        benchmark: /\b(benchmark|leaderboard|ranking|mmlu|gpqa|arena|eval|evaluation)\b/,
        current: /\b(latest|current|today|incumbent|serving|official)\b/,
        docs: /\b(api|documentation|docs|reference|manual)\b/,
        compare: /\b(compare|comparison|versus|vs|difference)\b/,
        coding: /\b(code|coding|developer|programming)\b/,
    };

    let matched = 0;
    for (const constraint of constraints) {
        if (maps[constraint]?.test(text)) matched += 1;
    }
    return matched / constraints.length;
}

function scoreLexicalOverlap(text, tokens = []) {
    if (!tokens.length) return 1;
    let overlap = 0;
    for (const token of tokens) {
        if (text.includes(token)) overlap += 1;
    }
    return overlap / tokens.length;
}

function qualityWeights(mode = 'balanced') {
    if (mode === 'fast') {
        return {
            entity: 0.38,
            constraints: 0.18,
            source: 0.24,
            freshness: 0.08,
            agreement: 0.05,
            lexical: 0.07,
        };
    }
    if (mode === 'max') {
        return {
            entity: 0.34,
            constraints: 0.2,
            source: 0.22,
            freshness: 0.12,
            agreement: 0.06,
            lexical: 0.06,
        };
    }
    return {
        entity: 0.36,
        constraints: 0.2,
        source: 0.24,
        freshness: 0.1,
        agreement: 0.05,
        lexical: 0.05,
    };
}

function scoreAndRankCandidates(options = {}) {
    const {
        plan,
        candidates = [],
        maxResults = 8,
        trustedDomains = [],
        excludeDomains = [],
        qualityMode = 'balanced',
    } = options;

    const excluded = new Set((excludeDomains || []).map((value) => String(value || '').toLowerCase()));
    const weights = qualityWeights(qualityMode);

    const scored = [];
    for (const candidate of candidates) {
        const domain = String(candidate.domain || getDomainFromUrl(candidate.url)).toLowerCase();
        if (!domain || excluded.has(domain)) continue;

        const text = cleanWhitespace(`${candidate.title || ''} ${candidate.snippet || ''} ${domain}`).toLowerCase();
        const entityCoverage = scoreEntityCoverage(text, plan.entities || []);
        const constraintCoverage = scoreConstraintCoverage(text, plan.hardConstraints || []);
        const lexical = scoreLexicalOverlap(text, plan.tokens || []);

        const constraints = Array.isArray(plan.hardConstraints) ? plan.hardConstraints : [];
        let entityThreshold = (plan.entities || []).length >= 2 ? 0.34 : 0.2;
        if (constraints.includes('current')) {
            entityThreshold = Math.min(entityThreshold, 0.25);
        }
        if (entityCoverage < entityThreshold) continue;
        if (constraints.length > 0 && constraintCoverage < 0.12 && entityCoverage < 0.9) continue;

        const sourceQuality = scoreSourceQuality(domain, trustedDomains);
        const freshness = scoreFreshness(candidate, plan || {});
        const agreement = Math.min(1, Math.max(0, ((Number(candidate.sourceAgreement || 1) - 1) * 0.35)));

        const score =
            (entityCoverage * weights.entity) +
            (constraintCoverage * weights.constraints) +
            (sourceQuality * weights.source) +
            (freshness * weights.freshness) +
            (agreement * weights.agreement) +
            (lexical * weights.lexical);

        scored.push({
            ...candidate,
            domain,
            entityCoverage: Number(entityCoverage.toFixed(3)),
            constraintCoverage: Number(constraintCoverage.toFixed(3)),
            trustScore: Number(sourceQuality.toFixed(3)),
            freshnessScore: Number(freshness.toFixed(3)),
            score: Number(score.toFixed(3)),
            evidenceQuality: score >= 0.78 && sourceQuality >= 0.8 ? 'high' : (score >= 0.55 ? 'medium' : 'low'),
        });
    }

    scored.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const maxPerDomain = 2;
    const domainCounts = new Map();
    const diversified = [];
    const overflow = [];

    for (const item of scored) {
        const count = domainCounts.get(item.domain) || 0;
        if (count < maxPerDomain) {
            domainCounts.set(item.domain, count + 1);
            diversified.push(item);
        } else {
            overflow.push(item);
        }
    }

    const ranked = [...diversified, ...overflow];
    return {
        ranked,
        top: ranked.slice(0, Math.max(1, Number(maxResults) || 8)),
        meta: {
            inputCandidates: candidates.length,
            scoredCandidates: scored.length,
            droppedCandidates: Math.max(0, candidates.length - scored.length),
        },
    };
}

module.exports = {
    scoreAndRankCandidates,
    __test: {
        scoreEntityCoverage,
        scoreConstraintCoverage,
        scoreLexicalOverlap,
        scoreSourceQuality,
        scoreFreshness,
    },
};
