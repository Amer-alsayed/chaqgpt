const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const FRESH_TTL_MS = 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = {
    models: null,
    fetchedAt: 0,
};

function normalizeList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => String(entry || '').toLowerCase().trim())
        .filter(Boolean);
}

function parsePrice(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

function isStrictlyFree(pricing, supportsImageOutput) {
    if (!pricing || typeof pricing !== 'object') return false;

    const entries = Object.entries(pricing);
    if (entries.length === 0) return false;

    for (const [key, value] of entries) {
        const price = parsePrice(value);
        if (price === null || price !== 0) {
            return false;
        }

        if (supportsImageOutput && key.toLowerCase().includes('image') && price !== 0) {
            return false;
        }
    }

    return true;
}

function supportsReasoningByParameters(supportedParameters) {
    return supportedParameters.some((param) => {
        return param.includes('reason') || param.includes('thinking');
    });
}

function inferCodingLabel(id, name, description) {
    const haystack = `${id} ${name} ${description}`.toLowerCase();
    return haystack.includes('code') || haystack.includes('coder') || haystack.includes('programming');
}

function toCapabilityModel(model) {
    const id = String(model?.id || '');
    const name = String(model?.name || id);
    const description = String(model?.description || 'No description available');

    const inputModalities = normalizeList(model?.architecture?.input_modalities);
    const outputModalities = normalizeList(model?.architecture?.output_modalities);
    const supportedParameters = normalizeList(model?.supported_parameters);

    const supportsVisionInput = inputModalities.includes('image');
    const supportsFileInputPdf = inputModalities.includes('file') || supportedParameters.some((param) => {
        return param.includes('file') || param.includes('document');
    });
    const supportsImageOutput = outputModalities.includes('image');
    const supportsTextChat = outputModalities.includes('text') || !supportsImageOutput;

    const supportsReasoning = supportsReasoningByParameters(supportedParameters)
        || /(?:^|[\/:\-_])(r1|o1|o3)(?:[\/:\-_]|$)/i.test(id)
        || /reasoning|thinking/i.test(name);

    if (!isStrictlyFree(model?.pricing, supportsImageOutput)) {
        return null;
    }

    let category = 'General';
    if (supportsImageOutput) {
        category = 'Image Generation';
    } else if (supportsVisionInput) {
        category = 'Vision';
    } else if (supportsReasoning) {
        category = 'Reasoning';
    } else if (inferCodingLabel(id, name, description)) {
        category = 'Coding';
    }

    return {
        id,
        name,
        description,
        category,
        badge: 'free',
        capabilities: {
            reasoning: supportsReasoning,
            visionInput: supportsVisionInput,
            imageOutput: supportsImageOutput,
            fileInputPdf: supportsFileInputPdf,
            textChat: supportsTextChat,
        },
        pricing: model?.pricing || null,
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

async function fetchOpenRouterModels() {
    const response = await fetch(OPENROUTER_MODELS_URL, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenRouter models request failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const payload = await response.json();
    const normalized = (payload?.data || [])
        .map(toCapabilityModel)
        .filter(Boolean);

    return sortModels(normalized);
}

async function getOpenRouterModels() {
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

    try {
        const models = await fetchOpenRouterModels();
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

async function getModelById(modelId) {
    if (!modelId) return null;
    const { models } = await getOpenRouterModels();
    return models.find((model) => model.id === modelId) || null;
}

module.exports = {
    getOpenRouterModels,
    getModelById,
};
