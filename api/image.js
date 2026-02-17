const { getModelById } = require('./lib/openrouter-models');
const { withOpenRouterFailover } = require('./lib/openrouter-key-pool');

function extractImagesFromMessage(message) {
    const images = [];
    const content = message?.content;

    if (Array.isArray(content)) {
        for (const part of content) {
            if (part?.type === 'image_url' && part.image_url?.url) {
                images.push({ url: part.image_url.url });
            }
            if (part?.type === 'image_base64' && part.image_base64?.b64_json) {
                images.push({ b64: part.image_base64.b64_json });
            }
        }
    }

    if (Array.isArray(message?.images)) {
        for (const image of message.images) {
            if (image?.url) images.push({ url: image.url });
            if (image?.b64_json) images.push({ b64: image.b64_json });
        }
    }

    return images;
}

function parseJsonSafe(text) {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { model, prompt, size, quality } = req.body || {};
        if (!model || !prompt || !String(prompt).trim()) {
            return res.status(400).json({ error: 'model and prompt are required.' });
        }

        const modelInfo = await getModelById(model);
        if (!modelInfo) {
            return res.status(400).json({ error: 'Model is unavailable or no longer free.' });
        }

        if (!modelInfo.capabilities.imageOutput) {
            return res.status(400).json({ error: 'Selected model does not support image generation.' });
        }

        const imageConfig = {};
        if (size) imageConfig.size = String(size);
        if (quality) imageConfig.quality = String(quality);

        const failoverResult = await withOpenRouterFailover({
            modelId: model,
            requestFactory: ({ apiKey }) => fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'HTTP-Referer': req.headers.origin || 'http://localhost:3000',
                    'X-Title': 'ChaqGPT',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'user',
                            content: [{ type: 'text', text: String(prompt) }],
                        },
                    ],
                    modalities: ['text', 'image'],
                    ...(Object.keys(imageConfig).length > 0 ? { image: imageConfig } : {}),
                }),
            }),
        });

        if (!failoverResult.ok) {
            if (failoverResult.lastFailure?.type === 'config') {
                return res.status(500).json({ error: 'API key not configured.' });
            }

            if (failoverResult.lastFailure?.type === 'response') {
                const raw = String(failoverResult.lastFailure.errorText || '');
                const details = parseJsonSafe(raw);
                return res.status(failoverResult.lastFailure.status || 502).json({
                    error: details?.error?.message || 'Image generation failed.',
                    details,
                });
            }

            return res.status(502).json({
                error: 'All OpenRouter keys failed due to network/upstream issues.',
                attempts: failoverResult.attempts.length,
            });
        }

        const payload = await failoverResult.response.json().catch(() => ({}));
        const message = payload?.choices?.[0]?.message || {};
        const text = typeof message?.content === 'string'
            ? message.content
            : Array.isArray(message?.content)
                ? message.content.filter((part) => part?.type === 'text').map((part) => part?.text || '').join('\n').trim()
                : '';

        const images = extractImagesFromMessage(message);

        if (images.length === 0) {
            return res.status(502).json({
                error: 'Model returned no image output.',
                details: payload,
            });
        }

        return res.status(200).json({ images, text });
    } catch (error) {
        console.error('Image generation error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
};
