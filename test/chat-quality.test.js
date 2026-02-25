const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../api/chat');

test('citationCoverageRatio detects covered sources', () => {
    const sources = [
        { url: 'https://example.com/a' },
        { url: 'https://example.com/b' },
    ];
    const answer = 'See [A](https://example.com/a) for details.';
    const ratio = chat.__test.citationCoverageRatio(answer, sources);
    assert.equal(ratio, 0.5);
});

test('ensureCitationGuard appends confidence note for weak citation coverage', () => {
    const guarded = chat.__test.ensureCitationGuard(
        'No citations here.',
        [{ url: 'https://example.com/a' }],
    );
    assert.match(guarded, /Confidence note:/);
});

test('sanitizeMessagesForProvider strips unsupported assistant metadata fields', () => {
    const sanitized = chat.__test.sanitizeMessagesForProvider([
        { role: 'user', content: 'hello' },
        {
            role: 'assistant',
            content: 'answer',
            sources: [{ title: 'Example', url: 'https://example.com' }],
            qualityMetrics: { score: 0.8 },
        },
    ]);

    assert.equal(sanitized.length, 2);
    assert.equal(sanitized[1].role, 'assistant');
    assert.equal(sanitized[1].content, 'answer');
    assert.equal(Object.prototype.hasOwnProperty.call(sanitized[1], 'sources'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(sanitized[1], 'qualityMetrics'), false);
});
