const { createProviderKeyPool } = require('./provider-key-pool');

const openRouterPool = createProviderKeyPool({
    providerName: 'OpenRouter',
    apiKeysJsonEnvVar: 'OPENROUTER_API_KEYS_JSON',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    apiKeysFileEnvVar: 'OPENROUTER_API_KEYS_FILE',
    defaultKeyFileName: 'openrouter-apikeys.env',
    cooldownRateLimitEnvVar: 'OPENROUTER_KEY_COOLDOWN_RATE_LIMIT_MS',
    cooldownAuthEnvVar: 'OPENROUTER_KEY_COOLDOWN_AUTH_MS',
    cooldownTransientEnvVar: 'OPENROUTER_KEY_COOLDOWN_TRANSIENT_MS',
    maxFailoverAttemptsEnvVar: 'OPENROUTER_MAX_FAILOVER_ATTEMPTS',
});

async function withOpenRouterFailover(options = {}) {
    return openRouterPool.withFailover(options);
}

module.exports = {
    getConfiguredKeys: openRouterPool.getConfiguredKeys,
    pickNextKey: openRouterPool.pickNextKey,
    classifyFailure: openRouterPool.classifyFailure,
    withOpenRouterFailover,
    keyFingerprint: openRouterPool.keyFingerprint,
    __resetForTests: openRouterPool.__resetForTests,
    __setKeyStateForTests: openRouterPool.__setKeyStateForTests,
};
