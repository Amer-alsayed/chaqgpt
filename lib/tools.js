/**
 * Tool definitions + execution logic for agentic chat.
 */

const { searchDuckDuckGo, searchDuckDuckGoWithMeta } = require('../api/search');
const { fetchUrlContent } = require('../api/fetch-url');
const { executeCodeWithLimits } = require('../api/execute');

const AI_BENCHMARK_TRUSTED_DOMAINS = [
    'paperswithcode.com',
    'huggingface.co',
    'lmarena.ai',
    'artificialanalysis.ai',
    'openai.com',
    'anthropic.com',
    'deepmind.google',
    'arxiv.org',
    'github.com',
];

const CURRENT_OFFICE_TRUSTED_DOMAINS = [
    'whitehouse.gov',
    'usa.gov',
    'house.gov',
    'senate.gov',
    'congress.gov',
    'govtrack.us',
    'archives.gov',
];

const PRODUCT_SPECS_TRUSTED_DOMAINS = [
    'apple.com',
    'gsmarena.com',
    'phonearena.com',
    'kimovil.com',
    'notebookcheck.net',
    '91mobiles.com',
    'smartprix.com',
    'nanoreview.net',
];

function isAIBenchmarkQuery(text) {
    const q = String(text || '').toLowerCase();
    return /\b(ai|llm|language model|models|gpt|claude|gemini|benchmark|benchmarks|leaderboard|ranking|sota|state of the art|mmlu|gpqa|livebench|swe-bench|arena)\b/
        .test(q);
}

function isCurrentOfficeQuery(text) {
    const q = String(text || '').toLowerCase();
    const asksForPerson = /\b(who|current|incumbent|serving|office[- ]holder)\b/.test(q);
    const officeMention = /\b(president|prime minister|ceo|governor|chancellor|secretary of state|speaker)\b/.test(q);
    if (asksForPerson && officeMention) return true;
    return /\bpresident\b/.test(q) && /\b(us|usa|united states)\b/.test(q);
}

function isProductSpecsQuery(text) {
    const q = String(text || '').toLowerCase();
    const hasSpecsIntent = /\b(spec|specs|specification|specifications|features|camera|battery|ram|storage|dimensions|weight|display|chip|soc)\b/.test(q);
    const hasProductHint = /\b(iphone|ipad|macbook|imac|watch|galaxy|pixel|xiaomi|oneplus|huawei|sony|surface|thinkpad|phone|smartphone|laptop)\b/.test(q);
    if (hasSpecsIntent && hasProductHint) return true;
    return hasProductHint && /\b\d{1,3}\b/.test(q) && /\b(pro|max|ultra|plus|mini|se)\b/.test(q);
}

function buildSearchProfile(query) {
    const normalized = String(query || '').trim();
    if (isAIBenchmarkQuery(normalized)) {
        return {
            intent: 'ai_benchmark',
            trustedDomains: AI_BENCHMARK_TRUSTED_DOMAINS,
            excludeDomains: [],
            recencyDays: 14,
            maxResultsPerQuery: 6,
            seedQueries: [
                `${normalized} llm benchmark leaderboard`,
                `${normalized} model evaluation results`,
                `${normalized} paperswithcode leaderboard`,
                `${normalized} lmarena ranking`,
                `${normalized} huggingface leaderboard`,
            ],
            domainSeedQueries: [
                `site:paperswithcode.com ${normalized} leaderboard`,
                `site:lmarena.ai ${normalized} ranking`,
                `site:huggingface.co ${normalized} benchmark`,
            ],
        };
    }

    if (isProductSpecsQuery(normalized)) {
        return {
            intent: 'product_specs',
            trustedDomains: PRODUCT_SPECS_TRUSTED_DOMAINS,
            excludeDomains: [],
            recencyDays: 120,
            maxResultsPerQuery: 6,
            seedQueries: [
                `${normalized} full specifications`,
                `${normalized} technical specs`,
                `${normalized} camera battery display`,
            ],
            domainSeedQueries: [
                `site:apple.com ${normalized} technical specifications`,
                `site:gsmarena.com ${normalized} specs`,
                `site:phonearena.com ${normalized} specs`,
            ],
        };
    }

    if (isCurrentOfficeQuery(normalized)) {
        return {
            intent: 'current_office',
            trustedDomains: CURRENT_OFFICE_TRUSTED_DOMAINS,
            excludeDomains: [],
            recencyDays: 14,
            maxResultsPerQuery: 6,
            seedQueries: [
                `${normalized} official`,
                `${normalized} incumbent`,
                `${normalized} ${new Date().getFullYear()}`,
                `${normalized} white house`,
            ],
            domainSeedQueries: [
                `site:whitehouse.gov ${normalized}`,
                `site:usa.gov ${normalized}`,
                `site:govtrack.us ${normalized}`,
            ],
        };
    }

    return {
        intent: 'default',
        trustedDomains: [],
        excludeDomains: [],
        recencyDays: 30,
        maxResultsPerQuery: 4,
        seedQueries: [],
        domainSeedQueries: [],
    };
}

const TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'search_web',
            description: 'Search the internet for current information. Use concise keyword queries. Prefer multiple focused searches for complex topics and cite sources in your final response.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Keyword-focused query.' },
                    locale: { type: 'string', description: 'Locale hint like en-US.' },
                    recencyDays: { type: 'number', description: 'Recency preference in days.' },
                    trustedDomains: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional list of domains to prioritize.',
                    },
                    excludeDomains: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional list of domains to exclude.',
                    },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'fetch_url',
            description: 'Fetch and read a webpage. Use after search to validate facts from the original source.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL to fetch.' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'execute_code',
            description: 'Safely execute small code snippets for calculations or verification. Use only when execution materially improves correctness.',
            parameters: {
                type: 'object',
                properties: {
                    language: { type: 'string', description: 'Programming language.' },
                    code: { type: 'string', description: 'Code to execute.' },
                    stdin: { type: 'string', description: 'Optional stdin.' },
                },
                required: ['language', 'code'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'verify_claims',
            description: 'Cross-check claims by searching multiple sources and summarizing support confidence.',
            parameters: {
                type: 'object',
                properties: {
                    claims: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Factual claims to verify.',
                    },
                    recencyDays: { type: 'number', description: 'Recency preference in days.' },
                },
                required: ['claims'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_current_datetime',
            description: 'Get current date/time/timezone.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
];

function normalizeDomain(value) {
    const parts = String(value || '').toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
}

function normalizeDomainList(value) {
    if (!Array.isArray(value)) return [];
    const set = new Set();
    for (const item of value) {
        const normalized = normalizeDomain(item);
        if (normalized) set.add(normalized);
    }
    return [...set];
}

async function executeSearchWeb(args) {
    const query = String(args?.query || '').trim();
    if (!query) return { error: 'No search query provided.' };
    const profile = buildSearchProfile(query);

    const locale = String(args?.locale || 'en-US');
    const recencyDays = Math.max(1, Number(args?.recencyDays) || profile.recencyDays);
    const trustedDomains = normalizeDomainList([...(args?.trustedDomains || []), ...profile.trustedDomains]);
    const excludeDomains = normalizeDomainList([...(args?.excludeDomains || []), ...profile.excludeDomains]);

    try {
        const results = await searchDuckDuckGo(query, {
            maxResults: Math.max(8, profile.maxResultsPerQuery),
            locale,
            recencyDays,
            trustedDomains,
            excludeDomains,
        });
        return {
            query,
            locale,
            recencyDays,
            results,
            citation_instruction: 'Cite sources using markdown links: [Title](URL).',
        };
    } catch (error) {
        return { error: `Search failed: ${error.message}` };
    }
}

async function executeFetchUrl(args) {
    const url = String(args?.url || '').trim();
    if (!url) return { error: 'No URL provided.' };
    try {
        return await fetchUrlContent(url, 12_000);
    } catch (error) {
        return { error: `Failed to fetch URL: ${error.message}` };
    }
}

async function executeCode(args, context = {}) {
    const language = String(args?.language || '').trim();
    const code = String(args?.code || '');
    const stdin = String(args?.stdin || '');

    if (!language || !code.trim()) {
        return { error: 'Both language and code are required.' };
    }

    try {
        const limits = {
            maxCodeSize: context.maxCodeSize || 20_000,
            maxRuntimeMs: context.maxRuntimeMs || 10_000,
            maxStdoutBytes: context.maxStdoutBytes || 16_000,
            allowedLanguages: context.allowedLanguages || undefined,
        };

        const result = await executeCodeWithLimits({ language, code, stdin, limits });
        return {
            language: String(language).toLowerCase(),
            run: result.run,
            compile: result.compile,
            didExecute: result.didExecute,
            note: 'If using this output in final answer, mark it as computed result.',
        };
    } catch (error) {
        return { error: `Execution failed: ${error.message}` };
    }
}

async function executeVerifyClaims(args) {
    const claims = Array.isArray(args?.claims) ? args.claims.map((c) => String(c || '').trim()).filter(Boolean) : [];
    if (claims.length === 0) return { error: 'No claims provided.' };

    const recencyDays = Math.max(1, Number(args?.recencyDays) || 30);
    const verdicts = [];

    for (const claim of claims.slice(0, 5)) {
        const results = await searchDuckDuckGo(claim, {
            maxResults: 4,
            recencyDays,
        }).catch(() => []);
        const supported = results.filter((r) => (r.evidenceQuality === 'high' || r.evidenceQuality === 'medium')).length;
        const confidence = supported >= 3 ? 'high' : supported >= 1 ? 'medium' : 'low';

        verdicts.push({
            claim,
            confidence,
            supportCount: supported,
            sources: results.map((r) => ({
                title: r.title,
                url: r.url,
                score: r.score,
                evidenceQuality: r.evidenceQuality,
            })),
        });
    }

    return { verdicts };
}

function executeGetCurrentDatetime() {
    const now = new Date();
    return {
        iso: now.toISOString(),
        utc: now.toUTCString(),
        local: now.toString(),
        date: now.toISOString().split('T')[0],
        time: now.toISOString().split('T')[1].split('.')[0],
        timestamp: now.getTime(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
}

const TOOL_EXECUTORS = {
    search_web: executeSearchWeb,
    fetch_url: executeFetchUrl,
    execute_code: executeCode,
    verify_claims: executeVerifyClaims,
    get_current_datetime: executeGetCurrentDatetime,
};

async function executeTool(toolName, args, context = {}) {
    const executor = TOOL_EXECUTORS[toolName];
    if (!executor) return JSON.stringify({ error: `Unknown tool: ${toolName}` });

    try {
        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : (args || {});
        const result = await executor(parsedArgs, context);
        return JSON.stringify(result);
    } catch (error) {
        return JSON.stringify({ error: `Tool execution failed: ${error.message}` });
    }
}

function extractSearchQuery(text) {
    let q = String(text || '').trim();
    const fillerPatterns = [
        /^(can you |could you |please |tell me |explain |describe |help me |i want to know |i need to know |what do you know about |give me info on |search for |look up |find out |find me )/i,
        /^(what is |what are |what was |what were |who is |who are |who was |where is |where are |when is |when was |when did |how is |how are |how do |how does |how did |how can |why is |why are |why do |why does |why did )/i,
        /\?+$/g,
    ];
    for (const pattern of fillerPatterns) q = q.replace(pattern, '');
    q = q.trim().slice(0, 150);
    if (q.length < 3) q = String(text || '').trim().slice(0, 150);
    return q;
}

function decomposeSearchQueries(inputText) {
    const base = extractSearchQuery(inputText);
    const profile = buildSearchProfile(base);
    const queries = [base];
    const lower = base.toLowerCase();

    if (/\b(latest|today|recent|new|update)\b/.test(lower)) {
        queries.push(`${base} latest`);
        queries.push(`${base} official source`);
    } else if (/\b(compare|difference|vs|versus)\b/.test(lower)) {
        queries.push(`${base} comparison`);
        queries.push(`${base} benchmark`);
    } else {
        queries.push(`${base} overview`);
        queries.push(`${base} official documentation`);
    }

    queries.push(...profile.seedQueries);
    const maxQueries = profile.intent === 'default' ? 3 : 6;
    return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, maxQueries);
}

async function buildSearchContext(userMessage) {
    let queryText = '';
    if (typeof userMessage === 'string') {
        queryText = userMessage;
    } else if (Array.isArray(userMessage)) {
        for (const part of userMessage) {
            if (part?.type === 'text') queryText += ` ${part.text || ''}`;
        }
    }

    queryText = queryText.trim();
    if (!queryText) return null;

    const profile = buildSearchProfile(queryText);
    const queries = decomposeSearchQueries(queryText);
    const merged = [];
    const seen = new Set();
    const trustedDomainSet = new Set(normalizeDomainList(profile.trustedDomains));
    let bestConfidence = { score: 0, level: 'low', isFallback: true, reasons: ['no_search'] };
    let pipelineMeta = null;

    for (const query of queries) {
        const payload = await searchDuckDuckGoWithMeta(query, {
            maxResults: profile.maxResultsPerQuery,
            recencyDays: profile.recencyDays,
            trustedDomains: profile.trustedDomains,
            excludeDomains: profile.excludeDomains,
            qualityMode: 'balanced',
        }).catch(() => null);
        const results = Array.isArray(payload?.results) ? payload.results : [];
        if (payload?.meta?.confidence) {
            const candidateConfidence = payload.meta.confidence;
            if (Number(candidateConfidence.score || 0) >= Number(bestConfidence.score || 0)) {
                bestConfidence = candidateConfidence;
                pipelineMeta = payload.meta;
            }
        }
        for (const result of results) {
            const key = result.url;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(result);
        }
    }

    const trustedHits = merged.filter((item) => trustedDomainSet.has(String(item.domain || '').toLowerCase())).length;
    if (profile.intent !== 'default' && trustedHits < 2) {
        for (const query of profile.domainSeedQueries) {
            const payload = await searchDuckDuckGoWithMeta(query, {
                maxResults: profile.maxResultsPerQuery,
                recencyDays: profile.recencyDays,
                trustedDomains: profile.trustedDomains,
                excludeDomains: profile.excludeDomains,
                qualityMode: 'balanced',
            }).catch(() => null);
            const results = Array.isArray(payload?.results) ? payload.results : [];
            if (payload?.meta?.confidence) {
                const candidateConfidence = payload.meta.confidence;
                if (Number(candidateConfidence.score || 0) >= Number(bestConfidence.score || 0)) {
                    bestConfidence = candidateConfidence;
                    pipelineMeta = payload.meta;
                }
            }
            for (const result of results) {
                const key = result.url;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                merged.push(result);
            }
        }
    }

    merged.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    const top = merged.slice(0, 8);
    if (top.length === 0) return null;

    const today = new Date().toISOString().split('T')[0];
    const formatted = top.map((r, i) => (
        `[${i + 1}] ${r.title}\n` +
        `    URL: ${r.url}\n` +
        `    Domain: ${r.domain || 'unknown'}\n` +
        `    Trust: ${r.trustScore ?? 'n/a'} | Freshness: ${r.freshnessScore ?? 'n/a'} | Quality: ${r.evidenceQuality || 'n/a'}\n` +
        `${r.snippet ? `    Summary: ${r.snippet}` : ''}`
    )).join('\n\n');

    return {
        message: {
            role: 'system',
            content:
                `Today's date is ${today}. Web search context was gathered from multiple focused queries.\n` +
                `Queries used: ${queries.join(' | ')}\n\n` +
                `${formatted}\n\n` +
                'INSTRUCTIONS:\n' +
                '- Base your answer on high-confidence evidence first.\n' +
                '- Cite sources inline as [Title](URL).\n' +
                `- Search confidence: ${bestConfidence.level} (${bestConfidence.score}).\n` +
                (bestConfidence.level === 'low'
                    ? '- Evidence confidence is low. Ask one clarifying follow-up if needed or answer conservatively with explicit uncertainty.\n'
                    : '') +
                (profile.intent === 'ai_benchmark'
                    ? '- Prefer benchmark tables/leaderboards and primary model-release sources over general news summaries.\n'
                    : profile.intent === 'current_office'
                        ? '- For current office-holder questions, prioritize official government/organization sources and recent corroborating reports.\n'
                        : profile.intent === 'product_specs'
                            ? '- Prioritize official technical specification pages and reputable device specification databases. Avoid unrelated product families.\n'
                    : '') +
                '- If evidence is weak or conflicting, state uncertainty explicitly.\n',
        },
        sources: top.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet || '',
            score: r.score,
            trustScore: r.trustScore,
            freshnessScore: r.freshnessScore,
            evidenceQuality: r.evidenceQuality,
        })),
        meta: {
            confidence: bestConfidence,
            pipeline: pipelineMeta
                ? {
                    pipelineVersion: pipelineMeta.pipelineVersion,
                    isFallback: pipelineMeta.isFallback,
                    timingMs: pipelineMeta.timingMs,
                }
                : null,
        },
    };
}

module.exports = {
    TOOL_DEFINITIONS,
    executeTool,
    buildSearchContext,
    __test: {
        decomposeSearchQueries,
        extractSearchQuery,
        isAIBenchmarkQuery,
        isCurrentOfficeQuery,
        isProductSpecsQuery,
        buildSearchProfile,
    },
};
