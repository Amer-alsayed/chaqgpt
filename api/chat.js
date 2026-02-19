const { getModelById } = require('./lib/openrouter-models');
const { withOpenRouterFailover } = require('./lib/openrouter-key-pool');
const { TOOL_DEFINITIONS, executeTool, buildSearchContext } = require('./lib/tools');

const MAX_TOOL_ROUNDS = 6;
const MAX_TOOL_CALLS_TOTAL = 6;
const MAX_TOOL_CALLS_PER_TOOL = {
    search_web: 4,
    fetch_url: 3,
    verify_claims: 2,
    execute_code: 2,
    get_current_datetime: 1,
};
const MAX_AGENT_WALL_TIME_MS = 25_000;

function extractUserText(messageContent) {
    if (typeof messageContent === 'string') return messageContent;
    if (!Array.isArray(messageContent)) return '';
    return messageContent
        .filter((part) => part?.type === 'text')
        .map((part) => String(part.text || ''))
        .join(' ')
        .trim();
}

function isExcalidrawIntent(text) {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) return false;
    return /(diagram|sequence|flow|architecture|workflow|timeline|excalidraw|draw|chart)/.test(normalized);
}

function buildExcalidrawEventPayload(messages) {
    const lastUser = getLastUserMessageContent(messages || []);
    const promptText = extractUserText(lastUser);
    if (!isExcalidrawIntent(promptText)) return null;

    const encodedPrompt = encodeURIComponent(promptText);
    const remoteAppBase = 'https://mcp.excalidraw.com';

    return {
        toolName: 'excalidraw_create_view',
        app: {
            kind: 'mcp_app_iframe',
            title: 'Excalidraw MCP App',
            description: 'Interactive Excalidraw canvas with fullscreen editing.',
            remoteServer: remoteAppBase,
            iframeUrl: `${remoteAppBase}/?prompt=${encodedPrompt}`,
            openUrl: `${remoteAppBase}/?prompt=${encodedPrompt}`,
            fallbackUrl: `https://excalidraw.com/#?prompt=${encodedPrompt}`,
            prompt: promptText,
        },
    };
}

async function pipeStream(readable, writable) {
    const reader = readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            writable.end();
            break;
        }
        writable.write(value);
    }
}

function streamTextAsSSE(response, text) {
    const words = String(text || '').split(/( +)/);
    const CHUNK_SIZE = 3;
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
        const chunk = words.slice(i, i + CHUNK_SIZE).join('');
        const sseData = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
        response.write(`data: ${sseData}\n\n`);
    }
    response.write('data: [DONE]\n\n');
    response.end();
}

function inspectMessageFeatures(messages) {
    let hasImages = false;
    let hasFiles = false;
    let hasNonPdfFile = false;

    for (const message of messages || []) {
        if (!Array.isArray(message?.content)) continue;
        for (const part of message.content) {
            const type = String(part?.type || '').toLowerCase();
            if (type === 'image_url') hasImages = true;
            if (type === 'file') {
                hasFiles = true;
                const fileName = String(part?.file?.filename || '').toLowerCase();
                const fileData = String(part?.file?.file_data || '').toLowerCase();
                const isPdf = fileName.endsWith('.pdf') || fileData.startsWith('data:application/pdf');
                if (!isPdf) hasNonPdfFile = true;
            }
        }
    }

    return { hasImages, hasFiles, hasNonPdfFile };
}

function parseErrorText(errorText) {
    const text = String(errorText || '');
    if (!text) return { error: { message: 'Upstream request failed' } };
    try {
        return JSON.parse(text);
    } catch {
        return { error: { message: text.slice(0, 500) } };
    }
}

function getLastUserMessageContent(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') return messages[i].content;
    }
    return '';
}

function sendSSEEvent(response, event, data) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startSSEStream(response) {
    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
}

function canonicalizeUrl(url) {
    try {
        const u = new URL(String(url || ''));
        u.hash = '';
        return u.toString();
    } catch {
        return String(url || '').trim();
    }
}

function extractCitedUrls(answerText) {
    const urls = new Set();
    const markdownLinkRegex = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gi;
    let match;
    while ((match = markdownLinkRegex.exec(String(answerText || '')))) {
        urls.add(canonicalizeUrl(match[1]));
    }
    return urls;
}

function citationCoverageRatio(answerText, sources) {
    const cited = extractCitedUrls(answerText);
    if (!sources || sources.length === 0) return 0;
    let matched = 0;
    for (const source of sources) {
        if (cited.has(canonicalizeUrl(source.url))) matched += 1;
    }
    return matched / sources.length;
}

function synthesizeFromSources(sources) {
    if (!sources || sources.length === 0) return '';
    const items = sources
        .filter((s) => s.snippet)
        .slice(0, 8)
        .map((s) => `- **[${s.title}](${s.url})**: ${s.snippet}`)
        .join('\n');
    return items ? `Here's what I found from web sources:\n\n${items}` : '';
}

function ensureCitationGuard(answerText, sources) {
    const coverage = citationCoverageRatio(answerText, sources);
    if (coverage >= 0.3) return answerText;
    return `${answerText}\n\nConfidence note: Evidence coverage is limited for some claims. Please verify critical facts directly from the cited sources.`;
}

async function runOpenRouterCompletion(request, model, messages, { tools = null, stream = false, maxTokens = 4096 } = {}) {
    const referer = request.headers.origin || 'http://localhost:3000';
    const failoverResult = await withOpenRouterFailover({
        modelId: model,
        requestFactory: ({ apiKey }) => fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'HTTP-Referer': referer,
                'X-Title': 'ChaqGPT',
            },
            body: JSON.stringify({
                model,
                messages,
                tools: tools || undefined,
                max_tokens: maxTokens,
                stream,
            }),
        }),
    });
    return failoverResult;
}

async function forceTextCompletion(request, model, messages, options = {}) {
    const result = await runOpenRouterCompletion(request, model, messages, {
        stream: false,
        maxTokens: Number(options.maxTokens) || 3072,
    });
    if (!result.ok) return '';
    try {
        const payload = await result.response.json();
        return String(payload?.choices?.[0]?.message?.content || '').trim();
    } catch {
        return '';
    }
}

function addSource(sourceMap, source) {
    if (!source?.url || !source?.title) return;
    const key = canonicalizeUrl(source.url);
    if (!key) return;
    if (!sourceMap.has(key)) {
        sourceMap.set(key, {
            id: `S${sourceMap.size + 1}`,
            title: source.title,
            url: key,
            snippet: source.snippet || '',
            score: source.score,
            trustScore: source.trustScore,
            freshnessScore: source.freshnessScore,
            evidenceQuality: source.evidenceQuality,
            sourceEngine: source.sourceEngine,
        });
    }
}

function structuredMetricLog(data) {
    console.log(`[AgenticMetrics] ${JSON.stringify(data)}`);
}

async function agenticLoop(request, model, messages) {
    const today = new Date().toISOString().split('T')[0];
    const deadline = Date.now() + MAX_AGENT_WALL_TIME_MS;
    let totalToolCalls = 0;
    const perToolCalls = new Map();
    const sourceMap = new Map();
    const metrics = {
        tool_error_count: 0,
        contradiction_rate: 0,
        citation_coverage_ratio: 0,
        sources_count: 0,
        high_trust_sources_count: 0,
    };

    let currentMessages = [
        {
            role: 'system',
            content:
                `You are an evidence-first assistant with access to web tools. Today's date is ${today}.\n` +
                `Tool limits are strict: max ${MAX_TOOL_CALLS_TOTAL} total calls, and per-tool limits apply.\n` +
                `Prioritize high-trust and recent sources, cite URLs inline as [Title](URL), and clearly flag uncertainty when evidence is weak.\n` +
                `Use execute_code only when computation materially increases correctness.`,
        },
        ...messages,
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (Date.now() > deadline) {
            metrics.tool_error_count += 1;
            break;
        }

        const callResult = await runOpenRouterCompletion(request, model, currentMessages, {
            tools: TOOL_DEFINITIONS,
            stream: false,
            maxTokens: 3072,
        });
        if (!callResult.ok) {
            metrics.tool_error_count += 1;
            break;
        }

        let payload;
        try {
            payload = await callResult.response.json();
        } catch {
            metrics.tool_error_count += 1;
            break;
        }

        const message = payload?.choices?.[0]?.message;
        if (!message) {
            metrics.tool_error_count += 1;
            break;
        }

        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        if (toolCalls.length === 0) {
            const answer = ensureCitationGuard(String(message.content || '').trim(), [...sourceMap.values()]);
            if (answer) {
                metrics.sources_count = sourceMap.size;
                metrics.high_trust_sources_count = [...sourceMap.values()].filter((s) => Number(s.trustScore || 0) >= 0.8 || s.evidenceQuality === 'high').length;
                metrics.citation_coverage_ratio = citationCoverageRatio(answer, [...sourceMap.values()]);
                structuredMetricLog(metrics);
                return { ok: true, answer, sources: [...sourceMap.values()], metrics };
            }
            break;
        }

        currentMessages.push(message);

        for (const toolCall of toolCalls) {
            const toolName = toolCall.function?.name;
            const toolArgs = toolCall.function?.arguments;

            const existing = perToolCalls.get(toolName) || 0;
            const cap = MAX_TOOL_CALLS_PER_TOOL[toolName] || 1;

            if (Date.now() > deadline) {
                metrics.tool_error_count += 1;
                currentMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: 'Tool budget expired for this turn.' }),
                });
                continue;
            }

            if (totalToolCalls >= MAX_TOOL_CALLS_TOTAL) {
                metrics.tool_error_count += 1;
                currentMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: 'Tool call limit reached. Continue with available evidence.' }),
                });
                continue;
            }

            if (existing >= cap) {
                metrics.tool_error_count += 1;
                currentMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: `Tool "${toolName}" cap reached.` }),
                });
                continue;
            }

            totalToolCalls += 1;
            perToolCalls.set(toolName, existing + 1);

            const toolResultText = await executeTool(toolName, toolArgs, {
                maxCodeSize: 20_000,
                maxRuntimeMs: 10_000,
                maxStdoutBytes: 16_000,
                allowedLanguages: [
                    'python', 'python3', 'javascript', 'js', 'typescript', 'ts',
                    'c', 'cpp', 'c++', 'java', 'go', 'golang', 'rust', 'ruby',
                    'swift', 'haskell', 'scala', 'zig', 'pascal', 'fortran',
                    'ocaml', 'erlang',
                ],
            });

            try {
                const parsed = JSON.parse(toolResultText);
                if (toolName === 'search_web' && Array.isArray(parsed.results)) {
                    parsed.results.forEach((s) => addSource(sourceMap, s));
                } else if (toolName === 'fetch_url' && parsed.url && parsed.title) {
                    addSource(sourceMap, parsed);
                } else if (toolName === 'verify_claims' && Array.isArray(parsed.verdicts)) {
                    for (const verdict of parsed.verdicts) {
                        if (Array.isArray(verdict.sources)) {
                            verdict.sources.forEach((s) => addSource(sourceMap, s));
                        }
                    }
                }
            } catch {
                metrics.tool_error_count += 1;
            }

            currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolResultText,
            });
        }
    }

    const forcedMessages = [
        ...currentMessages,
        {
            role: 'system',
            content:
                'Write your best final answer now based on gathered evidence. Do not call tools. ' +
                'Cite sources inline and clearly state uncertainty for weakly-supported claims.',
        },
    ];

    const forcedAnswerRaw = await forceTextCompletion(request, model, forcedMessages, { maxTokens: 3072 });
    if (forcedAnswerRaw) {
        const answer = ensureCitationGuard(forcedAnswerRaw, [...sourceMap.values()]);
        metrics.sources_count = sourceMap.size;
        metrics.high_trust_sources_count = [...sourceMap.values()].filter((s) => Number(s.trustScore || 0) >= 0.8 || s.evidenceQuality === 'high').length;
        metrics.citation_coverage_ratio = citationCoverageRatio(answer, [...sourceMap.values()]);
        structuredMetricLog(metrics);
        return { ok: true, answer, sources: [...sourceMap.values()], metrics };
    }

    const lastUserContent = getLastUserMessageContent(messages);
    const contextFallback = await buildSearchContext(lastUserContent);
    if (contextFallback?.message) {
        const contextMessages = [
            contextFallback.message,
            ...messages,
            {
                role: 'system',
                content: 'Write a concise, factual answer with inline citations. Do not list raw search snippets.',
            },
        ];
        const contextAnswer = await forceTextCompletion(request, model, contextMessages, { maxTokens: 2048 });
        if (contextAnswer) {
            for (const src of contextFallback.sources || []) addSource(sourceMap, src);
            const answer = ensureCitationGuard(contextAnswer, [...sourceMap.values()]);
            metrics.sources_count = sourceMap.size;
            metrics.high_trust_sources_count = [...sourceMap.values()].filter((s) => Number(s.trustScore || 0) >= 0.8 || s.evidenceQuality === 'high').length;
            metrics.citation_coverage_ratio = citationCoverageRatio(answer, [...sourceMap.values()]);
            structuredMetricLog(metrics);
            return { ok: true, answer, sources: [...sourceMap.values()], metrics };
        }
    }

    const synthesized = synthesizeFromSources([...sourceMap.values()]);
    if (synthesized) {
        metrics.sources_count = sourceMap.size;
        metrics.high_trust_sources_count = [...sourceMap.values()].filter((s) => Number(s.trustScore || 0) >= 0.8 || s.evidenceQuality === 'high').length;
        metrics.citation_coverage_ratio = citationCoverageRatio(synthesized, [...sourceMap.values()]);
        structuredMetricLog(metrics);
        return { ok: true, answer: synthesized, sources: [...sourceMap.values()], metrics };
    }

    structuredMetricLog(metrics);
    return { ok: false, error: 'Search completed but failed to generate a response.' };
}

module.exports = async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { model, messages, searchEnabled } = request.body || {};
        if (!model || !Array.isArray(messages) || messages.length === 0) {
            return response.status(400).json({ error: 'Request must include model and messages.' });
        }

        const modelInfo = await getModelById(model);
        if (!modelInfo) {
            return response.status(400).json({ error: 'Model is unavailable or no longer free.' });
        }

        const { hasImages, hasFiles, hasNonPdfFile } = inspectMessageFeatures(messages);
        if (hasImages && !modelInfo.capabilities.visionInput) {
            return response.status(400).json({ error: 'Selected model does not support image input.' });
        }
        if (hasFiles && !modelInfo.capabilities.fileInputPdf) {
            return response.status(400).json({ error: 'Selected model does not support file input.' });
        }
        if (hasNonPdfFile) {
            return response.status(400).json({ error: 'Only PDF files are supported.' });
        }

        const excalidrawView = buildExcalidrawEventPayload(messages);

        if (searchEnabled) {
            const supportsTools = Boolean(modelInfo.capabilities.toolUse);
            if (supportsTools) {
                const result = await agenticLoop(request, model, messages);
                if (result.ok) {
                    startSSEStream(response);
                    if (excalidrawView) sendSSEEvent(response, 'excalidraw_view', excalidrawView);
                    if (result.sources?.length > 0) {
                        sendSSEEvent(response, 'sources', result.sources);
                    }
                    sendSSEEvent(response, 'quality_metrics', result.metrics || {});
                    streamTextAsSSE(response, result.answer);
                    return;
                }
            }

            const lastUserContent = getLastUserMessageContent(messages);
            const searchResult = await buildSearchContext(lastUserContent);

            let enhancedMessages = [...messages];
            let searchSources = [];
            if (searchResult) {
                enhancedMessages = [searchResult.message, ...messages];
                searchSources = searchResult.sources || [];
            }

            const failoverResult = await runOpenRouterCompletion(request, model, enhancedMessages, { stream: true });
            if (!failoverResult.ok) return handleFailoverError(response, failoverResult);

            startSSEStream(response);
            if (excalidrawView) sendSSEEvent(response, 'excalidraw_view', excalidrawView);
            if (searchSources.length > 0) sendSSEEvent(response, 'sources', searchSources);
            await pipeStream(failoverResult.response.body, response);
            return;
        }

        const failoverResult = await runOpenRouterCompletion(request, model, messages, { stream: true });
        if (!failoverResult.ok) return handleFailoverError(response, failoverResult);

        startSSEStream(response);
        if (excalidrawView) sendSSEEvent(response, 'excalidraw_view', excalidrawView);
        await pipeStream(failoverResult.response.body, response);
    } catch (error) {
        console.error('An error occurred:', error);
        if (!response.headersSent) {
            response.status(500).json({ error: 'An internal server error occurred.' });
        }
    }
};

function handleFailoverError(response, failoverResult) {
    if (failoverResult.lastFailure?.type === 'config') {
        return response.status(500).json({ error: 'API key not configured.' });
    }
    if (failoverResult.lastFailure?.type === 'response') {
        const errorData = parseErrorText(failoverResult.lastFailure.errorText);
        return response.status(failoverResult.lastFailure.status || 502).json(errorData);
    }
    return response.status(502).json({
        error: 'All OpenRouter keys failed due to network/upstream issues.',
        attempts: failoverResult.attempts?.length || 0,
    });
}

module.exports.__test = {
    citationCoverageRatio,
    extractCitedUrls,
    ensureCitationGuard,
    isExcalidrawIntent,
    buildExcalidrawEventPayload,
};
