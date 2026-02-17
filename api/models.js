const { getOpenRouterModels } = require('./lib/openrouter-models');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const payload = await getOpenRouterModels();
        res.status(200).json(payload);
    } catch (error) {
        console.error('Error fetching models:', error);
        res.status(502).json({
            error: 'Failed to fetch models from OpenRouter',
            details: error.message,
        });
    }
};
