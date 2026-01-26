const { pipeline } = require('node:stream/promises');

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return response.status(500).json({ error: 'API key not configured.' });
  }

  try {
    const { model, messages } = request.body;

    const openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000', // Optional, for OpenRouter analytics
        'X-Title': 'GPT-Fork' // Optional, for OpenRouter analytics
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
        top_p: 1,
        // ✅ The crucial change: enable streaming
        stream: true, 
      }),
    });

    if (!openrouterResponse.ok) {
      const errorData = await openrouterResponse.json();
      return response.status(openrouterResponse.status).json(errorData);
    }

    // ✅ Set the necessary headers for the browser to understand a stream
    response.writeHead(200, {
      'Content-Type': 'text/event-stream', // Specifies a stream of events
      'Cache-Control': 'no-cache',         // Prevents caching of the stream
      'Connection': 'keep-alive',          // Keeps the connection open
    });
    
    // ✅ Pipe the stream from OpenRouter's API directly to the client's browser
    await pipeline(openrouterResponse.body, response);

  } catch (error) {
    console.error('An error occurred:', error);
    if (!response.headersSent) {
      response.status(500).json({ error: 'An internal server error occurred.' });
    }
  }
}
