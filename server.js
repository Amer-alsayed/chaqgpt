const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// Serve static files from the current directory
app.use(express.static(path.join(__dirname, '.')));

// Import the API handler
const chatHandler = require('./api/chat');
const modelsHandler = require('./api/models');
const executeHandler = require('./api/execute');
const latexHandler = require('./api/latex');
const imageHandler = require('./api/image');

// Mount the API handler
app.get('/api/models', async (req, res) => {
  try {
    await modelsHandler(req, res);
  } catch (error) {
    console.error('Error in /api/models handler:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    await chatHandler(req, res);
  } catch (error) {
    console.error('Error in /api/chat handler:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.post('/api/execute', async (req, res) => {
  try {
    await executeHandler(req, res);
  } catch (error) {
    console.error('Error in /api/execute handler:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.post('/api/latex', async (req, res) => {
  try {
    await latexHandler(req, res);
  } catch (error) {
    console.error('Error in /api/latex handler:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.post('/api/image', async (req, res) => {
  try {
    await imageHandler(req, res);
  } catch (error) {
    console.error('Error in /api/image handler:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('Note: Configure OPENROUTER_API_KEYS_JSON (preferred) or OPENROUTER_API_KEY in .env for OpenRouter access.');
});
