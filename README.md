<div align="center">

# ✦ ChaqGPT

**A sleek, free AI chat interface powered by the world's best open-source models.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/Amer-alsayed/chaqgpt)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Live Demo](https://chaqgpt.vercel.app) · [Report Bug](https://github.com/Amer-alsayed/chaqgpt/issues) · [Request Feature](https://github.com/Amer-alsayed/chaqgpt/issues)

</div>

---

## 📸 Screenshots

### Welcome Screen
![Welcome Screen](assets/preview-welcome.png)

### Math & LaTeX Rendering
![Math & LaTeX Rendering](assets/preview-math.png)

### Thinking Visualization
![Thinking Visualization](assets/preview-thinking.png)

### Sidebar & Chat Search
![Sidebar & Chat Search](assets/preview-sidebar.png)

---

## ✨ Features

| Category | Details |
|---|---|
| **Multi-Model Access** | 30+ free models — Qwen3 VL, DeepSeek R1, Llama 3.3 70B, Gemma 3, Mistral, and more |
| **Vision Support** | Upload images and get AI analysis with vision-enabled models |
| **Thinking Visualization** | Watch reasoning models "think" in real-time with expandable thought chains |
| **Rich Rendering** | Full Markdown, LaTeX math (KaTeX), syntax-highlighted code blocks with copy |
| **Chat History** | Persistent conversations stored locally — pick up where you left off |
| **Dark & Light Themes** | Toggle between themes; follows system preference by default |
| **Temporary Chat** | One-off conversations that aren't saved to history |
| **Mobile Optimized** | Responsive design with keyboard-aware viewport handling |
| **Streaming Responses** | Token-by-token streaming with adaptive 60fps render queue |
| **Zero Framework** | Pure HTML/CSS/JS — fast, lightweight, no build step required |

---

## 🛠️ Tech Stack

- **Frontend** — Vanilla HTML, CSS, JavaScript (no framework overhead)
- **Backend** — Vercel Serverless Functions (Node.js)
- **AI Provider** — [OpenRouter](https://openrouter.ai) (free-tier models)
- **Rendering** — [Marked](https://marked.js.org) + [KaTeX](https://katex.org) + [Highlight.js](https://highlightjs.org)
- **Design** — Custom CSS with spring animations, glassmorphism, and safe-area support

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- An [OpenRouter](https://openrouter.ai) API key (free)

### Local Development

```bash
# Clone the repo
git clone https://github.com/Amer-alsayed/chaqgpt.git
cd chaqgpt

# Install Vercel CLI
npm i -g vercel

# Create .env file (multi-key preferred, single-key fallback supported)
echo OPENROUTER_API_KEYS_JSON='["sk-or-1","sk-or-2","sk-or-3"]' > .env
# Optional fallback
echo OPENROUTER_API_KEY=your_key_here >> .env

# Start the dev server
vercel dev
```

The app will be available at `http://localhost:3000`.

---

## 📦 Deploy to Vercel

1. **Push** your code to GitHub
2. **Import** the repo in [Vercel](https://vercel.com/new)
3. **Add** environment variables:
   | Variable | Value |
   |---|---|
   | `OPENROUTER_API_KEYS_JSON` | JSON array of OpenRouter keys (recommended), e.g. `["sk-or-1","sk-or-2","sk-or-3"]` |
   | `OPENROUTER_API_KEY` | Single-key fallback (optional when JSON var is present) |
   | `OPENROUTER_KEY_COOLDOWN_RATE_LIMIT_MS` | Optional. Default `900000` (15 min) |
   | `OPENROUTER_KEY_COOLDOWN_AUTH_MS` | Optional. Default `21600000` (6 h) |
   | `OPENROUTER_KEY_COOLDOWN_TRANSIENT_MS` | Optional. Default `30000` (30 s) |
   | `OPENROUTER_MAX_FAILOVER_ATTEMPTS` | Optional. Default `10` |
   | `EXCALIDRAW_MCP_COMMAND` | Optional. Command used to launch Excalidraw MCP server locally. Default `node` |
   | `EXCALIDRAW_MCP_ARGS` | Optional. Space-separated args for MCP server command. Default `excalidraw-mcp/dist/index.js` |
4. **Deploy** — that's it!

> [!TIP]
> The app automatically fetches all available free models from OpenRouter at runtime. No config changes needed when new models are added.

---


## 🧩 Excalidraw MCP App Integration

ChaqGPT now includes an **agent tool** named `create_excalidraw_diagram` that can call a locally running Excalidraw MCP server and render interactive MCP App views inline (iframe-style) in chat.

### Local setup

```bash
# clone & build Excalidraw MCP server
git clone https://github.com/excalidraw/excalidraw-mcp
cd excalidraw-mcp
npm install
npm run build
```

Then configure your `.env` in ChaqGPT:

```bash
EXCALIDRAW_MCP_COMMAND=node
EXCALIDRAW_MCP_ARGS="/absolute/path/to/excalidraw-mcp/dist/index.js"
```

When users ask for a flowchart, architecture diagram, sequence diagram, etc. and tool use is enabled, the assistant can call this tool and embed the returned Excalidraw view directly in the chat UI.

## 🤖 Default Model

New users start with **Qwen3 VL 30B A3B Thinking** — a powerful vision + reasoning model. Users can switch models anytime via the header dropdown, and their preference is saved locally.

---

## 📁 Project Structure

```
chaqgpt/
├── api/
│   ├── chat.js          # Chat completion proxy (streaming)
│   └── models.js        # Fetches & filters free models from OpenRouter
├── assets/
│   ├── css/style.css    # Complete design system
│   └── js/
│       ├── app.js       # Core application logic
│       └── config.js    # Welcome messages & suggestion sets
├── index.html           # Single-page application entry
├── vercel.json          # Vercel deployment config
└── .env                 # API key (not committed)
```

---

## 🔒 Security

- API keys are **never** exposed to the client
- All API calls route through serverless functions
- `.env` is gitignored by default

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  <sub>Built with ☕ by <a href="https://github.com/Amer-alsayed">Amer Alsayed</a></sub>
</div>
