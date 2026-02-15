const https = require('https');

module.exports = function (req, res) {
    const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/models',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const request = https.request(options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            if (response.statusCode === 200) {
                try {
                    const parsedData = JSON.parse(data);

                    // Filter for free models (pricing.prompt === '0' and pricing.completion === '0')
                    const freeModels = parsedData.data.filter(model => {
                        const promptPrice = parseFloat(model.pricing.prompt);
                        const completionPrice = parseFloat(model.pricing.completion);
                        return promptPrice === 0 && completionPrice === 0;
                    });

                    // Map to the format expected by the frontend
                    const formattedModels = freeModels.map(model => {
                        const id = model.id.toLowerCase();
                        const name = model.name.toLowerCase();
                        const description = (model.description || '').toLowerCase();

                        // Known vision model patterns (strict whitelist)
                        const visionPatterns = [
                            'nemotron-nano', // NVIDIA Nemotron Nano 12B 2 VL
                            'qwen3-vl',      // Qwen3 VL 30B, 235B
                            'qwen-2.5-vl',   // Qwen 2.5 VL variants
                            'mistral-small-3.1', // Mistral Small 3.1 24B
                            'gemma-3-4b',    // Google Gemma 3 4B
                            'gemma-3-12b',   // Google Gemma 3 12B
                            'gemma-3-27b',   // Google Gemma 3 27B
                        ];
                        const supportsVision = visionPatterns.some(p => id.includes(p));

                        // Category assignment
                        let category = 'General';
                        if (id.includes('code') || id.includes('coder') || name.includes('code') || description.includes('coding')) {
                            category = 'Coding';
                        } else if (supportsVision) {
                            category = 'Vision';
                        } else if (id.includes('r1') || id.includes('thinking') || name.includes('reasoning') || name.includes('thinking')) {
                            category = 'Reasoning';
                        }

                        // Check if it supports "thinking" (heuristic based on name/id for known reasoning models)
                        const supportsThinking = id.includes('r1') || id.includes('thinking') || name.includes('reasoning') || name.includes('thinking');

                        return {
                            id: model.id,
                            name: model.name,
                            description: model.description || 'No description available',
                            category: category,
                            badge: 'free',
                            supportsThinking: supportsThinking,
                            supportsVision: supportsVision
                        };
                    });

                    // Sort models: Reasoning first, then General, then others
                    formattedModels.sort((a, b) => {
                        const catOrder = { 'Reasoning': 0, 'General': 1, 'Coding': 2, 'Vision': 3 };
                        return (catOrder[a.category] || 99) - (catOrder[b.category] || 99);
                    });

                    res.status(200).json(formattedModels);
                } catch (e) {
                    console.error('Error parsing OpenRouter response:', e);
                    res.status(500).json({ error: 'Failed to parse models from OpenRouter' });
                }
            } else {
                res.status(response.statusCode).json({ error: 'Failed to fetch models from OpenRouter' });
            }
        });
    });

    request.on('error', (error) => {
        console.error('Error fetching models:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    });

    request.end();
};
