const fs = require('fs');
const path = require('path');

const DEFAULT_COOLDOWN_RATE_LIMIT_MS = 15 * 60 * 1000;
const DEFAULT_COOLDOWN_AUTH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_TRANSIENT_MS = 30 * 1000;
const DEFAULT_MAX_FAILOVER_ATTEMPTS = 10;

function readPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function stripWrappingQuotes(value) {
    const text = String(value || '').trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('\'') && text.endsWith('\''))) {
        return text.slice(1, -1).trim();
    }
    return text;
}

function normalizeKeys(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => stripWrappingQuotes(value))
        .filter(Boolean))];
}

function parseMaybeJsonArray(text) {
    const raw = String(text || '').trim();
    if (!raw || !raw.startsWith('[')) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function parseLineValue(line) {
    let raw = String(line || '').trim();
    if (!raw) return [];
    if (raw.startsWith('#')) return [];
    if (raw.startsWith('//')) return [];

    if (raw.toLowerCase().startsWith('export ')) {
        raw = raw.slice(7).trim();
    }

    const eqIndex = raw.indexOf('=');
    if (eqIndex >= 0) {
        raw = raw.slice(eqIndex + 1).trim();
    }

    if (!raw) return [];

    const arr = parseMaybeJsonArray(raw);
    if (arr) return arr;

    return [raw];
}

function parseKeysFromFileContent(content) {
    const fromLines = [];
    const lines = String(content || '').split(/\r?\n/);
    for (const line of lines) {
        fromLines.push(...parseLineValue(line));
    }
    return normalizeKeys(fromLines);
}

function resolveKeyFileCandidates({ fileEnvVarName, defaultKeyFileName }) {
    const envPathRaw = String(process.env[fileEnvVarName] || '').trim();
    if (envPathRaw) {
        const explicitPath = path.isAbsolute(envPathRaw)
            ? envPathRaw
            : path.resolve(process.cwd(), envPathRaw);
        return [explicitPath];
    }

    if (!defaultKeyFileName) return [];

    const rootPath = path.resolve(__dirname, '..', '..');
    const candidates = [
        path.resolve(process.cwd(), defaultKeyFileName),
        path.join(rootPath, defaultKeyFileName),
        path.join(rootPath, '..', defaultKeyFileName),
    ];

    return [...new Set(candidates)];
}

function readKeysFromFile({ fileEnvVarName, defaultKeyFileName }) {
    const candidates = resolveKeyFileCandidates({ fileEnvVarName, defaultKeyFileName });
    if (!candidates || candidates.length === 0) return [];

    for (const filePath of candidates) {
        try {
            if (!fs.existsSync(filePath)) continue;
            const content = fs.readFileSync(filePath, 'utf8');
            return parseKeysFromFileContent(content);
        } catch (error) {
            console.warn(`Failed reading keys file at "${filePath}": ${error.message}`);
        }
    }

    return [];
}

function createProviderKeyPool({
    providerName,
    apiKeysJsonEnvVar,
    apiKeyEnvVar,
    apiKeysFileEnvVar,
    defaultKeyFileName,
    cooldownRateLimitEnvVar,
    cooldownAuthEnvVar,
    cooldownTransientEnvVar,
    maxFailoverAttemptsEnvVar,
    defaultCooldownRateLimitMs = DEFAULT_COOLDOWN_RATE_LIMIT_MS,
    defaultCooldownAuthMs = DEFAULT_COOLDOWN_AUTH_MS,
    defaultCooldownTransientMs = DEFAULT_COOLDOWN_TRANSIENT_MS,
    defaultMaxFailoverAttempts = DEFAULT_MAX_FAILOVER_ATTEMPTS,
}) {
    const keyState = new Map();
    let rotationPointer = 0;

    function getCooldownSettings() {
        return {
            rateLimitMs: readPositiveInt(process.env[cooldownRateLimitEnvVar], defaultCooldownRateLimitMs),
            authMs: readPositiveInt(process.env[cooldownAuthEnvVar], defaultCooldownAuthMs),
            transientMs: readPositiveInt(process.env[cooldownTransientEnvVar], defaultCooldownTransientMs),
        };
    }

    function getConfiguredKeys() {
        const fromJson = [];
        const rawJson = process.env[apiKeysJsonEnvVar];
        if (rawJson && String(rawJson).trim()) {
            try {
                const parsed = JSON.parse(rawJson);
                if (Array.isArray(parsed)) {
                    fromJson.push(...parsed);
                } else {
                    console.warn(`${apiKeysJsonEnvVar} must be a JSON array. Falling back to ${apiKeyEnvVar}/${apiKeysFileEnvVar}.`);
                }
            } catch {
                console.warn(`Failed to parse ${apiKeysJsonEnvVar}. Falling back to ${apiKeyEnvVar}/${apiKeysFileEnvVar}.`);
            }
        }

        const fromJsonNormalized = normalizeKeys(fromJson);
        if (fromJsonNormalized.length > 0) return fromJsonNormalized;

        const single = stripWrappingQuotes(process.env[apiKeyEnvVar] || '');
        if (single) return [single];

        return readKeysFromFile({
            fileEnvVarName: apiKeysFileEnvVar,
            defaultKeyFileName,
        });
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
            || normalized.includes('forbidden')
            || normalized.includes('invalid_api_key');

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

        if (status >= 500 || status <= 0 || status === 408) {
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
        const cap = readPositiveInt(
            overrideMaxAttempts,
            readPositiveInt(process.env[maxFailoverAttemptsEnvVar], defaultMaxFailoverAttempts),
        );
        if (configuredKeyCount <= 0) return 0;
        return Math.min(configuredKeyCount, cap);
    }

    async function withFailover({ requestFactory, maxAttempts, modelId, logFailures = true } = {}) {
        const keys = getConfiguredKeys();
        if (keys.length === 0) {
            return {
                ok: false,
                provider: providerName,
                attempts: [],
                lastFailure: {
                    type: 'config',
                    message: `No ${providerName} API keys configured.`,
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
                        provider: providerName,
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

                if (logFailures) {
                    console.warn(`[${providerName}] key ${fingerprint} failed with status ${status} (${failure.category}).`);
                }

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

                if (logFailures) {
                    console.warn(`[${providerName}] key ${fingerprint} network failure (${failure.category}).`);
                }

                if (!failure.retryable) break;
            }
        }

        return {
            ok: false,
            provider: providerName,
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

    return {
        getConfiguredKeys,
        pickNextKey,
        classifyFailure,
        withFailover,
        keyFingerprint,
        __resetForTests,
        __setKeyStateForTests,
    };
}

module.exports = {
    createProviderKeyPool,
};
