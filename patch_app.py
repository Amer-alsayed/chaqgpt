import os

file_path = 'assets/js/app.js'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Update CANVAS_PREVIEW_LANGS
if "'excalidraw'" not in content:
    content = content.replace(
        "const CANVAS_PREVIEW_LANGS = ['html', 'css', 'javascript', 'js', 'latex', 'tex'];",
        "const CANVAS_PREVIEW_LANGS = ['html', 'css', 'javascript', 'js', 'latex', 'tex', 'excalidraw'];"
    )

# 2. Update buildCanvasSystemPrompt
if "To create diagrams, use" not in content:
    content = content.replace(
        "7. Prefer HTML/CSS/JS for visual interactive previews.;"
    )

with open(file_path, 'w') as f:
    f.write(content)
