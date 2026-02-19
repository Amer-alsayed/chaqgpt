const test = require('node:test');
const assert = require('node:assert/strict');

const chatHandler = require('../api/chat');

test('isExcalidrawIntent detects diagram requests', () => {
  assert.equal(chatHandler.__test.isExcalidrawIntent('show sequence diagram for mcp flow'), true);
  assert.equal(chatHandler.__test.isExcalidrawIntent('write a poem'), false);
});

test('buildExcalidrawEventPayload returns Excalidraw payload for diagram prompts', () => {
  const payload = chatHandler.__test.buildExcalidrawEventPayload([
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: [{ type: 'text', text: 'show sequence diagram explaining mcp apps' }] },
  ]);

  assert.equal(payload.toolName, 'excalidraw_create_view');
  assert.equal(payload.scene.title, 'MCP Apps — Sequence Flow');
  assert.deepEqual(payload.scene.lanes, ['User', 'Agent', 'App iframe']);
});
