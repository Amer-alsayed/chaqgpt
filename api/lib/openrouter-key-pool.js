const DEFAULT_COOLDOWN_RATE_LIMIT_MS = 15 * 60 * 1000;
const DEFAULT_COOLDOWN_AUTH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_TRANSIENT_MS = 30 * 1000;
const DEFAULT_MAX_FAILOVER_ATTEMPTS = 10;

const keyState = new Map();
let rotationPointer = 0;

function readPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function getCooldownSettings() {
    return {
        rateLimitMs: readPositiveInt(process.env.OPENROUTER_KEY_COOLDOWN_RATE_LIMIT_MS, DEFAULT_COOLDOWN_RATE_LIMIT_MS),
        authMs: readPositiveInt(process.env.OPENROUTER_KEY_COOLDOWN_AUTH_MS, DEFAULT_COOLDOWN_AUTH_MS),
        transientMs: readPositiveInt(process.env.OPENROUTER_KEY_COOLDOWN_TRANSIENT_MS, DEFAULT_COOLDOWN_TRANSIENT_MS),
    };
}

function getConfiguredKeys() {
    const fromJson = [];
    const rawJson = process.env.OPENROUTER_API_KEYS_JSON;
    if (rawJson && String(rawJson).trim()) {
        try {
            const parsed = JSON.parse(rawJson);
            if (Array.isArray(parsed)) {
                fromJson.push(...parsed);
            } else {
                console.warn('OPENROUTER_API_KEYS_JSON must be a JSON array. Falling back to OPENROUTER_API_KEY.');
            }
        } catch {
            console.warn('Failed to parse OPENROUTER_API_KEYS_JSON. Falling back to OPENROUTER_API_KEY.');
        }
    }

    const normalized = [...new Set(fromJson
        .map((value) => String(value || '').trim())
        .filter(Boolean))];

    if (normalized.length > 0) return normalized;

    const fallback = String(process.env.OPENROUTER_API_KEY || '').trim();
    return fallback ? [fallback] : [];
}

function keyFingerprint(apiKey) {
    const key = String(apiKey || '');
    if (key.length <= 4) return `...${key}`;
    return `...${key.slice(-4)}`;
}

function ensureKeyState(apiKey) {
    if (!keyState.has(apiKey)) {
        keyState.set(apiKey, {
            cooldownUntil: 0,
            modelCooldownUntil: new Map(),
            failCount: 0,
            successCount: 0,
            lastUsedAt: 0,
        });
    }

    return keyState.get(apiKey);
}

function markKeyUsed(apiKey, usedAt = Date.now()) {
    const state = ensureKeyState(apiKey);
    state.lastUsedAt = usedAt;
}

function markKeySuccess(apiKey) {
    const state = ensureKeyState(apiKey);
    state.successCount += 1;
    state.cooldownUntil = 0;
}

function markKeyFailure(apiKey, cooldownMs, category, modelId) {
    const state = ensureKeyState(apiKey);
    state.failCount += 1;
    const cooldownUntil = Date.now() + Math.max(0, Number(cooldownMs) || 0);
    const modelKey = String(modelId || '').trim();

    if (category === 'rate_limit' && modelKey) {
        state.modelCooldownUntil.set(modelKey, cooldownUntil);
        return;
    }

    state.cooldownUntil = cooldownUntil;
}

function getEffectiveCooldownUntil(state, modelId) {
    const modelKey = String(modelId || '').trim();
    const modelCooldown = modelKey ? Number(state.modelCooldownUntil.get(modelKey) || 0) : 0;
    return Math.max(Number(state.cooldownUntil || 0), modelCooldown);
}

function pickNextKey(configuredKeys, excludedKeyIds = new Set(), modelId = '') {
    const keys = Array.isArray(configuredKeys) ? configuredKeys : [];
    if (keys.length === 0) return null;

    const now = Date.now();
    const candidates = keys.filter((key) => !excludedKeyIds.has(key));
    if (candidates.length === 0) return null;

    const startIndex = rotationPointer % keys.length;

    for (let offset = 0; offset < keys.length; offset += 1) {
        const index = (startIndex + offset) % keys.length;
        const key = keys[index];
        if (excludedKeyIds.has(key)) continue;

        const state = ensureKeyState(key);
        const effectiveCooldown = getEffectiveCooldownUntil(state, modelId);
        if (effectiveCooldown <= now) {
            rotationPointer = (index + 1) % keys.length;
            return {
                apiKey: key,
                state,
                effectiveCooldownUntil: effectiveCooldown,
                coolingDown: false,
            };
        }
    }

    let earliest = null;
    for (const key of candidates) {
        const state = ensureKeyState(key);
        const effectiveCooldown = getEffectiveCooldownUntil(state, modelId);
        if (!earliest || effectiveCooldown < earliest.effectiveCooldownUntil) {
            earliest = { apiKey: key, state, effectiveCooldownUntil: effectiveCooldown };
        }
    }

    if (!earliest) return null;

    const earliestIndex = keys.indexOf(earliest.apiKey);
    if (earliestIndex >= 0) {
        rotationPointer = (earliestIndex + 1) % keys.length;
    }

    return {
        apiKey: earliest.apiKey,
        state: earliest.state,
        effectiveCooldownUntil: earliest.effectiveCooldownUntil,
        coolingDown: true,
    };
}

function classifyFailure(status, errorPayloadText) {
    const { rateLimitMs, authMs, transientMs } = getCooldownSettings();
    const normalized = String(errorPayloadText || '').toLowerCase();

    const hasRateSignal = normalized.includes('rate limit')
        || normalized.includes('ratelimit')
        || normalized.includes('quota')
        || normalized.includes('too many requests');

    const hasAuthSignal = normalized.includes('invalid api key')
        || normalized.includes('insufficient credits')
        || normalized.includes('insufficient credit')
        || normalized.includes('unauthorized')
        || normalized.includes('forbidden');

    if (status === 429 || hasRateSignal) {
        return {
            retryable: true,
            category: 'rate_limit',
            cooldownMs: rateLimitMs,
        };
    }

    if (status === 401 || status === 403 || hasAuthSignal) {
        return {
            retryable: true,
            category: 'auth',
            cooldownMs: authMs,
        };
    }

    if (status >= 500 || status <= 0) {
        return {
            retryable: true,
            category: 'transient',
            cooldownMs: transientMs,
        };
    }

    return {
        retryable: false,
        category: 'non_retryable',
        cooldownMs: 0,
    };
}

function resolveMaxAttempts(configuredKeyCount, overrideMaxAttempts) {
    const cap = readPositiveInt(overrideMaxAttempts, readPositiveInt(process.env.OPENROUTER_MAX_FAILOVER_ATTEMPTS, DEFAULT_MAX_FAILOVER_ATTEMPTS));
    if (configuredKeyCount <= 0) return 0;
    return Math.min(configuredKeyCount, cap);
}

async function withOpenRouterFailover({ requestFactory, maxAttempts, modelId } = {}) {
    const keys = getConfiguredKeys();
    if (keys.length === 0) {
        return {
            ok: false,
            attempts: [],
            lastFailure: {
                type: 'config',
                message: 'No OpenRouter API keys configured.',
            },
        };
    }

    const attemptLimit = resolveMaxAttempts(keys.length, maxAttempts);
    const excluded = new Set();
    const attempts = [];
    let lastFailure = null;

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
        const picked = pickNextKey(keys, excluded, modelId);
        if (!picked) break;

        const key = picked.apiKey;
        const fingerprint = keyFingerprint(key);
        excluded.add(key);
        markKeyUsed(key);

        try {
            const response = await requestFactory({
                apiKey: key,
                keyFingerprint: fingerprint,
                attempt,
            });

            if (response?.ok) {
                markKeySuccess(key);
                attempts.push({
                    attempt,
                    keyFingerprint: fingerprint,
                    success: true,
                    status: response.status,
                });
                return {
                    ok: true,
                    response,
                    attempts,
                };
            }

            let errorText = '';
            try {
                errorText = await response.text();
            } catch {
                errorText = '';
            }

            const status = Number(response?.status || 0);
            const failure = classifyFailure(status, errorText);
            markKeyFailure(key, failure.cooldownMs, failure.category, modelId);

            attempts.push({
                attempt,
                keyFingerprint: fingerprint,
                success: false,
                status,
                category: failure.category,
                retryable: failure.retryable,
            });

            lastFailure = {
                type: 'response',
                status,
                errorText,
                category: failure.category,
                retryable: failure.retryable,
                keyFingerprint: fingerprint,
            };

            console.warn(`[OpenRouter] key ${fingerprint} failed with status ${status} (${failure.category}).`);

            if (!failure.retryable) break;
        } catch (error) {
            const failure = classifyFailure(0, error?.message || '');
            markKeyFailure(key, failure.cooldownMs, failure.category, modelId);

            attempts.push({
                attempt,
                keyFingerprint: fingerprint,
                success: false,
                status: 0,
                category: failure.category,
                retryable: failure.retryable,
            });

            lastFailure = {
                type: 'network',
                status: 0,
                errorText: String(error?.message || 'Network error'),
                category: failure.category,
                retryable: failure.retryable,
                keyFingerprint: fingerprint,
            };

            console.warn(`[OpenRouter] key ${fingerprint} network failure (${failure.category}).`);

            if (!failure.retryable) break;
        }
    }

    return {
        ok: false,
        attempts,
        lastFailure,
    };
}

function __resetForTests() {
    keyState.clear();
    rotationPointer = 0;
}

function __setKeyStateForTests(apiKey, partialState = {}) {
    const state = ensureKeyState(apiKey);
    const next = { ...partialState };
    if (next.modelCooldownUntil && !(next.modelCooldownUntil instanceof Map)) {
        next.modelCooldownUntil = new Map(Object.entries(next.modelCooldownUntil));
    }
    Object.assign(state, next);
}

module.exports = {
    getConfiguredKeys,
    pickNextKey,
    classifyFailure,
    withOpenRouterFailover,
    keyFingerprint,
    __resetForTests,
    __setKeyStateForTests,
};
