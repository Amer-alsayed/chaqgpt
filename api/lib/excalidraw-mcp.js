const { createStdioMcpClient, parseArgs } = require('./mcp-client');

const DEFAULT_CLIENT_INFO = {
    name: 'chaqgpt-excalidraw-client',
    version: '0.1.0',
};

function resolveMcpCommand() {
    const command = process.env.EXCALIDRAW_MCP_COMMAND || 'node';
    const args = parseArgs(process.env.EXCALIDRAW_MCP_ARGS || 'excalidraw-mcp/dist/index.js');
    return { command, args };
}

function pickDiagramTool(tools) {
    if (!Array.isArray(tools)) return null;
    const byPriority = ['create_view', 'create_diagram', 'generate_diagram'];
    for (const name of byPriority) {
        const found = tools.find((t) => t?.name === name);
        if (found) return found;
    }
    return tools.find((t) => /draw|diagram|excalidraw|view/i.test(t?.name || '') || /diagram|draw|whiteboard/i.test(t?.description || '')) || null;
}

function buildToolInput(tool, prompt) {
    const inputSchema = tool?.inputSchema || {};
    const props = inputSchema.properties || {};
    if (props.prompt) return { prompt };
    if (props.query) return { query: prompt };
    if (props.description) return { description: prompt };
    if (props.request) return { request: prompt };
    if (props.text) return { text: prompt };
    return { prompt };
}

function normalizeMcpAppFromToolResult(result) {
    const response = {
        summary: '',
        app: null,
        raw: result,
    };

    const content = Array.isArray(result?.content) ? result.content : [];
    const textParts = [];

    for (const item of content) {
        if (item?.type === 'text' && item.text) {
            textParts.push(String(item.text));
        }

        const embeddedUrl = item?.url || item?.uri;
        if (!response.app && embeddedUrl && /^https?:\/\//i.test(String(embeddedUrl))) {
            response.app = { type: 'url', url: String(embeddedUrl) };
        }

        const html = item?.html || item?.content;
        if (!response.app && item?.type === 'html' && html) {
            response.app = { type: 'html', html: String(html) };
        }
    }

    const meta = result?._meta || {};
    if (!response.app && typeof meta?.['openai/outputTemplate'] === 'string') {
        response.app = { type: 'url', url: meta['openai/outputTemplate'] };
    }
    if (!response.app && typeof meta?.iframeUrl === 'string') {
        response.app = { type: 'url', url: meta.iframeUrl };
    }

    response.summary = textParts.join('\n').trim();
    return response;
}

async function createExcalidrawDiagram(prompt) {
    const cleanedPrompt = String(prompt || '').trim();
    if (!cleanedPrompt) return { error: 'A diagram prompt is required.' };

    const { command, args } = resolveMcpCommand();
    const mcp = createStdioMcpClient(command, args);

    try {
        await mcp.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: DEFAULT_CLIENT_INFO,
        });
        mcp.notify('notifications/initialized', {});

        const toolsResult = await mcp.request('tools/list', {});
        const tools = toolsResult?.tools || [];
        const selectedTool = pickDiagramTool(tools);

        if (!selectedTool?.name) {
            return {
                error: 'Excalidraw MCP server did not expose a diagram tool.',
                availableTools: tools.map((t) => t?.name).filter(Boolean),
            };
        }

        const toolInput = buildToolInput(selectedTool, cleanedPrompt);
        const callResult = await mcp.request('tools/call', {
            name: selectedTool.name,
            arguments: toolInput,
        });

        const normalized = normalizeMcpAppFromToolResult(callResult);
        return {
            tool: selectedTool.name,
            prompt: cleanedPrompt,
            summary: normalized.summary || 'Created an Excalidraw diagram.',
            app: normalized.app,
            raw: normalized.raw,
            instruction: normalized.app
                ? 'Render the provided app payload to the user in an embedded whiteboard view.'
                : 'No embeddable app payload was returned. Provide the summary text to the user.',
        };
    } catch (error) {
        return {
            error: `Excalidraw MCP call failed: ${error.message}`,
            mcpStderr: mcp.getStderr(),
            hint: 'Set EXCALIDRAW_MCP_COMMAND and EXCALIDRAW_MCP_ARGS so ChaqGPT can spawn the Excalidraw MCP server locally.',
        };
    } finally {
        await mcp.close();
    }
}

module.exports = {
    createExcalidrawDiagram,
};
