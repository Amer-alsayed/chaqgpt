const { withGroqFailover, getConfiguredGroqKeys } = require('./groq-key-pool');

const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';

const FRESH_TTL_MS = 15 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROBE_CONCURRENCY = 4;
const DEFAULT_PROBE_MAX_ATTEMPTS = 2;

const cache = {
    models: null,
    fetchedAt: 0,
};

function readPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function inferCodingLabel(id, name, description) {
    const haystack = `${id} ${name} ${description}`.toLowerCase();
    return haystack.includes('code') || haystack.includes('coder') || haystack.includes('programming');
}

function inferReasoning(id, name) {
    const haystack = `${id} ${name}`.toLowerCase();
    return /\b(r1|o1|o3)\b/.test(haystack)
        || haystack.includes('reason')
        || haystack.includes('thinking')
        || haystack.includes('deepseek-r1')
        || haystack.includes('gpt-oss')
        || haystack.includes('kimi-k2');
}

function inferVisionInput(id, name) {
    const haystack = `${id} ${name}`.toLowerCase();
    return haystack.includes('vision')
        || haystack.includes('-vl')
        || haystack.includes('/vl')
        || haystack.includes('llava')
        || haystack.includes('pixtral')
        || haystack.includes('qvq')
        || haystack.includes('maverick')
        || haystack.includes('scout');
}

function inferImageOutput(id, name) {
    const haystack = `${id} ${name}`.toLowerCase();
    return haystack.includes('image-generation')
        || haystack.includes('stable-diffusion')
        || haystack.includes('flux');
}

function toReadableName(modelId) {
    return String(modelId || '').trim() || 'Unknown Groq Model';
}

function toCapabilityModel(model) {
    const upstreamId = String(model?.id || '');
    const name = toReadableName(upstreamId);
    const description = `${String(model?.owned_by || 'Groq')} model served by GroqCloud.`;

    const supportsVisionInput = inferVisionInput(upstreamId, name);
    const supportsReasoning = inferReasoning(upstreamId, name);
    const supportsImageOutput = inferImageOutput(upstreamId, name);

    let category = 'General';
    if (supportsImageOutput) {
        category = 'Image Generation';
    } else if (supportsVisionInput) {
        category = 'Vision';
    } else if (supportsReasoning) {
        category = 'Reasoning';
    } else if (inferCodingLabel(upstreamId, name, description)) {
        category = 'Coding';
    }

    return {
        id: upstreamId,
        name,
        description,
        category,
        badge: 'free',
        capabilities: {
            reasoning: supportsReasoning,
            visionInput: supportsVisionInput,
            imageOutput: supportsImageOutput,
            fileInputPdf: false,
            textChat: true,
            toolUse: false,
        },
        pricing: null,
    };
}

function sortModels(models) {
    const categoryOrder = {
        'Image Generation': 0,
        Vision: 1,
        Reasoning: 2,
        Coding: 3,
        General: 4,
    };

    return [...models].sort((a, b) => {
        const orderA = categoryOrder[a.category] ?? 99;
        const orderB = categoryOrder[b.category] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
    });
}

async function mapWithConcurrency(items, concurrency, task) {
    const limit = Math.max(1, Number(concurrency) || 1);
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) break;
            // eslint-disable-next-line no-await-in-loop
            results[index] = await task(items[index], index);
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i += 1) {
        workers.push(worker());
    }
    await Promise.all(workers);
    return results;
}

function parseJsonSafe(text) {
    try {
        return JSON.parse(String(text || ''));
    } catch {
        return null;
    }
}

function classifyProbeOutcome(failoverResult) {
    const failure = failoverResult?.lastFailure || {};
    if (failure.type === 'config') return { status: 'fatal', reason: 'config' };

    if (failure.type === 'response') {
        const status = Number(failure.status || 0);
        const payload = parseJsonSafe(failure.errorText);
        const message = String(payload?.error?.message || failure.errorText || '').toLowerCase();

        if (status === 400) {
            if (message.includes('does not support chat completions')
                || message.includes('requires terms acceptance')
                || message.includes('terms')
                || message.includes('unsupported')) {
                return { status: 'unusable', reason: 'not-chat-usable' };
            }
        }

        if (failure.retryable || failure.category === 'rate_limit' || failure.category === 'transient' || failure.category === 'auth') {
            return { status: 'unknown', reason: failure.category || 'retryable' };
        }

        return { status: 'unusable', reason: 'non-retryable' };
    }

    if (failure.type === 'network') {
        return { status: 'unknown', reason: 'network' };
    }

    return { status: 'unknown', reason: 'unknown' };
}

async function fetchGroqModelList() {
    const failoverResult = await withGroqFailover({
        requestFactory: ({ apiKey }) => fetch(GROQ_MODELS_URL, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
        }),
    });

    if (!failoverResult.ok) {
        const message = failoverResult.lastFailure?.errorText
            ? String(failoverResult.lastFailure.errorText).slice(0, 300)
            : 'Failed to fetch Groq model list.';
        const error = new Error(message);
        error.failover = failoverResult;
        throw error;
    }

    const payload = await failoverResult.response.json();
    const models = Array.isArray(payload?.data) ? payload.data : [];
    return models.filter((model) => Boolean(model?.active));
}

async function probeGroqModelChatUsable(modelId, maxAttempts) {
    const failoverResult = await withGroqFailover({
        modelId,
        maxAttempts,
        logFailures: false,
        requestFactory: ({ apiKey }) => fetch(GROQ_CHAT_COMPLETIONS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: 'Reply with OK.' }],
                max_tokens: 1,
                temperature: 0,
            }),
        }),
    });

    if (failoverResult.ok) {
        return { status: 'usable' };
    }

    return classifyProbeOutcome(failoverResult);
}

async function fetchGroqModels() {
    const activeModels = await fetchGroqModelList();
    const probeConcurrency = readPositiveInt(process.env.GROQ_MODEL_PROBE_CONCURRENCY, DEFAULT_PROBE_CONCURRENCY);
    const probeMaxAttempts = readPositiveInt(process.env.GROQ_MODEL_PROBE_MAX_ATTEMPTS, DEFAULT_PROBE_MAX_ATTEMPTS);

    const outcomes = await mapWithConcurrency(activeModels, probeConcurrency, async (model) => {
        const outcome = await probeGroqModelChatUsable(String(model?.id || ''), probeMaxAttempts);
        return { model, outcome };
    });

    const usable = [];
    let unknownCount = 0;

    for (const item of outcomes) {
        const status = item?.outcome?.status;
        if (status === 'usable') {
            usable.push(item.model);
        } else if (status === 'fatal') {
            throw new Error('Groq key configuration is unavailable during model probing.');
        } else if (status === 'unknown') {
            unknownCount += 1;
        }
    }

    if (usable.length === 0 && unknownCount > 0) {
        throw new Error('Groq model probing was inconclusive due to transient/provider failures.');
    }

    const normalized = usable.map(toCapabilityModel).filter(Boolean);
    return sortModels(normalized);
}

async function getGroqModels() {
    const now = Date.now();
    const hasFreshCache = cache.models && (now - cache.fetchedAt) <= FRESH_TTL_MS;
    if (hasFreshCache) {
        return {
            models: cache.models,
            meta: {
                fetchedAt: new Date(cache.fetchedAt).toISOString(),
                isStale: false,
                source: 'cache',
            },
        };
    }

    const keys = getConfiguredGroqKeys();
    if (keys.length === 0) {
        const hasStaleCache = cache.models && (now - cache.fetchedAt) <= STALE_TTL_MS;
        if (hasStaleCache) {
            return {
                models: cache.models,
                meta: {
                    fetchedAt: new Date(cache.fetchedAt).toISOString(),
                    isStale: true,
                    source: 'stale-cache',
                },
            };
        }

        return {
            models: [],
            meta: {
                fetchedAt: null,
                isStale: false,
                source: 'config-missing',
            },
        };
    }

    try {
        const models = await fetchGroqModels();
        cache.models = models;
        cache.fetchedAt = now;
        return {
            models,
            meta: {
                fetchedAt: new Date(cache.fetchedAt).toISOString(),
                isStale: false,
                source: 'live',
            },
        };
    } catch (error) {
        const hasStaleCache = cache.models && (now - cache.fetchedAt) <= STALE_TTL_MS;
        if (hasStaleCache) {
            return {
                models: cache.models,
                meta: {
                    fetchedAt: new Date(cache.fetchedAt).toISOString(),
                    isStale: true,
                    source: 'stale-cache',
                },
            };
        }

        throw error;
    }
}

module.exports = {
    getGroqModels,
};
