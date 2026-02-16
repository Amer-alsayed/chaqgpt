// File: /api/chat.js

// This is a modern way to handle streaming data from one source to another.
async function pipeStream(readable, writable) {
  const reader = readable.getReader();
  const writer = writable; // The server's response object is a writable stream.

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      writer.end(); // Signal that we're finished writing.
      break;
    }
    writer.write(value); // Write the data chunk to the response.
  }
}

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
        max_tokens: 16384,
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
    await pipeStream(openrouterResponse.body, response);

  } catch (error) {
    console.error('An error occurred:', error);
    if (!response.headersSent) {
      response.status(500).json({ error: 'An internal server error occurred.' });
    }
  }
}