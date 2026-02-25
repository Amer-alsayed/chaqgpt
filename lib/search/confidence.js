function average(values) {
    if (!values.length) return 0;
    const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
    return total / values.length;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
}

function computeSearchConfidence(options = {}) {
    const ranked = Array.isArray(options.ranked) ? options.ranked : [];
    const top = ranked.slice(0, 5);

    if (top.length === 0) {
        return {
            score: 0,
            level: 'low',
            isFallback: true,
            reasons: ['no_results'],
        };
    }

    const avgScore = average(top.map((item) => item.score));
    const avgEntityCoverage = average(top.map((item) => item.entityCoverage));
    const avgTrust = average(top.map((item) => item.trustScore));
    const uniqueDomains = new Set(top.map((item) => item.domain).filter(Boolean)).size;
    const diversity = top.length > 0 ? uniqueDomains / top.length : 0;
    const spreadBase = Number(top[0]?.score || 0);
    const spreadTail = Number(top[Math.min(top.length - 1, 2)]?.score || 0);
    const scoreSpread = Math.max(0, spreadBase - spreadTail);

    const normalizedSpread = clamp01(1 - scoreSpread);
    const confidenceScore = clamp01(
        (avgScore * 0.35) +
        (avgEntityCoverage * 0.25) +
        (avgTrust * 0.2) +
        (diversity * 0.1) +
        (normalizedSpread * 0.1),
    );

    let level = 'low';
    if (confidenceScore >= 0.72) level = 'high';
    else if (confidenceScore >= 0.48) level = 'medium';

    const reasons = [];
    if (avgEntityCoverage < 0.4) reasons.push('weak_entity_match');
    if (avgTrust < 0.55) reasons.push('low_source_quality');
    if (diversity < 0.25) reasons.push('low_domain_diversity');
    if (top.length < 3) reasons.push('low_result_count');

    const isFallback = level === 'low' || top.length < 2;
    return {
        score: Number(confidenceScore.toFixed(3)),
        level,
        isFallback,
        reasons,
        details: {
            avgScore: Number(avgScore.toFixed(3)),
            avgEntityCoverage: Number(avgEntityCoverage.toFixed(3)),
            avgTrust: Number(avgTrust.toFixed(3)),
            diversity: Number(diversity.toFixed(3)),
            scoreSpread: Number(scoreSpread.toFixed(3)),
        },
    };
}

module.exports = {
    computeSearchConfidence,
};
