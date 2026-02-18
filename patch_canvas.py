import os

file_path = 'assets/js/canvas.js'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Add Excalidraw to LANGUAGE_CONFIG
if "excalidraw: { label: 'Excalidraw'" not in content:
    content = content.replace(
        "tex: { label: 'LaTeX', icon: '📄', strategy: 'latex', color: '#008080' },",
        "tex: { label: 'LaTeX', icon: '📄', strategy: 'latex', color: '#008080' },\n    excalidraw: { label: 'Excalidraw', icon: '🎨', strategy: 'excalidraw', color: '#6965db' },"
    )

# 2. Update open() method
if "else if (config.strategy === 'excalidraw')" not in content:
    # We look for the latex block
    target_str = "} else if (config.strategy === 'latex') {\n            this.switchTab('preview');\n            this._runLatex(code);\n        } else {"

    # Just replace the specific latex block handling part to include excalidraw before the final else
    # The file has:
    # } else if (config.strategy === 'latex') {
    #     this.switchTab('preview');
    #     this._runLatex(code);
    # } else {

    # Regex might be safer but simple replace works if whitespace matches.
    # Let's try to find a unique enough string.

    latex_block = "this._runLatex(code);\n        } else {"
    if latex_block in content:
        content = content.replace(
            latex_block,
            "this._runLatex(code);\n        } else if (config.strategy === 'excalidraw') {\n            this.switchTab('preview');\n            this._runExcalidraw(code);\n        } else {"
        )

# 3. Update run() method
if "case 'excalidraw':" not in content:
    content = content.replace(
        "case 'latex':\n                    await this._runLatex(this.currentCode);\n                    break;",
        "case 'latex':\n                    await this._runLatex(this.currentCode);\n                    break;\n                case 'excalidraw':\n                    await this._runExcalidraw(this.currentCode);\n                    this.switchTab('preview');\n                    break;"
    )

# 4. Update _runWeb to hide Excalidraw container
if "const exContainer = document.getElementById('canvasExcalidrawContainer');" not in content:
    content = content.replace(
        "const iframe = document.querySelector('.canvas-preview-iframe');\n        if (!iframe) return;",
        "const iframe = document.querySelector('.canvas-preview-iframe');\n        const exContainer = document.getElementById('canvasExcalidrawContainer');\n        if (exContainer) exContainer.style.display = 'none';\n        if (iframe) { iframe.style.display = ''; }\n        if (!iframe) return;"
    )

# 5. Update _showLatexLoading to hide Excalidraw container
if "_showLatexLoading() {" in content and "const exContainer" not in content.split("_showLatexLoading() {")[1].split("}")[0]:
    content = content.replace(
        "_showLatexLoading() {\n        const iframe = document.querySelector('.canvas-preview-iframe');\n        if (!iframe) return;",
        "_showLatexLoading() {\n        const iframe = document.querySelector('.canvas-preview-iframe');\n        const exContainer = document.getElementById('canvasExcalidrawContainer');\n        if (exContainer) exContainer.style.display = 'none';\n        if (iframe) iframe.style.display = '';\n        if (!iframe) return;"
    )

# 6. Add _runExcalidraw method
if "_runExcalidraw(code)" not in content:
    # Insert before _runJavaScript
    excalidraw_method = """
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

    """
    content = content.replace(
        "async _runJavaScript(code, stdin = '') {",
        excalidraw_method + "async _runJavaScript(code, stdin = '') {"
    )

with open(file_path, 'w') as f:
    f.write(content)
