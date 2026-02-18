import fs from 'fs';

let content = fs.readFileSync('assets/js/canvas.js', 'utf8');

// 1. Remove duplicate keys in LANGUAGE_CONFIG
// The duplicates were 'tex' and 'excalidraw' appearing twice.
// We'll replace the whole block to be clean.
const langConfigStart = "const LANGUAGE_CONFIG = {";
const langConfigEnd = "};";
const startIndex = content.indexOf(langConfigStart);
const endIndex = content.indexOf(langConfigEnd, startIndex);

if (startIndex !== -1 && endIndex !== -1) {
    const cleanConfig = `const LANGUAGE_CONFIG = {
    // Web languages — live iframe preview
    html: { label: 'HTML', icon: '🌐', strategy: 'web', color: '#e44d26' },
    css: { label: 'CSS', icon: '🎨', strategy: 'web', color: '#264de4' },
    // JavaScript — sandboxed execution
    javascript: { label: 'JavaScript', icon: '⚡', strategy: 'javascript', color: '#f7df1e' },
    js: { label: 'JavaScript', icon: '⚡', strategy: 'javascript', color: '#f7df1e' },
    jsx: { label: 'JSX', icon: '⚛️', strategy: 'javascript', color: '#61dafb' },
    typescript: { label: 'TypeScript', icon: '🔷', strategy: 'piston', color: '#3178c6', pistonLang: 'typescript' },
    ts: { label: 'TypeScript', icon: '🔷', strategy: 'piston', color: '#3178c6', pistonLang: 'typescript' },
    // Python — Pyodide WASM
    python: { label: 'Python', icon: '🐍', strategy: 'python', color: '#3776ab' },
    py: { label: 'Python', icon: '🐍', strategy: 'python', color: '#3776ab' },
    python3: { label: 'Python', icon: '🐍', strategy: 'python', color: '#3776ab' },
    // Piston API languages
    c: { label: 'C', icon: '⚙️', strategy: 'piston', color: '#555555', pistonLang: 'c' },
    cpp: { label: 'C++', icon: '⚙️', strategy: 'piston', color: '#00599c', pistonLang: 'c++' },
    'c++': { label: 'C++', icon: '⚙️', strategy: 'piston', color: '#00599c', pistonLang: 'c++' },
    csharp: { label: 'C#', icon: '💜', strategy: 'piston', color: '#239120', pistonLang: 'csharp' },
    'c#': { label: 'C#', icon: '💜', strategy: 'piston', color: '#239120', pistonLang: 'csharp' },
    java: { label: 'Java', icon: '☕', strategy: 'piston', color: '#b07219', pistonLang: 'java' },
    go: { label: 'Go', icon: '🐹', strategy: 'piston', color: '#00add8', pistonLang: 'go' },
    golang: { label: 'Go', icon: '🐹', strategy: 'piston', color: '#00add8', pistonLang: 'go' },
    rust: { label: 'Rust', icon: '🦀', strategy: 'piston', color: '#dea584', pistonLang: 'rust' },
    ruby: { label: 'Ruby', icon: '💎', strategy: 'piston', color: '#cc342d', pistonLang: 'ruby' },
    php: { label: 'PHP', icon: '🐘', strategy: 'piston', color: '#4f5d95', pistonLang: 'php' },
    swift: { label: 'Swift', icon: '🐦', strategy: 'piston', color: '#fa7343', pistonLang: 'swift' },
    kotlin: { label: 'Kotlin', icon: '🟣', strategy: 'piston', color: '#7f52ff', pistonLang: 'kotlin' },
    dart: { label: 'Dart', icon: '🎯', strategy: 'piston', color: '#0175c2', pistonLang: 'dart' },
    r: { label: 'R', icon: '📊', strategy: 'piston', color: '#276dc3', pistonLang: 'r' },
    perl: { label: 'Perl', icon: '🐪', strategy: 'piston', color: '#39457e', pistonLang: 'perl' },
    lua: { label: 'Lua', icon: '🌙', strategy: 'piston', color: '#000080', pistonLang: 'lua' },
    scala: { label: 'Scala', icon: '⚡', strategy: 'piston', color: '#dc322f', pistonLang: 'scala' },
    haskell: { label: 'Haskell', icon: '🎩', strategy: 'piston', color: '#5e5086', pistonLang: 'haskell' },
    bash: { label: 'Bash', icon: '💲', strategy: 'piston', color: '#4eaa25', pistonLang: 'bash' },
    shell: { label: 'Shell', icon: '💲', strategy: 'piston', color: '#4eaa25', pistonLang: 'bash' },
    sh: { label: 'Shell', icon: '💲', strategy: 'piston', color: '#4eaa25', pistonLang: 'bash' },
    sql: { label: 'SQL', icon: '🗃️', strategy: 'piston', color: '#e38c00', pistonLang: 'sqlite3' },
    elixir: { label: 'Elixir', icon: '💧', strategy: 'piston', color: '#6e4a7e', pistonLang: 'elixir' },
    clojure: { label: 'Clojure', icon: '🔄', strategy: 'piston', color: '#5881d8', pistonLang: 'clojure' },
    fsharp: { label: 'F#', icon: '🔷', strategy: 'piston', color: '#b845fc', pistonLang: 'fsharp' },
    powershell: { label: 'PowerShell', icon: '💲', strategy: 'piston', color: '#012456', pistonLang: 'powershell' },
    // LaTeX — server-side compile for preview and PDF download
    latex: { label: 'LaTeX', icon: '📄', strategy: 'latex', color: '#008080' },
    tex: { label: 'LaTeX', icon: '📄', strategy: 'latex', color: '#008080' },
    // Excalidraw
    excalidraw: { label: 'Excalidraw', icon: '🎨', strategy: 'excalidraw', color: '#6965db' },
`;
    content = content.substring(0, startIndex) + cleanConfig + content.substring(endIndex);
}

// 2. Add _runExcalidraw method if missing
if (!content.includes('async _runExcalidraw(code)')) {
    const methodCode = `
    async _runExcalidraw(code) {
        const container = document.getElementById('canvasExcalidrawContainer');
        const iframe = document.querySelector('.canvas-preview-iframe');
        if (!container) return;

        if (iframe) iframe.style.display = 'none';
        container.style.display = 'block';
        container.innerHTML = '';

        this._log('info', 'Loading Excalidraw...');
        this._renderConsole();

        try {
            const { default: React } = await import('react');
            const { createRoot } = await import('react-dom/client');
            const { Excalidraw } = await import('@excalidraw/excalidraw');

            let initialData = { elements: [], appState: {} };
            try {
                const parsed = JSON.parse(code);
                if (parsed) initialData = parsed;
            } catch (e) {
                // If code is not JSON, we might want to just show empty or try to parse
            }

            const root = createRoot(container);
            const App = React.createElement(Excalidraw, {
                initialData: initialData,
            });
            root.render(App);

            this._log('info', 'Excalidraw loaded');
        } catch (err) {
            console.error(err);
            this._log('error', 'Failed to load Excalidraw: ' + err.message);
            container.innerHTML = '<div style="color:red;padding:20px">Failed to load Excalidraw</div>';
        }
        this._renderConsole();
    }

`;
    // Insert before _runJavaScript
    content = content.replace('async _runJavaScript(code, stdin = \'\') {', methodCode + '    async _runJavaScript(code, stdin = \'\') {');
}

fs.writeFileSync('assets/js/canvas.js', content);
