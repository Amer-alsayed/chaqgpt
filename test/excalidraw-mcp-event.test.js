const test = require('node:test');
const assert = require('node:assert/strict');

const chatHandler = require('../api/chat');

test('isExcalidrawIntent detects diagram requests', () => {
  assert.equal(chatHandler.__test.isExcalidrawIntent('show sequence diagram for mcp flow'), true);
  assert.equal(chatHandler.__test.isExcalidrawIntent('write a poem'), false);
});

test('buildExcalidrawEventPayload returns MCP app iframe payload', () => {
  const payload = chatHandler.__test.buildExcalidrawEventPayload([
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: [{ type: 'text', text: 'draw an architecture diagram for a user, api, and database' }] },
  ]);

  assert.equal(payload.toolName, 'excalidraw_create_view');
  assert.equal(payload.app.kind, 'mcp_app_iframe');
  assert.match(payload.app.iframeUrl, /^https:\/\/mcp\.excalidraw\.com\//);
  assert.equal(payload.app.prompt, 'draw an architecture diagram for a user, api, and database');
});
