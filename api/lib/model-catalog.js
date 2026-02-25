const { getOpenRouterModels } = require('./openrouter-models');
const { getGroqModels } = require('./groq-models');

const CATEGORY_ORDER = {
    'Image Generation': 0,
    Vision: 1,
    Reasoning: 2,
    Coding: 3,
    General: 4,
};

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    return Boolean(value);
}

function normalizeCapabilities(capabilities = {}) {
    return {
        reasoning: toBoolean(capabilities.reasoning),
        visionInput: toBoolean(capabilities.visionInput),
        imageOutput: toBoolean(capabilities.imageOutput),
        fileInputPdf: toBoolean(capabilities.fileInputPdf),
        textChat: toBoolean(capabilities.textChat, true),
        toolUse: toBoolean(capabilities.toolUse),
    };
}

function scopeModel(provider, providerLabel, model) {
    const upstreamModelId = String(model?.id || '').trim();
    if (!upstreamModelId) return null;

    return {
        ...model,
        id: `${provider}::${upstreamModelId}`,
        provider,
        providerLabel,
        upstreamModelId,
        capabilities: normalizeCapabilities(model?.capabilities),
    };
}

function sortMergedModels(models) {
    return [...models].sort((a, b) => {
        const orderA = CATEGORY_ORDER[a.category] ?? 99;
        const orderB = CATEGORY_ORDER[b.category] ?? 99;
        if (orderA !== orderB) return orderA - orderB;

        const byName = String(a.name || '').localeCompare(String(b.name || ''));
        if (byName !== 0) return byName;

        return String(a.providerLabel || '').localeCompare(String(b.providerLabel || ''));
    });
}

function asProviderMetaError(error) {
    return {
        fetchedAt: null,
        isStale: true,
        source: 'error',
        error: String(error?.message || 'Unknown provider error'),
    };
}

async function getModelCatalog() {
    const [openRouterResult, groqResult] = await Promise.allSettled([
        getOpenRouterModels(),
        getGroqModels(),
    ]);

    const providerMeta = {};
    const merged = [];

    if (openRouterResult.status === 'fulfilled') {
        const payload = openRouterResult.value;
        providerMeta.openrouter = payload.meta;
        merged.push(...(payload.models || []).map((model) => scopeModel('openrouter', 'OpenRouter', model)).filter(Boolean));
    } else {
        providerMeta.openrouter = asProviderMetaError(openRouterResult.reason);
    }

    if (groqResult.status === 'fulfilled') {
        const payload = groqResult.value;
        providerMeta.groq = payload.meta;
        merged.push(...(payload.models || []).map((model) => scopeModel('groq', 'Groq', model)).filter(Boolean));
    } else {
        providerMeta.groq = asProviderMetaError(groqResult.reason);
    }

    if (merged.length === 0) {
        const error = new Error('No model providers are currently available.');
        error.providerMeta = providerMeta;
        throw error;
    }

    const fetchedTimes = Object.values(providerMeta)
        .map((meta) => Date.parse(String(meta?.fetchedAt || '')))
        .filter((ts) => Number.isFinite(ts));

    const isStale = Object.values(providerMeta).some((meta) => Boolean(meta?.isStale) || meta?.source === 'error');

    return {
        models: sortMergedModels(merged),
        meta: {
            fetchedAt: fetchedTimes.length > 0 ? new Date(Math.max(...fetchedTimes)).toISOString() : null,
            isStale,
            providers: providerMeta,
        },
    };
}

function resolveLegacyModel(models, rawModelId) {
    const raw = String(rawModelId || '').trim();
    if (!raw) return null;

    const openRouterPreferred = models.find((model) => model.provider === 'openrouter' && model.upstreamModelId === raw);
    if (openRouterPreferred) return openRouterPreferred;

    return models.find((model) => model.upstreamModelId === raw) || null;
}

async function getModelById(modelId) {
    if (!modelId) return null;
    const { models } = await getModelCatalog();
    const target = String(modelId).trim();

    const exact = models.find((model) => model.id === target);
    if (exact) return exact;

    if (target.includes('::')) {
        const [provider, upstream] = target.split('::');
        const scoped = models.find((model) => model.provider === provider && model.upstreamModelId === upstream);
        if (scoped) return scoped;
    }

    return resolveLegacyModel(models, target);
}

module.exports = {
    getModelCatalog,
    getModelById,
};
