import os

file_path = 'assets/js/app.js'
with open(file_path, 'r') as f:
    content = f.read()

if "To create diagrams, use" not in content:
    target = "7. Prefer HTML/CSS/JS for visual interactive previews.`;"
    replacement = "7. Prefer HTML/CSS/JS for visual interactive previews.\\n8. To create diagrams, use ```excalidraw block with valid Excalidraw JSON.`;"
    content = content.replace(target, replacement)

with open(file_path, 'w') as f:
    f.write(content)
