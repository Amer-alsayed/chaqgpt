const { createProviderKeyPool } = require('./provider-key-pool');

const groqPool = createProviderKeyPool({
    providerName: 'Groq',
    apiKeysJsonEnvVar: 'GROQ_API_KEYS_JSON',
    apiKeyEnvVar: 'GROQ_API_KEY',
    apiKeysFileEnvVar: 'GROQ_API_KEYS_FILE',
    defaultKeyFileName: 'groq-apikeys.env',
    cooldownRateLimitEnvVar: 'GROQ_KEY_COOLDOWN_RATE_LIMIT_MS',
    cooldownAuthEnvVar: 'GROQ_KEY_COOLDOWN_AUTH_MS',
    cooldownTransientEnvVar: 'GROQ_KEY_COOLDOWN_TRANSIENT_MS',
    maxFailoverAttemptsEnvVar: 'GROQ_MAX_FAILOVER_ATTEMPTS',
});

async function withGroqFailover(options = {}) {
    return groqPool.withFailover(options);
}

module.exports = {
    getConfiguredGroqKeys: groqPool.getConfiguredKeys,
    pickNextGroqKey: groqPool.pickNextKey,
    classifyGroqFailure: groqPool.classifyFailure,
    withGroqFailover,
    keyFingerprint: groqPool.keyFingerprint,
    __resetForTests: groqPool.__resetForTests,
    __setKeyStateForTests: groqPool.__setKeyStateForTests,
};
