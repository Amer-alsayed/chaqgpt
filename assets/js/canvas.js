/**
 * Canvas Module — In-Browser Code Execution & Preview
 * Supports: HTML/CSS/JS (live preview), Python (Pyodide WASM),
 * JavaScript (sandboxed), 60+ languages (Piston API)
 */

// ─── Language Metadata ───────────────────────────────────────────
const LANGUAGE_CONFIG = {
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
};

// ─── Pyodide State ───────────────────────────────────────────────
let pyodideInstance = null;
let pyodideLoading = false;
let pyodideReady = false;

// ─── Canvas Manager ──────────────────────────────────────────────
class CanvasManager {
    constructor() {
        this.isOpen = false;
        this.isFullscreen = false;
        this.canvasLinked = false;
        this.currentCode = '';
        this.currentLang = '';
        this.activeTab = 'code';
        this.consoleOutput = [];
        this.isRunning = false;
        this._latexPdfPreviewUrl = null;
        this._lastLatexCompile = null;
        this._latexRunId = 0;
        // Init resize after DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._initResize());
        } else {
            this._initResize();
        }
    }

    _setPreviewSandboxForStrategy(strategy) {
        const iframe = document.querySelector('.canvas-preview-iframe');
        if (!iframe) return;

        if (strategy === 'latex') {
            // Browser PDF viewers are often blocked in sandboxed iframes.
            iframe.removeAttribute('sandbox');
        } else {
            iframe.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-same-origin');
        }
    }

    _isMobileViewport() {
        return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    }

    getConfig(lang) {
        const key = (lang || 'plaintext').toLowerCase().trim();
        return LANGUAGE_CONFIG[key] || { label: lang || 'Code', icon: '📄', strategy: 'piston', color: '#888', pistonLang: key };
    }

    open(code, lang) {
        this.currentCode = code;
        this.currentLang = lang;
        this.consoleOutput = [];
        this.isRunning = false;

        const config = this.getConfig(lang);
        const panel = document.getElementById('canvasPanel');
        const appContainer = document.querySelector('.app-container');

        // Populate header
        const langBadge = panel.querySelector('.canvas-lang-badge');
        langBadge.textContent = config.label;
        langBadge.style.setProperty('--lang-color', config.color);

        const langIcon = panel.querySelector('.canvas-lang-icon');
        langIcon.textContent = config.icon;

        // Populate code view
        this._renderCodeView(code, lang);

        // Set active tab based on language
        if (config.strategy === 'web') {
            this.switchTab('preview');
            this._runWeb(code, lang);
        } else if (config.strategy === 'latex') {
            this.switchTab('preview');
            this._runLatex(code);
        } else {
            this.switchTab('code');
        }

        // Show PDF download button for web/HTML and LaTeX content
        const pdfBtn = panel.querySelector('.canvas-pdf-btn');
        if (pdfBtn) {
            pdfBtn.style.display = (config.strategy === 'web' || config.strategy === 'latex') ? '' : 'none';
        }

        // Clear console
        this._renderConsole();

        // Show panel
        panel.classList.add('open');
        appContainer.classList.add('canvas-open');
        this.isOpen = true;

        // Update run button text
        this._updateRunButton();
    }

    close() {
        const panel = document.getElementById('canvasPanel');
        const appContainer = document.querySelector('.app-container');

        // Restore sidebar & rail if we were in fullscreen
        if (this.isFullscreen) {
            const sidebar = document.querySelector('.sidebar');
            const sidebarRail = document.getElementById('sidebarRail');
            if (sidebar && this._sidebarWasOpen) {
                sidebar.classList.add('open');
            }
            if (sidebarRail) {
                sidebarRail.style.display = '';
            }
        }

        panel.classList.remove('open', 'fullscreen');
        appContainer.classList.remove('canvas-open', 'canvas-fullscreen');
        this.isOpen = false;
        this.isFullscreen = false;

        // Reset custom width
        panel.style.width = '';

        // Reset fullscreen icons
        const expandIcon = panel.querySelector('.canvas-expand-icon');
        const shrinkIcon = panel.querySelector('.canvas-shrink-icon');
        if (expandIcon) expandIcon.style.display = '';
        if (shrinkIcon) shrinkIcon.style.display = 'none';

        // Clean up iframe
        const iframe = panel.querySelector('.canvas-preview-iframe');
        if (iframe) {
            this._setPreviewSandboxForStrategy('web');
            iframe.src = 'about:blank';
            iframe.srcdoc = '';
        }
        this._latexRunId++;
        this._revokeLatexPreviewUrl();
    }

    toggleFullscreen() {
        const panel = document.getElementById('canvasPanel');
        const appContainer = document.querySelector('.app-container');
        const sidebar = document.querySelector('.sidebar');
        const sidebarRail = document.getElementById('sidebarRail');
        this.isFullscreen = !this.isFullscreen;

        panel.classList.toggle('fullscreen', this.isFullscreen);
        appContainer.classList.toggle('canvas-fullscreen', this.isFullscreen);

        // Hide sidebar and rail in fullscreen, restore on exit
        if (sidebar) {
            if (this.isFullscreen) {
                this._sidebarWasOpen = sidebar.classList.contains('open');
                sidebar.classList.remove('open');
            } else if (this._sidebarWasOpen) {
                sidebar.classList.add('open');
            }
        }
        if (sidebarRail) {
            sidebarRail.style.display = this.isFullscreen ? 'none' : '';
        }

        // Swap icons
        const expandIcon = panel.querySelector('.canvas-expand-icon');
        const shrinkIcon = panel.querySelector('.canvas-shrink-icon');
        if (expandIcon) expandIcon.style.display = this.isFullscreen ? 'none' : '';
        if (shrinkIcon) shrinkIcon.style.display = this.isFullscreen ? '' : 'none';

        // Reset any custom drag width when going fullscreen
        if (this.isFullscreen) {
            panel.style.width = '';
        }
    }

    toggleLink() {
        this.canvasLinked = !this.canvasLinked;
        const btn = document.querySelector('.canvas-link-btn');
        if (btn) {
            btn.classList.toggle('active', this.canvasLinked);
            btn.title = this.canvasLinked ? 'Canvas linked to chat — AI sees your code' : 'Canvas not linked — click to let AI see your code';
        }
    }

    _initResize() {
        const handle = document.getElementById('canvasResizeHandle');
        const panel = document.getElementById('canvasPanel');
        if (!handle || !panel) return;

        let startX, startWidth;

        const onMouseMove = (e) => {
            const delta = startX - e.clientX;
            const newWidth = Math.max(300, Math.min(startWidth + delta, window.innerWidth * 0.9));
            panel.style.width = newWidth + 'px';
            // Disable transition during drag for instant feedback
            panel.style.transition = 'none';
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            panel.style.transition = '';
            // Also update iframe if in preview mode
            const iframe = panel.querySelector('.canvas-preview-iframe');
            if (iframe) iframe.style.pointerEvents = '';
        };

        handle.addEventListener('mousedown', (e) => {
            if (this.isFullscreen) return; // No resize in fullscreen
            e.preventDefault();
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            // Disable iframe pointer events during drag
            const iframe = panel.querySelector('.canvas-preview-iframe');
            if (iframe) iframe.style.pointerEvents = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    switchTab(tab) {
        this.activeTab = tab;
        const panel = document.getElementById('canvasPanel');

        // Update tab buttons
        panel.querySelectorAll('.canvas-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });

        // Update tab content
        panel.querySelectorAll('.canvas-tab-content').forEach(c => {
            c.classList.toggle('active', c.dataset.tab === tab);
        });
    }

    async run() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.consoleOutput = [];
        this._renderConsole();
        this._updateRunButton();

        const config = this.getConfig(this.currentLang);

        try {
            switch (config.strategy) {
                case 'web':
                    this._runWeb(this.currentCode, this.currentLang);
                    this.switchTab('preview');
                    break;
                case 'javascript':
                    await this._runJavaScript(this.currentCode);
                    this.switchTab('console');
                    break;
                case 'python':
                    await this._runPython(this.currentCode);
                    this.switchTab('console');
                    break;
                case 'piston':
                    await this._runPiston(this.currentCode, config.pistonLang || this.currentLang);
                    this.switchTab('console');
                    break;
                case 'latex':
                    await this._runLatex(this.currentCode);
                    break;
                default:
                    this._log('error', `Unsupported language: ${this.currentLang}`);
                    this.switchTab('console');
            }
        } catch (err) {
            this._log('error', err.message || 'Execution failed');
        } finally {
            this.isRunning = false;
            this._updateRunButton();
            this._renderConsole();
        }
    }

    // ─── Execution Engines ───────────────────────────────────────

    _runWeb(code, lang) {
        const iframe = document.querySelector('.canvas-preview-iframe');
        if (!iframe) return;
        this._setPreviewSandboxForStrategy('web');

        let htmlContent = code;

        // If the code is CSS-only, wrap it
        if (lang === 'css') {
            htmlContent = `<!DOCTYPE html><html><head><style>${code}</style></head><body><div class="demo">CSS Preview</div></body></html>`;
        }

        // If it doesn't have DOCTYPE or html tag, wrap in basic HTML
        if (!htmlContent.toLowerCase().includes('<!doctype') && !htmlContent.toLowerCase().includes('<html')) {
            htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;padding:16px}</style></head><body>${htmlContent}</body></html>`;
        }

        // Inject console capture script
        const consoleCapture = `<script>
            (function(){
                const _origConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
                function send(type, args) {
                    try { parent.postMessage({ type:'canvas-console', level: type, args: Array.from(args).map(a => {
                        try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); } catch(e) { return String(a); }
                    })}, '*'); } catch(e) {}
                }
                console.log = function(){ send('log', arguments); _origConsole.log.apply(console, arguments); };
                console.error = function(){ send('error', arguments); _origConsole.error.apply(console, arguments); };
                console.warn = function(){ send('warn', arguments); _origConsole.warn.apply(console, arguments); };
                console.info = function(){ send('info', arguments); _origConsole.info.apply(console, arguments); };
                window.onerror = function(msg, url, line) { send('error', [msg + ' (line ' + line + ')']); };
            })();
        </script>`;

        // Insert console capture right after <head> or at the beginning
        if (htmlContent.includes('<head>')) {
            htmlContent = htmlContent.replace('<head>', '<head>' + consoleCapture);
        } else if (htmlContent.includes('<body>')) {
            htmlContent = htmlContent.replace('<body>', consoleCapture + '<body>');
        } else {
            htmlContent = consoleCapture + htmlContent;
        }

        iframe.srcdoc = htmlContent;
        this._log('info', '✨ Preview loaded');
        this._renderConsole();
    }

    // ─── LaTeX Preview (Server PDF) ──────────────────────────────
    // LaTeX preview now compiles on the server and renders as PDF in iframe.
    async _runLatex(code) {
        const latexCode = String(code || '');
        const runId = ++this._latexRunId;

        this._setPreviewSandboxForStrategy('latex');
        this.switchTab('preview');
        this._showLatexLoading();
        this._log('info', 'Compiling LaTeX preview...');
        this._renderConsole();

        try {
            const { blob, fromCache } = await this._compileLatex(latexCode, 'pdflatex', { useCache: true });
            if (runId !== this._latexRunId) return;

            this._showLatexPdfPreview(URL.createObjectURL(blob));
            this._log('info', fromCache ? 'LaTeX preview ready (cached)' : 'LaTeX preview ready');
        } catch (err) {
            if (runId !== this._latexRunId) return;
            const message = err && err.message ? err.message : 'LaTeX preview failed';
            this._showLatexPreviewError(message);
            this._log('error', 'LaTeX preview failed:\n' + message);
            this.switchTab('console');
        } finally {
            if (runId === this._latexRunId) {
                this._renderConsole();
            }
        }
    }

    _showLatexLoading() {
        const iframe = document.querySelector('.canvas-preview-iframe');
        if (!iframe) return;

        this._revokeLatexPreviewUrl();
        iframe.src = 'about:blank';
        iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #475569; }
        .latex-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; }
        .spinner {
            width: 32px;
            height: 32px;
            border: 3px solid #dbeafe;
            border-top-color: #2563eb;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="latex-loading">
        <div class="spinner"></div>
        <div>Compiling LaTeX preview...</div>
    </div>
</body>
</html>`;
    }

    _showLatexPdfPreview(objectUrl) {
        const iframe = document.querySelector('.canvas-preview-iframe');
        if (!iframe) return;
        this._setPreviewSandboxForStrategy('latex');

        this._revokeLatexPreviewUrl();
        this._latexPdfPreviewUrl = objectUrl;

        if (this._isMobileViewport()) {
            // Mobile Chrome often cannot navigate iframe directly to blob PDFs.
            // Render with <object> first, and keep an explicit open fallback.
            iframe.src = 'about:blank';
            iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 14px;
            font-family: system-ui, -apple-system, sans-serif;
            background: #0f172a;
            color: #cbd5e1;
            padding: 12px;
            box-sizing: border-box;
        }
        .pdf-frame {
            width: 100%;
            height: calc(100vh - 180px);
            border: none;
            background: #fff;
            border-radius: 12px;
        }
        .fallback {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 14px;
        }
        .badge {
            width: 56px;
            height: 56px;
            border-radius: 14px;
            background: rgba(148, 163, 184, 0.12);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
        }
        .open-btn {
            border: none;
            border-radius: 14px;
            padding: 14px 26px;
            font-size: 20px;
            font-weight: 600;
            background: #7ea9eb;
            color: #0f172a;
            width: min(94vw, 520px);
            cursor: pointer;
        }
        .hint {
            text-align: center;
            font-size: 14px;
            color: #94a3b8;
            max-width: 560px;
        }
    </style>
</head>
<body>
    <object class="pdf-frame" data=${JSON.stringify(objectUrl)} type="application/pdf">
        <div class="fallback">
            <div class="badge">PDF</div>
            <button class="open-btn" id="openPdfBtn" type="button">Open</button>
            <div class="hint">If inline preview is unavailable on your browser, open the PDF in a new tab.</div>
        </div>
    </object>
    <script>
        const pdfUrl = ${JSON.stringify(objectUrl)};
        const openBtn = document.getElementById('openPdfBtn');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                window.open(pdfUrl, '_blank');
            });
        }
    </script>
</body>
</html>`;
        } else {
            // Important: srcdoc takes precedence over src when present.
            iframe.removeAttribute('srcdoc');
            iframe.src = objectUrl;
        }
    }

    _showLatexPreviewError(message) {
        const iframe = document.querySelector('.canvas-preview-iframe');
        if (!iframe) return;

        this._revokeLatexPreviewUrl();
        const safeMsg = this._escapeHtml(message || 'Unknown LaTeX compilation error');
        iframe.src = 'about:blank';
        iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 20px; font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #1f2937; }
        .error {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #991b1b;
            border-radius: 10px;
            padding: 16px;
            white-space: pre-wrap;
            line-height: 1.45;
        }
        .hint { margin-top: 12px; color: #475569; }
    </style>
</head>
<body>
    <div class="error">${safeMsg}</div>
    <div class="hint">Check the Console tab for full compile logs.</div>
</body>
</html>`;
    }

    _revokeLatexPreviewUrl() {
        if (this._latexPdfPreviewUrl) {
            URL.revokeObjectURL(this._latexPdfPreviewUrl);
            this._latexPdfPreviewUrl = null;
        }
    }

    _getLatexCompileKey(code, compiler) {
        return `${compiler}::${code}`;
    }

    _prepareLatexSourceForCompile(code) {
        const raw = String(code || '').trim();
        if (!raw) return raw;

        const hasDocClass = /\\documentclass(\[[^\]]*])?\{[^}]+\}/.test(raw);
        const hasBeginDoc = /\\begin\{document\}/.test(raw);
        const hasEndDoc = /\\end\{document\}/.test(raw);

        if (hasDocClass && hasBeginDoc && hasEndDoc) {
            return raw;
        }

        if (hasDocClass && !hasBeginDoc && !hasEndDoc) {
            return `${raw}\n\\begin{document}\n\\end{document}`;
        }

        if (!hasDocClass && hasBeginDoc && hasEndDoc) {
            return `\\documentclass{article}\n${raw}`;
        }

        const body = raw
            .replace(/\\begin\{document\}/g, '')
            .replace(/\\end\{document\}/g, '')
            .trim();

        return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;
    }

    _parseLatexErrorMessage(text, fallback) {
        if (!text) return fallback;
        if (text.startsWith('%PDF-') || text.includes('\n%PDF-')) {
            return 'LaTeX service returned PDF data in an unexpected error response.';
        }

        try {
            const parsed = JSON.parse(text);
            return parsed.logs || parsed.error || parsed.message || fallback;
        } catch (err) {
            return text.length > 4000 ? text.slice(0, 4000) + '\n...(truncated)' : text;
        }
    }

    async _compileLatex(code, compiler = 'pdflatex', options = {}) {
        const useCache = options.useCache !== false;
        const latexCode = this._prepareLatexSourceForCompile(code);
        if (!latexCode.trim()) {
            throw new Error('No LaTeX code to compile.');
        }

        const compileKey = this._getLatexCompileKey(latexCode, compiler);
        if (useCache && this._lastLatexCompile && this._lastLatexCompile.key === compileKey && this._lastLatexCompile.blob) {
            return { blob: this._lastLatexCompile.blob, fromCache: true };
        }

        const controller = new AbortController();
        const timeoutMs = 65000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch('/api/latex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: latexCode, compiler }),
                signal: controller.signal
            });

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            const isPdfContentType = contentType.includes('application/pdf') || contentType.includes('application/x-pdf');
            const buffer = await response.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            // Some proxies prepend bytes before the PDF signature; scan an initial window.
            const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
            const scanLimit = Math.min(bytes.length - 4, 1024);
            let looksLikePdf = false;
            for (let i = 0; i <= scanLimit; i++) {
                if (
                    bytes[i] === pdfSignature[0] &&
                    bytes[i + 1] === pdfSignature[1] &&
                    bytes[i + 2] === pdfSignature[2] &&
                    bytes[i + 3] === pdfSignature[3] &&
                    bytes[i + 4] === pdfSignature[4]
                ) {
                    looksLikePdf = true;
                    break;
                }
            }

            if (response.ok && (isPdfContentType || looksLikePdf)) {
                const blob = new Blob([buffer], { type: 'application/pdf' });
                if (!blob || blob.size === 0) {
                    throw new Error('LaTeX compiler returned an empty PDF.');
                }

                this._lastLatexCompile = { key: compileKey, blob };
                return { blob, fromCache: false };
            }

            const fallback = `HTTP ${response.status}: ${response.statusText || 'LaTeX compilation failed'}`;
            if (looksLikePdf) {
                throw new Error('LaTeX service returned PDF data with an unexpected HTTP status. Please try again.');
            }

            const isTextLike = contentType.includes('json') || contentType.includes('text') || contentType.includes('xml');
            if (!isTextLike) {
                throw new Error(fallback);
            }

            const bodyText = new TextDecoder('utf-8').decode(buffer);
            const errorMsg = this._parseLatexErrorMessage(bodyText, fallback);
            throw new Error(errorMsg || fallback);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error('LaTeX compilation timed out after 65 seconds.');
            }
            if (err && err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
                throw new Error('Unable to reach the LaTeX service. Check your connection and try again.');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async _runJavaScript(code) {
        this._log('info', '▶ Running JavaScript...');
        this._renderConsole();

        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.sandbox = 'allow-scripts';
            document.body.appendChild(iframe);

            const handler = (e) => {
                if (e.data?.type === 'canvas-js-result') {
                    e.data.logs.forEach(log => this._log(log.level, log.text));
                    if (e.data.error) this._log('error', e.data.error);
                    window.removeEventListener('message', handler);
                    iframe.remove();
                    resolve();
                }
            };
            window.addEventListener('message', handler);

            const script = `
                <script>
                    const logs = [];
                    const _log = (level, args) => logs.push({ level, text: Array.from(args).map(a => {
                        try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); } catch(e) { return String(a); }
                    }).join(' ') });
                    console.log = function(){ _log('log', arguments); };
                    console.error = function(){ _log('error', arguments); };
                    console.warn = function(){ _log('warn', arguments); };
                    console.info = function(){ _log('info', arguments); };

                    let error = null;
                    try {
                        ${code}
                    } catch(e) {
                        error = e.message || String(e);
                    }
                    parent.postMessage({ type: 'canvas-js-result', logs, error }, '*');
                </script>
            `;
            iframe.srcdoc = `<!DOCTYPE html><html><body>${script}</body></html>`;

            // Timeout after 10 seconds
            setTimeout(() => {
                window.removeEventListener('message', handler);
                iframe.remove();
                this._log('error', '⏱ Execution timed out (10s)');
                resolve();
            }, 10000);
        });
    }

    async _runPython(code) {
        this._log('info', '▶ Running Python...');
        this._renderConsole();

        // Detect unsupported GUI/native modules before loading Pyodide
        const unsupportedModules = {
            'pygame': 'pygame requires a native display — use HTML Canvas + JavaScript instead',
            'tkinter': 'tkinter requires a native GUI — use HTML + JavaScript for UI',
            'turtle': 'turtle graphics requires a native display — use HTML Canvas instead',
            'cv2': 'OpenCV requires native binaries — not available in browser Python',
            'opencv': 'OpenCV requires native binaries — not available in browser Python',
            'wx': 'wxPython requires a native GUI — use HTML + JavaScript for UI',
            'PyQt5': 'PyQt requires a native GUI — use HTML + JavaScript for UI',
            'PyQt6': 'PyQt requires a native GUI — use HTML + JavaScript for UI',
            'kivy': 'Kivy requires a native display — use HTML + JavaScript for UI',
            'curses': 'curses requires a terminal — not available in browser Python',
        };

        for (const [mod, reason] of Object.entries(unsupportedModules)) {
            const importRegex = new RegExp(`^\\s*(?:import\\s+${mod}|from\\s+${mod}\\b)`, 'm');
            if (importRegex.test(code)) {
                this._log('error', `❌ Cannot run: "${mod}" is not supported in browser Python.\n\n${reason}.\n\nTip: Ask the AI to rewrite this as HTML/CSS/JavaScript for the canvas preview.`);
                this._renderConsole();
                return;
            }
        }

        if (!pyodideReady && !pyodideLoading) {
            this._log('info', '📦 Loading Python runtime (first time only)...');
            this._renderConsole();
            pyodideLoading = true;

            try {
                // Load Pyodide from CDN
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js';
                document.head.appendChild(script);

                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Failed to load Pyodide'));
                });

                pyodideInstance = await loadPyodide();
                pyodideReady = true;
                pyodideLoading = false;
                this._log('info', '✅ Python runtime loaded');
                this._renderConsole();
            } catch (err) {
                pyodideLoading = false;
                throw new Error('Failed to load Python runtime: ' + err.message);
            }
        } else if (pyodideLoading) {
            // Wait for existing load
            while (pyodideLoading) {
                await new Promise(r => setTimeout(r, 100));
            }
            if (!pyodideReady) throw new Error('Python runtime failed to load');
        }

        // Redirect stdout/stderr
        pyodideInstance.runPython(`
import sys, io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
        `);

        try {
            const result = await pyodideInstance.runPythonAsync(code);
            const stdout = pyodideInstance.runPython('sys.stdout.getvalue()');
            const stderr = pyodideInstance.runPython('sys.stderr.getvalue()');

            if (stdout) this._log('log', stdout);
            if (stderr) this._log('warn', stderr);
            if (result !== undefined && result !== null && !stdout) {
                this._log('log', String(result));
            }
            if (!stdout && !stderr && (result === undefined || result === null)) {
                this._log('info', '✅ Code executed successfully (no output)');
            }
        } catch (err) {
            this._log('error', err.message);
        }
    }

    async _runPiston(code, lang) {
        this._log('info', `▶ Running ${lang}...`);
        this._renderConsole();

        try {
            const response = await fetch('/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    language: lang,
                    code: code,
                    stdin: '',
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `Execution server error (${response.status})`);
            }

            const result = await response.json();

            if (result.compile && result.compile.stderr) {
                this._log('error', '❌ Compilation Error:\n' + result.compile.stderr);
            }
            if (result.run) {
                if (result.run.stdout) this._log('log', result.run.stdout);
                if (result.run.stderr) this._log('error', result.run.stderr);
                if (result.run.signal === 'SIGKILL') {
                    this._log('error', '⏱ Execution timed out or ran out of memory');
                }
                if (!result.run.stdout && !result.run.stderr && !result.compile?.stderr) {
                    this._log('info', '✅ Code executed successfully (no output)');
                }
            }
        } catch (err) {
            if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                this._log('error', '🌐 Unable to reach execution server. Please check your internet connection.');
            } else {
                throw err;
            }
        }
    }

    // ─── Console & UI Helpers ────────────────────────────────────

    _log(level, text) {
        this.consoleOutput.push({
            level,
            text: String(text),
            timestamp: new Date().toLocaleTimeString()
        });
        if (level === 'error') this._lastError = String(text);
    }

    _renderConsole() {
        const container = document.querySelector('.canvas-console-output');
        if (!container) return;

        if (this.consoleOutput.length === 0) {
            container.innerHTML = '<div class="canvas-console-empty">Click <strong>▶ Run</strong> to execute the code</div>';
            return;
        }

        const hasErrors = this.consoleOutput.some(e => e.level === 'error');

        let html = this.consoleOutput.map(entry => {
            const levelClass = `console-${entry.level}`;
            const icon = entry.level === 'error' ? '✕' : entry.level === 'warn' ? '⚠' : entry.level === 'info' ? 'ℹ' : '›';
            const escapedText = entry.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            return `<div class="canvas-console-line ${levelClass}"><span class="console-icon">${icon}</span><pre class="console-text">${escapedText}</pre><span class="console-time">${entry.timestamp}</span></div>`;
        }).join('');

        // Add Fix with AI button when there are errors
        if (hasErrors) {
            html += `<div class="canvas-fix-error-bar">
                <button class="canvas-fix-btn" onclick="window.fixCanvasError()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    Fix with AI
                </button>
            </div>`;
        }

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    }

    fixError() {
        if (!this._lastError || !this.currentCode) return;

        const config = this.getConfig(this.currentLang);
        const errorText = this._lastError.substring(0, 500); // Trim long errors
        const codeText = this.currentCode;

        // Compose the fix prompt
        const fixPrompt = `Fix the error in this ${config.label} code. Only change the parts that need fixing, don't rewrite everything from scratch.\n\nError:\n\`\`\`\n${errorText}\n\`\`\`\n\nCode:\n\`\`\`${this.currentLang}\n${codeText}\n\`\`\``;

        // Set the message in the input and send it
        const input = document.getElementById('messageInput');
        if (input) {
            input.value = fixPrompt;
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
            // Trigger the send
            if (typeof window.sendMessage === 'function') {
                window.sendMessage();
            }
        }
    }

    _renderCodeView(code, lang) {
        const container = document.querySelector('.canvas-code-content');
        if (!container) return;

        const lines = code.split('\n');
        const lineNumbers = lines.map((_, i) => `<span class="line-num">${i + 1}</span>`).join('');

        container.innerHTML = `
            <div class="canvas-code-lines" id="canvasCodeLines">${lineNumbers}</div>
            <textarea class="canvas-code-editor" id="canvasCodeEditor" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">${this._escapeHtml(code)}</textarea>
        `;

        const editor = container.querySelector('#canvasCodeEditor');
        const linesEl = container.querySelector('#canvasCodeLines');

        // Sync code changes back to manager
        editor.addEventListener('input', () => {
            this.currentCode = editor.value;
            // Update line numbers
            const newLines = editor.value.split('\n');
            linesEl.innerHTML = newLines.map((_, i) => `<span class="line-num">${i + 1}</span>`).join('');
        });

        // Sync scroll between editor and line numbers
        editor.addEventListener('scroll', () => {
            linesEl.scrollTop = editor.scrollTop;
        });

        // Handle Tab key for indentation
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
                this.currentCode = editor.value;
            }
        });
    }

    _updateRunButton() {
        const btn = document.querySelector('.canvas-run-btn');
        if (!btn) return;

        if (this.isRunning) {
            btn.classList.add('running');
            btn.innerHTML = '<span class="canvas-run-spinner"></span> Running...';
            btn.disabled = true;
        } else {
            btn.classList.remove('running');
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Run';
            btn.disabled = false;
        }
    }

    async downloadPDF() {
        // For LaTeX content, use server-side compilation for a proper PDF
        const config = this.getConfig(this.currentLang);
        if (config.strategy === 'latex') {
            return this._downloadLatexPDF();
        }

        const sourceIframe = document.querySelector('.canvas-preview-iframe');
        if (!sourceIframe || !sourceIframe.srcdoc) {
            alert('No HTML preview to download. Click Run first!');
            return;
        }

        const pdfBtn = document.querySelector('.canvas-pdf-btn');
        if (pdfBtn) {
            pdfBtn.disabled = true;
            pdfBtn.innerHTML = '<span class="canvas-run-spinner"></span> Generating...';
        }

        try {
            // Load jsPDF in the parent window (for PDF generation)
            if (!window.jspdf) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Failed to load jsPDF'));
                    document.head.appendChild(script);
                });
            }

            const iframeWin = sourceIframe.contentWindow;
            const iframeDoc = sourceIframe.contentDocument;

            // Inject html2canvas INTO the iframe so it captures styles correctly
            if (!iframeWin.html2canvas) {
                await new Promise((resolve, reject) => {
                    const script = iframeDoc.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Failed to load html2canvas'));
                    iframeDoc.head.appendChild(script);
                });
            }

            // Capture the iframe body as a canvas — inside the iframe context
            // so all CSS styles, backgrounds, and text colors are preserved
            const canvas = await iframeWin.html2canvas(iframeDoc.body, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: null,
                width: iframeDoc.body.scrollWidth,
                height: iframeDoc.body.scrollHeight,
            });

            // Build the PDF from the canvas image
            const { jsPDF } = window.jspdf;
            const imgData = canvas.toDataURL('image/png');

            const pdfMargin = 10; // mm
            const pdfPageW = 210; // A4 width mm
            const pdfPageH = 297; // A4 height mm
            const contentW = pdfPageW - pdfMargin * 2;
            const contentH = pdfPageH - pdfMargin * 2;

            const imgRatio = canvas.height / canvas.width;
            const totalImgH = contentW * imgRatio; // full image height in mm

            const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

            if (totalImgH <= contentH) {
                // Fits on one page
                pdf.addImage(imgData, 'PNG', pdfMargin, pdfMargin, contentW, totalImgH);
            } else {
                // Multi-page: slice the canvas into A4-sized strips
                const pixelsPerPage = (contentH / totalImgH) * canvas.height;
                let srcY = 0;
                let page = 0;

                while (srcY < canvas.height) {
                    if (page > 0) pdf.addPage();

                    const sliceH = Math.min(pixelsPerPage, canvas.height - srcY);
                    const sliceCanvas = document.createElement('canvas');
                    sliceCanvas.width = canvas.width;
                    sliceCanvas.height = sliceH;
                    const ctx = sliceCanvas.getContext('2d');
                    ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

                    const sliceData = sliceCanvas.toDataURL('image/png');
                    const sliceMMHeight = (sliceH / canvas.width) * contentW;
                    pdf.addImage(sliceData, 'PNG', pdfMargin, pdfMargin, contentW, sliceMMHeight);

                    srcY += sliceH;
                    page++;
                }
            }

            pdf.save(`canvas-preview-${Date.now()}.pdf`);

        } catch (err) {
            console.error('PDF generation failed:', err);
            alert('Failed to generate PDF: ' + err.message);
        } finally {
            // Restore button
            if (pdfBtn) {
                pdfBtn.disabled = false;
                pdfBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> PDF';
            }
        }
    }

    // ─── LaTeX PDF Download (server-side compilation) ────────────
    async _downloadLatexPDF() {
        if (!this.currentCode || !this.currentCode.trim()) {
            alert('No LaTeX code to compile.');
            return;
        }

        const pdfBtn = document.querySelector('.canvas-pdf-btn');
        if (pdfBtn) {
            pdfBtn.disabled = true;
            pdfBtn.innerHTML = '<span class="canvas-run-spinner"></span> Compiling...';
        }

        try {
            const { blob, fromCache } = await this._compileLatex(this.currentCode, 'pdflatex', { useCache: true });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `latex-document-${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this._log('info', fromCache ? 'PDF downloaded successfully (cached compile)' : 'PDF downloaded successfully');
            this._renderConsole();
        } catch (err) {
            console.error('LaTeX PDF download failed:', err);
            this._log('error', 'LaTeX PDF download failed:\n' + (err && err.message ? err.message : 'Unknown error'));
            this._renderConsole();
            this.switchTab('console');
            alert('Failed to compile LaTeX: ' + err.message);
        } finally {
            if (pdfBtn) {
                pdfBtn.disabled = false;
                pdfBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> PDF';
            }
        }
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ─── Singleton & Global API ──────────────────────────────────────
const canvasManager = new CanvasManager();

// Listen for console messages from iframes
window.addEventListener('message', (e) => {
    if (e.data?.type === 'canvas-console') {
        canvasManager._log(e.data.level, e.data.args.join(' '));
        canvasManager._renderConsole();
    }
});

// Global functions that app.js will call
window.openCanvas = function (code, lang) {
    canvasManager.open(code, lang);
};

window.closeCanvas = function () {
    canvasManager.close();
};

window.runCanvas = function () {
    canvasManager.run();
};

window.switchCanvasTab = function (tab) {
    canvasManager.switchTab(tab);
};

window.fixCanvasError = function () {
    canvasManager.fixError();
};

window.toggleCanvasFullscreen = function () {
    canvasManager.toggleFullscreen();
};

window.toggleCanvasLink = function () {
    canvasManager.toggleLink();
};

// Canvas state getters for app.js integration
window.getCanvasState = function () {
    return {
        isOpen: canvasManager.isOpen,
        linked: canvasManager.canvasLinked,
        code: canvasManager.currentCode,
        lang: canvasManager.currentLang,
        langLabel: canvasManager.getConfig(canvasManager.currentLang).label
    };
};

// Update canvas code from outside (e.g., from AI response)
window.updateCanvasCode = function (code) {
    canvasManager.currentCode = code;
    canvasManager._renderCodeView(code, canvasManager.currentLang);
};

// Update canvas code AND auto-run preview (for agent-style auto-apply)
window.updateCanvasCodeAndPreview = function (code, lang) {
    const config = canvasManager.getConfig(lang || canvasManager.currentLang);
    const effectiveLang = lang || canvasManager.currentLang || 'html';

    if (!canvasManager.isOpen) {
        // Open the canvas with this code
        canvasManager.open(code, effectiveLang);
    } else {
        // Update existing canvas
        canvasManager.currentCode = code;
        if (lang) canvasManager.currentLang = lang;
        canvasManager._renderCodeView(code, effectiveLang);

        // Update header
        const panel = document.getElementById('canvasPanel');
        const langBadge = panel.querySelector('.canvas-lang-badge');
        const langIcon = panel.querySelector('.canvas-lang-icon');
        if (langBadge) langBadge.textContent = config.label;
        if (langIcon) langIcon.textContent = config.icon;

        // Auto-run preview for web and LaTeX languages
        if (config.strategy === 'web') {
            canvasManager.switchTab('preview');
            canvasManager._runWeb(code, effectiveLang);
        } else if (config.strategy === 'latex') {
            canvasManager._runLatex(code);
        }
    }
};

// Download canvas as PDF
window.downloadCanvasPDF = function () {
    canvasManager.downloadPDF();
};

// Close on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && canvasManager.isOpen) {
        canvasManager.close();
    }
});

// Open canvas and show preview tab (callable from inline onclick)
window.openCanvasPreview = function () {
    if (canvasManager.isOpen) {
        // Already open — just switch to preview
        canvasManager.switchTab('preview');
    } else if (canvasManager.currentCode) {
        // Has code from a previous session — re-open with it
        canvasManager.open(canvasManager.currentCode, canvasManager.currentLang || 'html');
    } else {
        // No code and not open — just show the panel
        const panel = document.getElementById('canvasPanel');
        const appContainer = document.querySelector('.app-container');
        if (panel) {
            panel.classList.add('open');
            appContainer.classList.add('canvas-open');
            canvasManager.isOpen = true;
            canvasManager.switchTab('preview');
        }
    }
};

export { CanvasManager, canvasManager };
