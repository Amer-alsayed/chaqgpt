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
