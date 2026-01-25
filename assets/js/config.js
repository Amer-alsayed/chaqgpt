export const models = [
    // --- Reasoning Models ---
    // --- Reasoning Models ---
    { id: "tngtech/deepseek-r1t2-chimera:free", name: "DeepSeek R1T2 Chimera", description: "2nd gen merge, 20% faster than original R1", category: "Reasoning", badge: "free", supportsThinking: true },
    { id: "deepseek/deepseek-r1-0528:free", name: "DeepSeek R1 0528", description: "671B reasoning model with open reasoning tokens", category: "Reasoning", badge: "free", supportsThinking: true },
    { id: "openai/gpt-oss-120b:free", name: "GPT-OSS 120B", description: "OpenAI's open-weight 117B MoE for agentic tasks", category: "Reasoning", badge: "free", supportsThinking: true },
    { id: "liquid/lfm-2.5-1.2b-thinking:free", name: "LiquidAI LFM2.5 Thinking", description: "Lightweight reasoning model for edge devices", category: "Reasoning", badge: "free", supportsThinking: true },
    { id: "arcee-ai/trinity-mini:free", name: "Arcee Trinity Mini", description: "Sparse MoE for long-context reasoning (131k)", category: "Reasoning", badge: "free", supportsThinking: true },
    { id: "nvidia/nemotron-nano-9b-v2:free", name: "NVIDIA Nemotron Nano 9B", description: "Unified model for reasoning and standard tasks", category: "Reasoning", badge: "free", supportsThinking: true },

    // --- General Purpose Models ---
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct", description: "Frontier-level multilingual dialogue model", category: "General", badge: "free", supportsThinking: false },
    { id: "meta-llama/llama-3.2-3b-instruct:free", name: "Llama 3.2 3B Instruct", description: "Efficient multilingual model for low-resource HW", category: "General", badge: "free", supportsThinking: false },
    { id: "mistralai/mistral-small-3.1-24b-instruct:free", name: "Mistral Small 3.1 24B", description: "Efficient 24B with multimodal and coding", category: "General", badge: "free", supportsThinking: false },
    { id: "google/gemma-3-27b-it:free", name: "Google Gemma 3 27B", description: "Multimodal open-source, 128k context", category: "General", badge: "free", supportsThinking: false },
    { id: "google/gemma-3-12b-it:free", name: "Google Gemma 3 12B", description: "Mid-size multimodal model", category: "General", badge: "free", supportsThinking: false },
    { id: "google/gemma-3-4b-it:free", name: "Google Gemma 3 4B", description: "Lightweight multimodal model", category: "General", badge: "free", supportsThinking: false },
    { id: "moonshotai/kimi-k2:free", name: "Kimi K2", description: "1T parameter MoE for tool-use and code", category: "General", badge: "free", supportsThinking: false },
    { id: "z-ai/glm-4.5-air:free", name: "GLM 4.5 Air", description: "Lightweight agent-centric model", category: "General", badge: "free", supportsThinking: false },
    { id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", name: "Venice Uncensored", description: "Uncensored Mistral variant for unrestricted use", category: "General", badge: "free", supportsThinking: false },
    { id: "nousresearch/hermes-3-llama-3.1-405b:free", name: "Nous Hermes 3 405B", description: "Advanced agentic and roleplaying capabilities", category: "General", badge: "free", supportsThinking: false },

    // --- Coding Models ---
    { id: "xiaomi/mimo-v2-flash:free", name: "Xiaomi MiMo-V2-Flash", description: "Top SWE-bench model, 256K context", category: "Coding", badge: "free", supportsThinking: false },
    { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder 480B", description: "Massive MoE for agentic coding", category: "Coding", badge: "free", supportsThinking: false },
    { id: "mistralai/devstral-2512:free", name: "Mistral Devstral 2", description: "123B for agentic coding and code exploration", category: "Coding", badge: "free", supportsThinking: false },

    // --- Vision Models ---
    { id: "qwen/qwen-2.5-vl-7b-instruct:free", name: "Qwen2.5-VL 7B", description: "Multimodal for video and device UI understanding", category: "Vision", badge: "free", supportsThinking: false },
    { id: "allenai/molmo-2-8b:free", name: "AllenAI Molmo2 8B", description: "Vision-language for grounding and video", category: "Vision", badge: "free", supportsThinking: false }
];

export const welcomeHeadings = [
    "What can I help with?",
    "How can I assist you today?",
    "What would you like to know?",
    "Ready to help. What's on your mind?",
    "How may I help you?",
    "What brings you here today?",
    "Let's explore together. What's your question?",
    "I'm here to help. What do you need?",
    "What can I do for you today?"
];

export const suggestionSets = [
    ["Solve this equation: x² + 5x + 6 = 0", "Explain quantum entanglement", "Write a Python function to calculate fibonacci", "What is the integral of sin(x)?"],
    ["Explain neural networks in simple terms", "Create a REST API in Node.js", "What are the principles of clean code?", "Debug this JavaScript async function"],
    ["Summarize the theory of relativity", "Best practices for React development", "Explain blockchain technology", "How does machine learning work?"],
    ["Write a sorting algorithm in Python", "Explain the Big Bang theory", "Design patterns in software engineering", "What is quantum computing?"],
    ["Create a responsive CSS layout", "Explain photosynthesis process", "Introduction to data structures", "How do neural networks learn?"],
    ["SQL vs NoSQL databases comparison", "Explain the water cycle", "Best Git workflow practices", "What is artificial intelligence?"],
    ["Build a todo app in React", "Explain DNA replication", "Microservices architecture explained", "Introduction to cryptography"],
    ["Optimize database queries", "How does the immune system work?", "Design a scalable system", "Explain climate change causes"]
];
