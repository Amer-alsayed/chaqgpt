/**
 * /api/fetch-url — Safe URL retrieval + readable extraction for agent tools.
 */

const dns = require('node:dns').promises;
const net = require('node:net');

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 15_000;
const MAX_HTML_SIZE = 600_000;
const MAX_REDIRECTS = 3;

const ALLOWED_CONTENT_TYPES = [
    'text/html',
    'application/xhtml+xml',
    'text/plain',
    'application/json',
    'application/xml',
    'text/xml',
];

class BlockedUrlError extends Error {
    constructor(message, blockedReason) {
        super(message);
        this.name = 'BlockedUrlError';
        this.blockedReason = blockedReason;
    }
}

function decodeHTMLEntities(text) {
    return String(text || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

function stripHTMLTags(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ');
}

function cleanWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractTitle(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) return '';
    return cleanWhitespace(decodeHTMLEntities(stripHTMLTags(match[1])));
}

function extractLanguage(html) {
    const langMatch = String(html || '').match(/<html[^>]*\blang=["']?([^"'>\s]+)/i);
    return langMatch ? String(langMatch[1]).trim().toLowerCase() : '';
}

function extractEstimatedPublishedAt(html) {
    const source = String(html || '');
    const patterns = [
        /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
        /<time[^>]+datetime=["']([^"']+)["']/i,
    ];
    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) return String(match[1]);
    }
    return null;
}

function stripBoilerplate(html) {
    let text = String(html || '');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, '');
    return text;
}

function extractReadableBlock(html) {
    const source = stripBoilerplate(html);
    const candidates = [
        source.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1],
        source.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1],
        source.match(/<div[^>]+id=["'][^"']*(content|article|main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[2],
    ].filter(Boolean);

    if (candidates.length === 0) {
        return { method: 'fallback-text', html: source };
    }

    candidates.sort((a, b) => b.length - a.length);
    return { method: 'readability', html: candidates[0] };
}

function htmlToText(html) {
    let text = String(html || '');
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr|section|article|main)[^>]*>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = stripHTMLTags(text);
    text = decodeHTMLEntities(text);
    text = text
        .split('\n')
        .map((line) => cleanWhitespace(line))
        .filter(Boolean)
        .join('\n');
    return text.trim();
}

function wordCount(text) {
    return String(text || '').split(/\s+/).filter(Boolean).length;
}

function isPrivateIPv4(ip) {
    const parts = String(ip).split('.').map((v) => Number(v));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
}

function isPrivateIPv6(ip) {
    const normalized = String(ip || '').toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    return false;
}

function isPrivateIp(ip) {
    const family = net.isIP(ip);
    if (family === 4) return isPrivateIPv4(ip);
    if (family === 6) return isPrivateIPv6(ip);
    return false;
}

async function assertSafeHostname(hostname) {
    const host = String(hostname || '').toLowerCase().trim();
    if (!host) throw new BlockedUrlError('Missing hostname.', 'missing_hostname');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
        throw new BlockedUrlError('Local addresses are blocked.', 'localhost_blocked');
    }

    if (net.isIP(host) && isPrivateIp(host)) {
        throw new BlockedUrlError('Private IP addresses are blocked.', 'private_ip_blocked');
    }

    const records = await dns.lookup(host, { all: true }).catch(() => []);
    if (records.length === 0) return;
    for (const record of records) {
        if (isPrivateIp(record.address)) {
            throw new BlockedUrlError('Resolved to private/internal address.', 'resolved_private_ip_blocked');
        }
    }
}

function assertAllowedContentType(contentType) {
    const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
    const ok = ALLOWED_CONTENT_TYPES.includes(normalized);
    if (!ok) {
        throw new Error(`Unsupported content type: ${normalized || 'unknown'}`);
    }
    return normalized;
}

async function fetchFollowingRedirects(inputUrl, signal) {
    let current = inputUrl;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const response = await fetch(current, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ChaqGPT/1.0)',
                Accept: 'text/html,application/xhtml+xml,text/plain,application/json,application/xml,*/*',
            },
            signal,
            redirect: 'manual',
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) throw new Error('Redirect response missing location header.');
            const nextUrl = new URL(location, current).toString();
            const nextParsed = new URL(nextUrl);
            await assertSafeHostname(nextParsed.hostname);
            current = nextUrl;
            continue;
        }

        return { response, finalUrl: current };
    }
    throw new Error(`Too many redirects (>${MAX_REDIRECTS}).`);
}

async function fetchUrlContent(url, maxLength = MAX_TEXT_LENGTH) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('Invalid URL format.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http and https URLs are supported.');
    }

    await assertSafeHostname(parsed.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const { response, finalUrl } = await fetchFollowingRedirects(url, controller.signal);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const rawContentType = String(response.headers.get('content-type') || '');
        const contentType = assertAllowedContentType(rawContentType);
        const contentLengthHeader = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(contentLengthHeader) && contentLengthHeader > MAX_HTML_SIZE) {
            throw new Error(`Content length exceeds allowed limit (${MAX_HTML_SIZE} bytes).`);
        }

        const rawText = await response.text();
        const limitedRawText = rawText.length > MAX_HTML_SIZE ? rawText.slice(0, MAX_HTML_SIZE) : rawText;
        const isHtml = contentType.includes('html') || contentType.includes('xml');

        const title = isHtml ? extractTitle(limitedRawText) : '';
        const language = isHtml ? extractLanguage(limitedRawText) : '';
        const estimatedPublishedAt = isHtml ? extractEstimatedPublishedAt(limitedRawText) : null;

        let text;
        let extractionMethod = 'fallback-text';
        if (isHtml) {
            const extracted = extractReadableBlock(limitedRawText);
            extractionMethod = extracted.method;
            text = htmlToText(extracted.html);
        } else {
            text = limitedRawText;
        }

        const finalText = String(text || '').slice(0, maxLength);
        return {
            title,
            text: finalText,
            url: finalUrl,
            truncated: String(text || '').length > maxLength || rawText.length > MAX_HTML_SIZE,
            metadata: {
                contentType,
                language: language || null,
                estimatedPublishedAt,
                wordCount: wordCount(finalText),
            },
            extraction: {
                method: extractionMethod,
            },
            safety: {
                blockedReason: null,
            },
        };
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url, maxLength } = req.body || {};
    if (!url || !String(url).trim()) {
        return res.status(400).json({ error: 'Missing "url" in request body.' });
    }

    const limit = Math.min(
        Math.max(1000, Number(maxLength) || MAX_TEXT_LENGTH),
        MAX_TEXT_LENGTH,
    );

    try {
        const result = await fetchUrlContent(String(url).trim(), limit);
        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof BlockedUrlError) {
            return res.status(403).json({
                error: 'Blocked URL target',
                details: error.message,
                safety: { blockedReason: error.blockedReason || 'blocked_target' },
            });
        }
        console.error('Fetch URL error:', error.message);
        return res.status(502).json({
            error: 'Failed to fetch URL',
            details: error.message,
            safety: { blockedReason: null },
        });
    }
};

module.exports.fetchUrlContent = fetchUrlContent;
module.exports.__test = {
    isPrivateIp,
    extractReadableBlock,
    htmlToText,
};
