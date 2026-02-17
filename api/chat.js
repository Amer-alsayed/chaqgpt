const { getModelById } = require('./lib/openrouter-models');
const { withOpenRouterFailover } = require('./lib/openrouter-key-pool');

async function pipeStream(readable, writable) {
    const reader = readable.getReader();
    const writer = writable;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            writer.end();
            break;
        }
        writer.write(value);
    }
}

function inspectMessageFeatures(messages) {
    let hasImages = false;
    let hasFiles = false;
    let hasNonPdfFile = false;

    for (const message of messages || []) {
        if (!Array.isArray(message?.content)) continue;

        for (const part of message.content) {
            const type = String(part?.type || '').toLowerCase();

            if (type === 'image_url') {
                hasImages = true;
                continue;
            }

            if (type === 'file') {
                hasFiles = true;
                const fileName = String(part?.file?.filename || '').toLowerCase();
                const fileData = String(part?.file?.file_data || '').toLowerCase();
                const isPdf = fileName.endsWith('.pdf') || fileData.startsWith('data:application/pdf');
                if (!isPdf) hasNonPdfFile = true;
            }
        }
    }

    return { hasImages, hasFiles, hasNonPdfFile };
}

function parseErrorText(errorText) {
    const text = String(errorText || '');
    if (!text) return { error: { message: 'Upstream request failed' } };

    try {
        return JSON.parse(text);
    } catch {
        return { error: { message: text.slice(0, 500) } };
    }
}

module.exports = async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { model, messages } = request.body || {};

        if (!model || !Array.isArray(messages) || messages.length === 0) {
            return response.status(400).json({ error: 'Request must include model and messages.' });
        }

        const modelInfo = await getModelById(model);
        if (!modelInfo) {
            return response.status(400).json({ error: 'Model is unavailable or no longer free.' });
        }

        const { hasImages, hasFiles, hasNonPdfFile } = inspectMessageFeatures(messages);

        if (hasImages && !modelInfo.capabilities.visionInput) {
            return response.status(400).json({ error: 'Selected model does not support image input.' });
        }

        if (hasFiles && !modelInfo.capabilities.fileInputPdf) {
            return response.status(400).json({ error: 'Selected model does not support file input.' });
        }

        if (hasNonPdfFile) {
            return response.status(400).json({ error: 'Only PDF files are supported.' });
        }

        const failoverResult = await withOpenRouterFailover({
            modelId: model,
            requestFactory: ({ apiKey }) => fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'HTTP-Referer': request.headers.origin || 'http://localhost:3000',
                    'X-Title': 'ChaqGPT',
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: 16384,
                    stream: true,
                }),
            }),
        });

        if (!failoverResult.ok) {
            if (failoverResult.lastFailure?.type === 'config') {
                return response.status(500).json({ error: 'API key not configured.' });
            }

            if (failoverResult.lastFailure?.type === 'response') {
                const errorData = parseErrorText(failoverResult.lastFailure.errorText);
                return response.status(failoverResult.lastFailure.status || 502).json(errorData);
            }

            return response.status(502).json({
                error: 'All OpenRouter keys failed due to network/upstream issues.',
                attempts: failoverResult.attempts.length,
            });
        }

        const openrouterResponse = failoverResult.response;
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });

        await pipeStream(openrouterResponse.body, response);
    } catch (error) {
        console.error('An error occurred:', error);
        if (!response.headersSent) {
            response.status(500).json({ error: 'An internal server error occurred.' });
        }
    }
};
