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

function parseBudgetFromError(message = '') {
  const affordableMatch = message.match(/can only afford\s+(\d+)/i);
  const requestedMatch = message.match(/requested up to\s+(\d+)\s+tokens/i);

  return {
    affordable: affordableMatch ? Number(affordableMatch[1]) : null,
    requested: requestedMatch ? Number(requestedMatch[1]) : null,
  };
}

async function createOpenRouterCompletion({ apiKey, model, messages, maxTokens }) {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      max_tokens: maxTokens,
      // ✅ The crucial change: enable streaming
      stream: true,
    }),
  });
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
    const { model, messages, max_tokens: requestedMaxTokens } = request.body;

    // Keep defaults credit-safe. Allow overriding via env/body, but clamp to avoid accidental huge requests.
    const ENV_MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS || 8192);
    const BODY_MAX_TOKENS = Number(requestedMaxTokens || ENV_MAX_TOKENS);
    let maxTokens = Math.max(256, Math.min(BODY_MAX_TOKENS, ENV_MAX_TOKENS));

    let openrouterResponse = await createOpenRouterCompletion({ apiKey, model, messages, maxTokens });

    // If OpenRouter rejects due to credit/token budget, retry once with a safer value.
    if (!openrouterResponse.ok) {
      const errorData = await openrouterResponse.json().catch(() => ({ error: { message: 'Unknown error' } }));
      const errorMessage = errorData?.error?.message || '';
      const { affordable } = parseBudgetFromError(errorMessage);

      const looksLikeTokenBudgetError =
        /fewer max_tokens/i.test(errorMessage) ||
        /requires more credits/i.test(errorMessage) ||
        /can only afford/i.test(errorMessage);

      if (looksLikeTokenBudgetError) {
        const retryMaxTokens = Math.max(256, Math.min(affordable || Math.floor(maxTokens / 2), 4096));

        if (retryMaxTokens < maxTokens) {
          maxTokens = retryMaxTokens;
          openrouterResponse = await createOpenRouterCompletion({ apiKey, model, messages, maxTokens });
        }
      }

      if (!openrouterResponse.ok) {
        const finalError = await openrouterResponse.json().catch(() => errorData);
        return response.status(openrouterResponse.status).json(finalError);
      }
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
