/**
 * Tool definitions + execution logic for agentic chat.
 */

const { searchDuckDuckGo } = require('../search');
const { fetchUrlContent } = require('../fetch-url');
const { executeCodeWithLimits } = require('../execute');

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

    const locale = String(args?.locale || 'en-US');
    const recencyDays = Math.max(1, Number(args?.recencyDays) || 30);
    const trustedDomains = normalizeDomainList(args?.trustedDomains);
    const excludeDomains = normalizeDomainList(args?.excludeDomains);

    try {
        const results = await searchDuckDuckGo(query, {
            maxResults: 8,
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

    return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 3);
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

    const queries = decomposeSearchQueries(queryText);
    const merged = [];
    const seen = new Set();

    for (const query of queries) {
        const results = await searchDuckDuckGo(query, { maxResults: 4 }).catch(() => []);
        for (const result of results) {
            const key = result.url;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(result);
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
    };
}

module.exports = {
    TOOL_DEFINITIONS,
    executeTool,
    buildSearchContext,
    __test: {
        decomposeSearchQueries,
        extractSearchQuery,
    },
};
