/**
 * /api/search — Free web search with provider abstraction, ranking, and trust signals.
 */

const MAX_RESULTS_DEFAULT = 5;
const MAX_RESULTS_LIMIT = 10;
const SEARCH_TIMEOUT_MS = 10_000;
const PROVIDER_TIMEOUT_MS = 5_000;
const PROVIDER_RETRY_COUNT = 2;

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/';
const DDG_API_URL = 'https://api.duckduckgo.com/';
const WIKI_API_URL = 'https://en.wikipedia.org/w/api.php';
const BING_RSS_URL = 'https://www.bing.com/search';

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_RECENCY_DAYS = 30;

const HIGH_TRUST_DOMAINS = new Set([
    'wikipedia.org',
    'nih.gov',
    'cdc.gov',
    'who.int',
    'nasa.gov',
    'fda.gov',
    'sec.gov',
    'docs.python.org',
    'developer.mozilla.org',
    'nodejs.org',
    'openai.com',
    'cloudflare.com',
    'ietf.org',
    'iso.org',
    'arxiv.org',
    'nature.com',
    'science.org',
    'github.com',
    'edu',
    'gov',
]);

const PROVIDER_WEIGHTS = {
    ddg_html: 0.25,
    ddg_lite: 0.2,
    ddg_instant: 0.15,
    wikipedia: 0.15,
    bing_rss: 0.2,
};

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHTMLEntities(text) {
    return String(text || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function stripHTMLTags(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ');
}

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
        const u = new URL(url);
        return normalizeDomain(u.hostname);
    } catch {
        return '';
    }
}

function canonicalizeUrl(url) {
    try {
        const u = new URL(url);
        u.hash = '';
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
            u.searchParams.delete(key);
        }
        const query = u.searchParams.toString();
        u.search = query ? `?${query}` : '';
        const normalizedPath = u.pathname.replace(/\/+$/, '') || '/';
        return `${u.protocol}//${u.host}${normalizedPath}${u.search}`;
    } catch {
        return String(url || '').trim();
    }
}

function parseDuckDuckGoHTML(html) {
    const results = [];
    const blockRegex = /<div class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;
    const blocks = html.match(blockRegex) || [];

    for (const block of blocks) {
        const linkMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/i);
        if (!linkMatch) continue;
        let url = decodeHTMLEntities(linkMatch[1]);
        const uddgMatch = url.match(/[?&]uddg=([^&]+)/i);
        if (uddgMatch) {
            try {
                url = decodeURIComponent(uddgMatch[1]);
            } catch { }
        }
        if (!/^https?:\/\//i.test(url)) continue;

        const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);

        const title = cleanWhitespace(decodeHTMLEntities(stripHTMLTags(titleMatch?.[1] || '')));
        const snippet = cleanWhitespace(decodeHTMLEntities(stripHTMLTags(snippetMatch?.[1] || '')));

        results.push({
            title: title || url,
            url,
            snippet,
        });
    }
    return results;
}

function parseDuckDuckGoLiteHTML(html) {
    const results = [];
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html))) {
        let url = decodeHTMLEntities(match[1]);
        const label = cleanWhitespace(decodeHTMLEntities(stripHTMLTags(match[2] || '')));
        if (!/^https?:\/\//i.test(url)) continue;
        if (!label || label.length < 2) continue;

        const uddgMatch = url.match(/[?&]uddg=([^&]+)/i);
        if (uddgMatch) {
            try {
                url = decodeURIComponent(uddgMatch[1]);
            } catch { }
        }

        results.push({
            title: label,
            url,
            snippet: '',
        });
    }
    return results;
}

function extractYearSignals(text) {
    const matches = String(text || '').match(/\b(19|20)\d{2}\b/g) || [];
    return matches.map((v) => Number(v)).filter(Number.isFinite);
}

function inferPublishedDate(result) {
    if (result.publishedAt) return result.publishedAt;
    const years = extractYearSignals(`${result.title} ${result.snippet}`);
    if (years.length === 0) return null;
    const latest = Math.max(...years);
    if (latest < 1990 || latest > 2100) return null;
    return `${latest}-01-01`;
}

function freshnessScore(result, recencyDays) {
    const publishedAt = inferPublishedDate(result);
    if (!publishedAt) return 0.35;
    const date = Date.parse(publishedAt);
    if (!Number.isFinite(date)) return 0.35;
    const days = Math.max(0, (Date.now() - date) / (24 * 60 * 60 * 1000));
    if (days <= recencyDays) return 1;
    if (days <= recencyDays * 2) return 0.75;
    if (days <= recencyDays * 6) return 0.5;
    return 0.25;
}

function trustScore(result, trustedDomains = [], highStakes = false) {
    const domain = result.domain || getDomainFromUrl(result.url);
    if (!domain) return 0.2;
    if (trustedDomains.includes(domain)) return 1;
    if (domain === 'wikipedia.org') return 0.78;
    if (HIGH_TRUST_DOMAINS.has(domain)) return 0.92;
    if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 0.9;
    if (domain.endsWith('.org')) return highStakes ? 0.7 : 0.75;
    if (domain.endsWith('.com')) return highStakes ? 0.45 : 0.55;
    return 0.5;
}

function specificityScore(result) {
    const snippet = cleanWhitespace(result.snippet);
    if (!snippet) return 0.2;
    const words = snippet.split(' ').filter(Boolean);
    if (words.length >= 20) return 1;
    if (words.length >= 12) return 0.75;
    if (words.length >= 6) return 0.5;
    return 0.35;
}

function evidenceQuality(score, trust, freshness) {
    if (score >= 0.78 && trust >= 0.8 && freshness >= 0.6) return 'high';
    if (score >= 0.55) return 'medium';
    return 'low';
}

function isHighStakesQuery(query) {
    const q = String(query || '').toLowerCase();
    return /(medical|medicine|drug|dosage|law|legal|tax|financial|investment|security|vulnerability|cvss|cve)/.test(q);
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function withRetries(fn, retries = PROVIDER_RETRY_COUNT) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn(i + 1);
        } catch (error) {
            lastError = error;
            if (i < retries - 1) {
                const jitterMs = 100 + Math.floor(Math.random() * 250);
                await sleep(jitterMs);
            }
        }
    }
    throw lastError;
}

async function searchDDGHtmlProvider(query, maxResults, locale) {
    return withRetries(async () => {
        const params = new URLSearchParams({ q: query, kl: locale.replace('-', '_') });
        const response = await fetchWithTimeout(DDG_HTML_URL, {
            method: 'POST',
            headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        }, PROVIDER_TIMEOUT_MS);
        if (!response.ok) throw new Error(`DDG HTML status ${response.status}`);
        const html = await response.text();
        return parseDuckDuckGoHTML(html).slice(0, maxResults).map((r) => ({
            ...r,
            sourceEngine: 'ddg_html',
        }));
    });
}

async function searchDDGLiteProvider(query, maxResults) {
    return withRetries(async () => {
        const params = new URLSearchParams({ q: query });
        const response = await fetchWithTimeout(`${DDG_LITE_URL}?${params.toString()}`, {
            method: 'GET',
            headers: BROWSER_HEADERS,
        }, PROVIDER_TIMEOUT_MS);
        if (!response.ok) throw new Error(`DDG Lite status ${response.status}`);
        const html = await response.text();
        return parseDuckDuckGoLiteHTML(html).slice(0, maxResults).map((r) => ({
            ...r,
            sourceEngine: 'ddg_lite',
        }));
    });
}

async function searchDDGInstantProvider(query, maxResults) {
    return withRetries(async () => {
        const params = new URLSearchParams({
            q: query,
            format: 'json',
            no_redirect: '1',
            no_html: '1',
            skip_disambig: '1',
        });
        const response = await fetchWithTimeout(`${DDG_API_URL}?${params.toString()}`, {
            method: 'GET',
            headers: BROWSER_HEADERS,
        }, PROVIDER_TIMEOUT_MS);

        if (!response.ok) throw new Error(`DDG API status ${response.status}`);
        const data = await response.json();
        const results = [];
        const queryTokens = new Set(String(query || '').toLowerCase().split(/\W+/).filter((t) => t.length >= 3));
        const isRelevant = (text) => {
            const tokens = String(text || '').toLowerCase().split(/\W+/).filter((t) => t.length >= 3);
            if (tokens.length === 0 || queryTokens.size === 0) return true;
            let overlap = 0;
            for (const token of tokens) {
                if (queryTokens.has(token)) overlap += 1;
            }
            return overlap >= 1;
        };
        const isExternalHttp = (value) => {
            try {
                const u = new URL(String(value || ''));
                const hostname = String(u.hostname || '').toLowerCase();
                if (!['http:', 'https:'].includes(u.protocol)) return false;
                if (hostname.endsWith('duckduckgo.com')) return false;
                return true;
            } catch {
                return false;
            }
        };

        if (data.AbstractText && data.AbstractURL) {
            if (isExternalHttp(data.AbstractURL) && isRelevant(`${data.Heading} ${data.AbstractText}`)) {
                results.push({
                    title: data.Heading || query,
                    url: data.AbstractURL,
                    snippet: String(data.AbstractText || '').slice(0, 280),
                    sourceEngine: 'ddg_instant',
                });
            }
        }

        const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
        for (const topic of topics) {
            if (results.length >= maxResults) break;
            if (topic?.FirstURL && topic?.Text && isExternalHttp(topic.FirstURL) && isRelevant(topic.Text)) {
                results.push({
                    title: String(topic.Text).split(' - ')[0]?.trim() || String(topic.Text).slice(0, 80),
                    url: topic.FirstURL,
                    snippet: String(topic.Text).slice(0, 280),
                    sourceEngine: 'ddg_instant',
                });
            } else if (Array.isArray(topic?.Topics)) {
                for (const nested of topic.Topics) {
                    if (results.length >= maxResults) break;
                    if (nested?.FirstURL && nested?.Text && isExternalHttp(nested.FirstURL) && isRelevant(nested.Text)) {
                        results.push({
                            title: String(nested.Text).split(' - ')[0]?.trim() || String(nested.Text).slice(0, 80),
                            url: nested.FirstURL,
                            snippet: String(nested.Text).slice(0, 280),
                            sourceEngine: 'ddg_instant',
                        });
                    }
                }
            }
        }
        return results.slice(0, maxResults);
    });
}

async function searchWikipediaProvider(query, maxResults) {
    return withRetries(async () => {
        const params = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: query,
            srlimit: String(maxResults),
            format: 'json',
            origin: '*',
        });
        const response = await fetchWithTimeout(`${WIKI_API_URL}?${params.toString()}`, {
            method: 'GET',
            headers: BROWSER_HEADERS,
        }, PROVIDER_TIMEOUT_MS);
        if (!response.ok) throw new Error(`Wikipedia API status ${response.status}`);
        const data = await response.json();
        return (data.query?.search || []).map((item) => ({
            title: item.title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title).replace(/ /g, '_'))}`,
            snippet: cleanWhitespace(stripHTMLTags(item.snippet || '')),
            sourceEngine: 'wikipedia',
            // Wikipedia timestamp is last-edit, not publication time.
            publishedAt: null,
        }));
    });
}

function parseRssItems(xml) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(String(xml || '')))) {
        const block = match[1];
        const title = cleanWhitespace(decodeHTMLEntities((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ''));
        const link = cleanWhitespace(decodeHTMLEntities((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || ''));
        const desc = cleanWhitespace(decodeHTMLEntities(stripHTMLTags((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')));
        if (!/^https?:\/\//i.test(link)) continue;
        items.push({
            title: title || link,
            url: link,
            snippet: desc,
            sourceEngine: 'bing_rss',
        });
    }
    return items;
}

async function searchBingRssProvider(query, maxResults) {
    return withRetries(async () => {
        const params = new URLSearchParams({ q: query, format: 'rss' });
        const response = await fetchWithTimeout(`${BING_RSS_URL}?${params.toString()}`, {
            method: 'GET',
            headers: BROWSER_HEADERS,
        }, PROVIDER_TIMEOUT_MS);
        if (!response.ok) throw new Error(`Bing RSS status ${response.status}`);
        const xml = await response.text();
        return parseRssItems(xml).slice(0, maxResults);
    });
}

function normalizeResult(result) {
    const canonical = canonicalizeUrl(result.url);
    const domain = getDomainFromUrl(canonical);
    return {
        title: cleanWhitespace(decodeHTMLEntities(result.title || canonical)),
        url: canonical,
        snippet: cleanWhitespace(decodeHTMLEntities(result.snippet || '')),
        sourceEngine: result.sourceEngine || 'unknown',
        domain,
        publishedAt: result.publishedAt || null,
        retrievedAt: new Date().toISOString(),
    };
}

function dedupeAndScore(rawResults, options) {
    const {
        recencyDays = DEFAULT_RECENCY_DAYS,
        trustedDomains = [],
        excludeDomains = [],
        query = '',
    } = options || {};

    const highStakes = isHighStakesQuery(query);
    const seen = new Map();
    const agreementMap = new Map();

    for (const result of rawResults) {
        if (!result.url) continue;
        if (!result.domain) continue;
        if (excludeDomains.includes(result.domain)) continue;
        if (!agreementMap.has(result.url)) agreementMap.set(result.url, new Set());
        agreementMap.get(result.url).add(result.sourceEngine);

        const existing = seen.get(result.url);
        if (!existing || (result.snippet || '').length > (existing.snippet || '').length) {
            seen.set(result.url, result);
        }
    }

    const scored = [];
    for (const result of seen.values()) {
        const domainTrust = trustScore(result, trustedDomains, highStakes);
        const freshness = freshnessScore(result, recencyDays);
        const specificity = specificityScore(result);
        const providerWeight = PROVIDER_WEIGHTS[result.sourceEngine] || 0.1;
        const agreement = Math.min(1, ((agreementMap.get(result.url)?.size || 1) - 1) * 0.3);

        const score =
            (domainTrust * 0.45) +
            (freshness * 0.25) +
            (specificity * 0.15) +
            (providerWeight * 0.05) +
            (agreement * 0.1);

        scored.push({
            ...result,
            freshnessScore: Number(freshness.toFixed(3)),
            trustScore: Number(domainTrust.toFixed(3)),
            score: Number(score.toFixed(3)),
            evidenceQuality: evidenceQuality(score, domainTrust, freshness),
        });
    }

    scored.sort((a, b) => b.score - a.score);

    const maxPerDomain = 2;
    const domainCount = new Map();
    const diversified = [];
    const overflow = [];

    for (const item of scored) {
        const key = item.domain || 'unknown';
        const count = domainCount.get(key) || 0;
        if (count < maxPerDomain) {
            domainCount.set(key, count + 1);
            diversified.push(item);
        } else {
            overflow.push(item);
        }
    }

    return [...diversified, ...overflow];
}

function normalizeDomainList(value) {
    if (!Array.isArray(value)) return [];
    const set = new Set();
    for (const item of value) {
        const normalized = normalizeDomain(String(item || '').trim().toLowerCase());
        if (normalized) set.add(normalized);
    }
    return [...set];
}

async function searchDuckDuckGo(query, optionsOrMaxResults = MAX_RESULTS_DEFAULT) {
    const options = typeof optionsOrMaxResults === 'number'
        ? { maxResults: optionsOrMaxResults }
        : (optionsOrMaxResults || {});

    const maxResults = Math.min(
        Math.max(1, Number(options.maxResults) || MAX_RESULTS_DEFAULT),
        MAX_RESULTS_LIMIT,
    );
    const locale = String(options.locale || DEFAULT_LOCALE);
    const recencyDays = Math.max(1, Number(options.recencyDays) || DEFAULT_RECENCY_DAYS);
    const trustedDomains = normalizeDomainList(options.trustedDomains);
    const excludeDomains = normalizeDomainList(options.excludeDomains);

    const timeout = setTimeout(() => { }, SEARCH_TIMEOUT_MS);
    try {
        const providers = [
            searchDDGHtmlProvider(query, maxResults * 2, locale),
            searchDDGLiteProvider(query, maxResults * 2),
            searchBingRssProvider(query, maxResults * 2),
            searchDDGInstantProvider(query, Math.max(2, Math.ceil(maxResults / 2))),
            searchWikipediaProvider(query, Math.max(2, Math.ceil(maxResults / 2))),
        ];

        const settled = await Promise.allSettled(providers);
        const raw = [];
        const providerSummary = {
            ddg_html: 0,
            ddg_lite: 0,
            bing_rss: 0,
            ddg_instant: 0,
            wikipedia: 0,
            failed: 0,
        };
        for (const result of settled) {
            if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                for (const item of result.value) {
                    const normalized = normalizeResult(item);
                    raw.push(normalized);
                    if (providerSummary[normalized.sourceEngine] !== undefined) {
                        providerSummary[normalized.sourceEngine] += 1;
                    }
                }
            } else if (result.status === 'rejected') {
                providerSummary.failed += 1;
            }
        }

        const ranked = dedupeAndScore(raw, {
            recencyDays,
            trustedDomains,
            excludeDomains,
            query,
        });
        console.log(`[SearchProviders] ${JSON.stringify({ query, providerSummary, ranked: ranked.length })}`);

        return ranked.slice(0, maxResults);
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
        query,
        maxResults,
        locale = DEFAULT_LOCALE,
        recencyDays = DEFAULT_RECENCY_DAYS,
        trustedDomains = [],
        excludeDomains = [],
    } = req.body || {};

    if (!query || !String(query).trim()) {
        return res.status(400).json({ error: 'Missing "query" in request body.' });
    }

    const limit = Math.min(
        Math.max(1, Number(maxResults) || MAX_RESULTS_DEFAULT),
        MAX_RESULTS_LIMIT,
    );

    try {
        const results = await searchDuckDuckGo(String(query).trim(), {
            maxResults: limit,
            locale,
            recencyDays,
            trustedDomains,
            excludeDomains,
        });

        return res.status(200).json({
            query: String(query).trim(),
            locale,
            recencyDays: Number(recencyDays) || DEFAULT_RECENCY_DAYS,
            results,
        });
    } catch (error) {
        console.error('Search error:', error.message);
        return res.status(502).json({
            error: 'Web search failed',
            details: error.message,
        });
    }
};

module.exports.searchDuckDuckGo = searchDuckDuckGo;
module.exports.__test = {
    canonicalizeUrl,
    normalizeDomain,
    dedupeAndScore,
    parseDuckDuckGoHTML,
    parseDuckDuckGoLiteHTML,
    parseRssItems,
};
