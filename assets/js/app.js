import { models, welcomeHeadings, suggestionSets } from './config.js';

const API_URL = '/api/chat';
const API_IMAGE_URL = '/api/image';

let conversationHistory = [];
let isProcessing = false;
let messagesContainer = null;
let currentModel = 'openrouter/aurora-alpha'; // Default: Aurora Alpha
let currentChatId = null;
let chatHistoryData = {};
let abortController = null;
let shouldStopTyping = false;
let isAutoScrollEnabled = true; // Default to true
let renderQueue = [];
let isRendering = false;
let canvasMode = false; // Canvas mode toggle — AI knows about code context
let searchEnabled = localStorage.getItem('searchEnabled') === 'true'; // Web search toggle
let availableModels = [...models]; // Initialize with config models
let pendingImages = []; // base64 data URLs for image attachments
let pendingFiles = []; // PDF attachments as data URLs
let imageGenerationMode = false;
let modelsMeta = null;
let activeStreamContext = { searchEnabledAtRequest: false, canvasModeAtRequest: false };
const SEND_BUTTON_SEND_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 19V5M5 12l7-7 7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const SEND_BUTTON_STOP_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>`;
const CANVAS_PREVIEW_LANGS = ['html', 'css', 'javascript', 'js', 'latex', 'tex', 'excalidraw'];
const CANVAS_RUN_LANGS_SAFE = [
    'javascript', 'js', 'python', 'py', 'python3',
    'c', 'cpp', 'c++', 'java', 'go', 'golang', 'rust',
    'ruby', 'swift', 'typescript', 'ts',
    'haskell', 'scala', 'zig', 'pascal', 'fortran', 'ocaml', 'erlang'
];

function buildCanvasSystemPrompt(canvasState) {
    const previewList = CANVAS_PREVIEW_LANGS.join(', ');
    const runList = CANVAS_RUN_LANGS_SAFE.join(', ');

    const supportPolicy = `CANVAS CAPABILITIES POLICY:
1. By default, only generate code in languages that are known-supported by this canvas.
2. Preview-capable languages (Preview tab): ${previewList}
3. Run-capable safe languages (Run/Console): ${runList}
4. If the user does NOT force a specific language, choose from the supported lists above.
5. If the user explicitly forces a different language, follow the user request, but clearly warn that it may not run/preview in canvas.
6. Never default to native GUI frameworks (for example pygame, tkinter, PyQt) for canvas output.
7. Prefer HTML/CSS/JS for visual interactive previews.\n8. To create diagrams, use \`\`\`excalidraw block with valid Excalidraw JSON.`;

    if (canvasState && canvasState.isOpen && canvasState.code) {
        return `You are in CANVAS MODE editing ${canvasState.langLabel} code.
${supportPolicy}

CRITICAL EDITING RULES:
1. When the user asks for a change, output the COMPLETE updated file in a single \`\`\`${canvasState.lang} code block. Include ALL original code with requested modifications applied.
2. Modify ONLY what the user asked for; keep everything else as-is.
3. Keep explanation brief and outside the code block.`;
    }

    return `You are in CANVAS MODE.
${supportPolicy}

Output clean, complete, runnable code in a single fenced code block with a correct language tag. Keep explanation brief.`;
}

// Load dynamic models from API
async function fetchModels() {
    try {
        const response = await fetch('/api/models');
        if (response.ok) {
            const payload = await response.json();
            const dynamicModels = Array.isArray(payload) ? payload : payload.models;
            modelsMeta = Array.isArray(payload) ? null : payload.meta || null;
            updateModelFreshnessIndicator();

            if (dynamicModels && dynamicModels.length > 0) {
                availableModels = dynamicModels.map((model) => ({
                    ...model,
                    capabilities: {
                        reasoning: Boolean(model?.capabilities?.reasoning ?? model?.supportsThinking),
                        visionInput: Boolean(model?.capabilities?.visionInput ?? model?.supportsVision),
                        imageOutput: Boolean(model?.capabilities?.imageOutput),
                        fileInputPdf: Boolean(model?.capabilities?.fileInputPdf),
                        textChat: Boolean(model?.capabilities?.textChat ?? true),
                    },
                }));
                initializeModels();

                // Restore saved model preference
                const saved = localStorage.getItem('selectedModel');
                const savedModelExists = saved && availableModels.find(m => m.id === saved);

                if (savedModelExists) {
                    currentModel = saved;
                }
                if (!getCurrentModelData()) autoSwitchToSupportedModel(true);
                updateHeaderModelDisplay();
            }
        }
        // Update composer feature buttons after models are loaded
        updateVisionUI();
    } catch (error) {
        console.error('Failed to fetch dynamic models:', error);
        modelsMeta = { isStale: true };
        updateModelFreshnessIndicator();
    }
}

function updateModelFreshnessIndicator() {
    const staleEl = document.getElementById('modelStaleIndicator');
    if (!staleEl) return;
    staleEl.style.display = modelsMeta?.isStale ? '' : 'none';
}

function getCurrentModelData() {
    return availableModels.find(m => m.id === currentModel) || null;
}

function pickPreferredSupportedModel() {
    if (!availableModels || availableModels.length === 0) return null;
    const preferred = availableModels.find((model) => model.id === 'openrouter/aurora-alpha');
    if (preferred) return preferred;
    const textCapable = availableModels.find((model) => model?.capabilities?.textChat !== false);
    return textCapable || availableModels[0];
}

function autoSwitchToSupportedModel(notify = false) {
    const fallback = pickPreferredSupportedModel();
    if (!fallback) return false;
    const changed = currentModel !== fallback.id;
    currentModel = fallback.id;
    saveSelectedModel();
    updateHeaderModelDisplay();
    updateVisionUI();
    if (changed && notify) {
        showToast(`Model unavailable. Switched to ${fallback.name}.`, 'warning');
    }
    return true;
}

async function ensureCurrentModelSupported(fetchIfMissing = false, notify = false) {
    if (getCurrentModelData()) return true;
    if (fetchIfMissing) {
        await fetchModels();
    }
    if (getCurrentModelData()) return true;
    return autoSwitchToSupportedModel(notify);
}

function updateHeaderModelDisplay() {
    const savedModelData = getCurrentModelData();
    if (savedModelData) {
        const badge = document.getElementById('modelBadge');
        const headerName = document.getElementById('headerModelName');
        if (badge) badge.textContent = savedModelData.badge;
        if (headerName) headerName.textContent = savedModelData.name;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadUsername();

    // Initial setup with static models
    if (availableModels.length > 0) {
        // Check local storage
        const saved = localStorage.getItem('selectedModel');
        if (saved && availableModels.find(m => m.id === saved)) {
            currentModel = saved;
        } else {
            currentModel = availableModels[0].id;
            saveSelectedModel();
        }
        initializeModels();
    }
    updateVisionUI();

    // Fetch fresh models in background
    fetchModels();

    loadChatHistory();
    setupScrollDetection();
    initializeWelcome();
    setupGlobalClickHandler();
    setupSidebarOverlay();
    preventBodyScroll();
    setupMobileKeyboard();
    updateSendButtonState();
});

function setupMobileKeyboard() {
    if (window.innerWidth > 768) return;

    if (window.visualViewport) {
        const handler = () => {
            const vv = window.visualViewport;
            const appContainer = document.querySelector('.app-container');
            if (!appContainer) return;

            // Set the app container to match the visual viewport exactly
            appContainer.style.height = vv.height + 'px';
            appContainer.style.position = 'fixed';
            appContainer.style.top = vv.offsetTop + 'px';
            appContainer.style.left = '0';
            appContainer.style.right = '0';

            // Prevent browser from scrolling the page behind
            window.scrollTo(0, 0);
        };

        window.visualViewport.addEventListener('resize', handler);
        window.visualViewport.addEventListener('scroll', handler);
    }
}

// --- Theme Logic ---
function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const currentTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    document.body.classList.toggle('light-theme', currentTheme === 'light');
    updateThemeButton(currentTheme);
}

window.toggleTheme = function () {
    const isLight = document.body.classList.toggle('light-theme');
    const newTheme = isLight ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    updateThemeButton(newTheme);
}

function updateThemeButton(theme) {
    const isLight = theme === 'light';
    const textEl = document.getElementById('theme-text');
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    const metaTheme = document.getElementById('theme-meta');

    if (textEl) textEl.textContent = isLight ? 'Switch to Dark' : 'Switch to Light';
    if (sunIcon) sunIcon.style.display = isLight ? 'none' : 'block';
    if (moonIcon) moonIcon.style.display = isLight ? 'block' : 'none';
    if (metaTheme) metaTheme.setAttribute('content', isLight ? '#FFFFFF' : '#212121');
}

// --- UI Setup Helpers ---
function setupSidebarOverlay() {
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.addEventListener('click', () => closeSidebar());
}

function preventBodyScroll() {
    let startY = 0;
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;
    chatArea.addEventListener('touchstart', (e) => { startY = e.touches[0].pageY; }, { passive: true });
    chatArea.addEventListener('touchmove', (e) => {
        const y = e.touches[0].pageY, scrollTop = chatArea.scrollTop, scrollHeight = chatArea.scrollHeight, offsetHeight = chatArea.offsetHeight;
        if ((scrollTop === 0 && y > startY) || (scrollTop + offsetHeight >= scrollHeight && y < startY)) { }
    }, { passive: false });
}

function setupGlobalClickHandler() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.model-dropdown, .logo-dropdown, .header-model-btn, .header-model-dropdown, #modelDropdownBackdrop')) closeDropdowns();
        if (!e.target.closest('.sidebar-footer')) {
            const userMenu = document.getElementById('userMenu');
            if (userMenu) userMenu.classList.remove('show');
        }
        if (!e.target.closest('.sidebar-search-box') && !e.target.closest('.nav-item')) {
            const searchBox = document.getElementById('sidebarSearchBox');
            if (searchBox && searchBox.style.display !== 'none') {
                // Don't auto-close search if there's text in it
            }
        }
    });
}

function initializeWelcome() {
    const randomHeading = welcomeHeadings[Math.floor(Math.random() * welcomeHeadings.length)];
    const randomSuggestions = suggestionSets[Math.floor(Math.random() * suggestionSets.length)];
    const headingEl = document.getElementById('welcomeHeading');
    const gridEl = document.getElementById('suggestionGrid');

    if (headingEl) headingEl.textContent = randomHeading;
    if (gridEl) gridEl.innerHTML = randomSuggestions.map(suggestion => `<div class="suggestion-card" onclick="window.sendSuggestion('${suggestion.replace(/'/g, "\\'")}')"><p>${escapeHtml(suggestion)}</p></div>`).join('');
}

function loadUsername() {
    const savedUsername = localStorage.getItem('chatUsername') || 'User';
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    const railAvatarEl = document.getElementById('railAvatar');
    if (nameEl) nameEl.textContent = savedUsername;
    if (avatarEl) avatarEl.textContent = savedUsername.charAt(0).toUpperCase();
    if (railAvatarEl) railAvatarEl.textContent = savedUsername.charAt(0).toUpperCase();
}

window.toggleUserMenu = function (event) {
    event.stopPropagation();
    const menu = document.getElementById('userMenu');
    if (menu) menu.classList.toggle('show');
}

window.openUsernameModal = function (event) {
    event.stopPropagation();
    document.getElementById('usernameInput').value = localStorage.getItem('chatUsername') || 'User';
    document.getElementById('modalOverlay').classList.add('show');
    document.getElementById('userMenu').classList.remove('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('usernameInput').focus(), 100);
}

window.closeUsernameModal = function () {
    document.getElementById('modalOverlay').classList.remove('show');
    document.body.style.overflow = '';
}

window.saveUsername = function () {
    const newUsername = document.getElementById('usernameInput').value.trim();
    if (newUsername) {
        localStorage.setItem('chatUsername', newUsername);
        document.getElementById('userName').textContent = newUsername;
        document.getElementById('userAvatar').textContent = newUsername.charAt(0).toUpperCase();
        const railAvatarEl = document.getElementById('railAvatar');
        if (railAvatarEl) railAvatarEl.textContent = newUsername.charAt(0).toUpperCase();
        window.closeUsernameModal();
        showToast('Username updated successfully', 'success');
    }
}

function saveSelectedModel() { localStorage.setItem('selectedModel', currentModel); }

function buildModelListHTML(filterQuery = '') {
    const categories = {};
    const query = filterQuery.toLowerCase();

    availableModels.forEach(model => {
        if (query && !model.name.toLowerCase().includes(query) && !model.id.toLowerCase().includes(query)) return;
        if (!categories[model.category]) categories[model.category] = [];
        categories[model.category].push(model);
    });

    let html = '';
    Object.keys(categories).forEach(category => {
        html += `<div class="model-section-title">${category}</div>`;
        categories[category].forEach(model => {
            const caps = model.capabilities || {};
            const tags = [];
            if (caps.reasoning) tags.push('Reasoning');
            if (caps.visionInput) tags.push('Vision');
            if (caps.imageOutput) tags.push('Image');
            if (caps.fileInputPdf) tags.push('PDF');
            const tagHtml = tags.length > 0
                ? `<div class="model-capabilities">${tags.map((tag) => `<span class="model-cap-chip">${tag}</span>`).join('')}</div>`
                : '';
            html += `<div class="model-item ${model.id === currentModel ? 'selected' : ''}" data-model="${model.id}" data-badge="${model.badge}" data-name="${model.name}"><div class="model-info"><div class="model-name">${model.name}</div>${tagHtml}</div><svg class="model-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
        });
    });

    if (!html) {
        html = `<div class="model-section-title">No models found</div>`;
    }
    return html;
}

function attachModelItemListeners(container) {
    container.querySelectorAll('.model-item').forEach(item => item.addEventListener('click', (e) => { e.stopPropagation(); selectModel(item); }));
}

function initializeModels() {
    const dropdown = document.getElementById('modelDropdown');
    const headerDropdown = document.getElementById('headerModelDropdown');
    const searchHTML = `<div class="model-search-box"><input type="text" class="model-search-input" placeholder="Search models..." onclick="event.stopPropagation()" /></div>`;
    const listHTML = buildModelListHTML();

    if (dropdown) {
        dropdown.innerHTML = searchHTML + `<div class="model-list">${listHTML}</div>`;
        const searchInput = dropdown.querySelector('.model-search-input');
        searchInput.addEventListener('input', () => filterModels(searchInput.value, dropdown));
        attachModelItemListeners(dropdown);
    }
    if (headerDropdown) {
        headerDropdown.innerHTML = searchHTML + `<div class="model-list">${listHTML}</div>`;
        const searchInput = headerDropdown.querySelector('.model-search-input');
        searchInput.addEventListener('input', () => filterModels(searchInput.value, headerDropdown));
        attachModelItemListeners(headerDropdown);
    }

    updateHeaderModelDisplay();
}

function filterModels(query, dropdownEl) {
    const listContainer = dropdownEl.querySelector('.model-list');
    if (!listContainer) return;
    listContainer.innerHTML = buildModelListHTML(query);
    attachModelItemListeners(dropdownEl);
}

window.toggleSearchChats = function () {
    const overlay = document.getElementById('searchModalOverlay');
    if (overlay.classList.contains('show')) {
        window.closeSearchModal();
    } else {
        overlay.classList.add('show');
        const input = document.getElementById('searchModalInput');
        input.value = '';
        window.filterSearchModal();
        setTimeout(() => input.focus(), 50);
    }
}

window.closeSearchModal = function () {
    document.getElementById('searchModalOverlay').classList.remove('show');
}

window.filterSearchModal = function () {
    const query = document.getElementById('searchModalInput').value.toLowerCase();
    const resultsContainer = document.getElementById('searchModalResults');

    const chatIcon = `<svg class="search-result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/></svg>`;
    const newChatIcon = `<svg class="search-result-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M2.6687 11.333V8.66699C2.6687 7.74455 2.66841 7.01205 2.71655 6.42285C2.76533 5.82612 2.86699 5.31731 3.10425 4.85156L3.25854 4.57617C3.64272 3.94975 4.19392 3.43995 4.85229 3.10449L5.02905 3.02149C5.44666 2.84233 5.90133 2.75849 6.42358 2.71582C7.01272 2.66769 7.74445 2.66797 8.66675 2.66797H9.16675C9.53393 2.66797 9.83165 2.96586 9.83179 3.33301C9.83179 3.70028 9.53402 3.99805 9.16675 3.99805H8.66675C7.7226 3.99805 7.05438 3.99834 6.53198 4.04102C6.14611 4.07254 5.87277 4.12568 5.65601 4.20313L5.45581 4.28906C5.01645 4.51293 4.64872 4.85345 4.39233 5.27149L4.28979 5.45508C4.16388 5.7022 4.08381 6.01663 4.04175 6.53125C3.99906 7.05373 3.99878 7.7226 3.99878 8.66699V11.333C3.99878 12.2774 3.99906 12.9463 4.04175 13.4688C4.08381 13.9833 4.16389 14.2978 4.28979 14.5449L4.39233 14.7285C4.64871 15.1465 5.01648 15.4871 5.45581 15.7109L5.65601 15.7969C5.87276 15.8743 6.14614 15.9265 6.53198 15.958C7.05439 16.0007 7.72256 16.002 8.66675 16.002H11.3337C12.2779 16.002 12.9461 16.0007 13.4685 15.958C13.9829 15.916 14.2976 15.8367 14.5447 15.7109L14.7292 15.6074C15.147 15.3511 15.4879 14.9841 15.7117 14.5449L15.7976 14.3447C15.8751 14.128 15.9272 13.8546 15.9587 13.4688C16.0014 12.9463 16.0017 12.2774 16.0017 11.333V10.833C16.0018 10.466 16.2997 10.1681 16.6667 10.168C17.0339 10.168 17.3316 10.4659 17.3318 10.833V11.333C17.3318 12.2555 17.3331 12.9879 17.2849 13.5771C17.2422 14.0993 17.1584 14.5541 16.9792 14.9717L16.8962 15.1484C16.5609 15.8066 16.0507 16.3571 15.4246 16.7412L15.1492 16.8955C14.6833 17.1329 14.1739 17.2354 13.5769 17.2842C12.9878 17.3323 12.256 17.332 11.3337 17.332H8.66675C7.74446 17.332 7.01271 17.3323 6.42358 17.2842C5.90135 17.2415 5.44665 17.1577 5.02905 16.9785L4.85229 16.8955C4.19396 16.5601 3.64271 16.0502 3.25854 15.4238L3.10425 15.1484C2.86697 14.6827 2.76534 14.1739 2.71655 13.5771C2.66841 12.9879 2.6687 12.2555 2.6687 11.333ZM13.4646 3.11328C14.4201 2.334 15.8288 2.38969 16.7195 3.28027L16.8865 3.46485C17.6141 4.35685 17.6143 5.64423 16.8865 6.53613L16.7195 6.7207L11.6726 11.7686C11.1373 12.3039 10.4624 12.6746 9.72827 12.8408L9.41089 12.8994L7.59351 13.1582C7.38637 13.1877 7.17701 13.1187 7.02905 12.9707C6.88112 12.8227 6.81199 12.6134 6.84155 12.4063L7.10132 10.5898L7.15991 10.2715C7.3262 9.53749 7.69692 8.86241 8.23218 8.32715L13.2791 3.28027L13.4646 3.11328Z"/></svg>`;

    let html = '';

    // New chat option (always shown)
    html += `<div class="search-result-item" onclick="newChat(); closeSearchModal();">${newChatIcon}<span class="search-result-text">New chat</span></div>`;

    // Chat history entries
    const entries = Object.entries(chatHistoryData).sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0));
    const filtered = query ? entries.filter(([, chat]) => chat.title.toLowerCase().includes(query)) : entries;

    if (filtered.length > 0) {
        html += `<div class="search-results-label">${query ? 'Results' : 'Recent chats'}</div>`;
        filtered.forEach(([chatId, chat]) => {
            html += `<div class="search-result-item" data-chat-id="${chatId}">${chatIcon}<span class="search-result-text">${escapeHtml(chat.title)}</span></div>`;
        });
    } else if (query) {
        html += `<div class="search-result-empty">No chats found</div>`;
    }

    resultsContainer.innerHTML = html;

    // Attach click handlers for chat items
    resultsContainer.querySelectorAll('.search-result-item[data-chat-id]').forEach(item => {
        item.addEventListener('click', () => {
            const chatId = item.getAttribute('data-chat-id');
            loadChat(chatId);
            renderChatHistory();
            window.closeSearchModal();
        });
    });
}

// Close search modal with Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('searchModalOverlay');
        if (overlay && overlay.classList.contains('show')) {
            window.closeSearchModal();
        }
    }
});

function selectModel(item) {
    document.querySelectorAll('.model-item').forEach(i => i.classList.remove('selected'));
    const modelId = item.getAttribute('data-model');
    document.querySelectorAll(`[data-model="${modelId}"]`).forEach(i => i.classList.add('selected'));
    currentModel = modelId;

    const badge = document.getElementById('modelBadge');
    if (badge) badge.textContent = item.getAttribute('data-badge');
    const headerName = document.getElementById('headerModelName');
    if (headerName) headerName.textContent = item.getAttribute('data-name');
    saveSelectedModel();
    updateVisionUI();
    closeDropdowns();
}

function updateVisionUI() {
    const modelData = getCurrentModelData();
    const caps = modelData?.capabilities || {};
    const imageBtn = document.getElementById('imageUploadBtn');
    const fileBtn = document.getElementById('fileUploadBtn');
    const imageModeBtn = document.getElementById('imageModeBtn');

    if (imageBtn) imageBtn.style.display = caps.visionInput ? '' : 'none';
    if (fileBtn) fileBtn.style.display = caps.fileInputPdf ? '' : 'none';
    if (imageModeBtn) {
        imageModeBtn.style.display = caps.imageOutput ? '' : 'none';
        imageModeBtn.classList.toggle('active', imageGenerationMode);
    }

    if (!caps.visionInput) {
        pendingImages = [];
        updateImagePreview();
    }

    if (!caps.fileInputPdf) {
        pendingFiles = [];
        updateFilePreview();
    }

    if (!caps.imageOutput && imageGenerationMode) {
        imageGenerationMode = false;
    }
}

window.toggleImageGenerationMode = function () {
    const modelData = getCurrentModelData();
    if (!modelData?.capabilities?.imageOutput) return;
    imageGenerationMode = !imageGenerationMode;
    updateVisionUI();
    handleInput();
};

window.handleFileUpload = function (event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) return;
        if (file.size > 20 * 1024 * 1024) {
            alert('File too large. Maximum size is 20MB.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            pendingFiles.push({
                name: file.name,
                dataUrl: e.target.result,
            });
            updateFilePreview();
            handleInput();
        };
        reader.readAsDataURL(file);
    });
    event.target.value = '';
}

function updateFilePreview() {
    const container = document.getElementById('filePreviewContainer');
    if (!container) return;
    if (pendingFiles.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    container.innerHTML = pendingFiles.map((file, idx) => `
        <div class="file-preview-item" title="${escapeHtml(file.name)}">
            <span class="file-preview-name">${escapeHtml(file.name)}</span>
            <button class="file-preview-remove" onclick="window.removeFile(${idx})">&times;</button>
        </div>
    `).join('');
}

window.removeFile = function (index) {
    pendingFiles.splice(index, 1);
    updateFilePreview();
    handleInput();
}

window.handleImageUpload = function (event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        if (file.size > 20 * 1024 * 1024) { // 20MB limit
            alert('Image too large. Maximum size is 20MB.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            pendingImages.push(e.target.result);
            updateImagePreview();
            handleInput(); // Update send button state
        };
        reader.readAsDataURL(file);
    });
    // Reset file input so same file can be selected again
    event.target.value = '';
}

function updateImagePreview() {
    const container = document.getElementById('imagePreviewContainer');
    if (!container) return;
    if (pendingImages.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    container.innerHTML = pendingImages.map((img, idx) => `
        <div class="image-preview-item">
            <img src="${img}" alt="Preview">
            <button class="image-preview-remove" onclick="window.removeImage(${idx})">&times;</button>
        </div>
    `).join('');
}

window.removeImage = function (index) {
    pendingImages.splice(index, 1);
    updateImagePreview();
    handleInput();
}

window.toggleSidebar = function () {
    const sidebar = document.getElementById('sidebar');
    const rail = document.getElementById('sidebarRail');
    const isOpen = sidebar.classList.toggle('open');
    if (window.innerWidth <= 768) {
        document.getElementById('sidebarOverlay').classList.toggle('show', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
    } else {
        document.getElementById('mainContent').classList.toggle('sidebar-open', isOpen);
        if (rail) rail.classList.toggle('hidden', isOpen);
    }
}

window.closeSidebar = function () {
    const rail = document.getElementById('sidebarRail');
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
    document.body.style.overflow = '';
    if (window.innerWidth > 768) {
        document.getElementById('mainContent').classList.remove('sidebar-open');
        if (rail) rail.classList.remove('hidden');
    }
}

window.toggleModelDropdown = function (event) {
    event.stopPropagation();
    const headerDropdown = document.getElementById('headerModelDropdown');
    const headerChevron = document.getElementById('headerChevron');
    if (headerDropdown) headerDropdown.classList.remove('show');
    if (headerChevron) headerChevron.classList.remove('open');
    const dropdown = document.getElementById('modelDropdown');
    const chevron = document.getElementById('chevron');
    if (dropdown) {
        const isOpen = dropdown.classList.toggle('show');
        if (chevron) chevron.classList.toggle('open', isOpen);
        if (isOpen) {
            const searchInput = dropdown.querySelector('.model-search-input');
            if (searchInput) { searchInput.value = ''; filterModels('', dropdown); setTimeout(() => searchInput.focus(), 50); }
        }
    }
}

window.toggleHeaderModelDropdown = function (event) {
    event.stopPropagation();
    const dropdown = document.getElementById('modelDropdown');
    const chevron = document.getElementById('chevron');
    if (dropdown) dropdown.classList.remove('show');
    if (chevron) chevron.classList.remove('open');
    const headerDropdown = document.getElementById('headerModelDropdown');
    const headerChevron = document.getElementById('headerChevron');

    if (headerDropdown.classList.contains('show')) {
        // Close with animation
        animateDropdownClose(headerDropdown, headerChevron);
    } else {
        // Open
        headerDropdown.classList.add('show');
        if (headerChevron) headerChevron.classList.add('open');
        const searchInput = headerDropdown.querySelector('.model-search-input');
        if (searchInput) { searchInput.value = ''; filterModels('', headerDropdown); setTimeout(() => searchInput.focus(), 50); }
    }
}

function animateDropdownClose(headerDropdown, headerChevron) {
    if (!headerDropdown || !headerDropdown.classList.contains('show')) return;
    headerDropdown.classList.add('closing');
    if (headerChevron) headerChevron.classList.remove('open');
    setTimeout(() => {
        headerDropdown.classList.remove('show', 'closing');
    }, 200);
}

function closeDropdowns() {
    const dropdown = document.getElementById('modelDropdown');
    const chevron = document.getElementById('chevron');
    if (dropdown) dropdown.classList.remove('show');
    if (chevron) chevron.classList.remove('open');
    const headerDropdown = document.getElementById('headerModelDropdown');
    const headerChevron = document.getElementById('headerChevron');
    animateDropdownClose(headerDropdown, headerChevron);
}

window.stopGeneration = function () {
    shouldStopTyping = true;
    if (abortController) abortController.abort();
    removeTypingIndicator();
    cleanupStreamingUI();
    isProcessing = false;
    updateSendButtonState();
}

function cleanupStreamingUI() {
    if (_thinkingTimerRef) {
        clearInterval(_thinkingTimerRef);
        _thinkingTimerRef = null;
    }
    _thinkingStartRef = null;
    _thinkingEndTimeRef = null;

    document.querySelectorAll('.assistant-message-text.streaming').forEach((el) => {
        el.classList.remove('streaming');
    });
    document.querySelectorAll('.streaming-cursor, .streaming-placeholder, .streaming-code-block').forEach((el) => {
        el.remove();
    });
    document.querySelectorAll('.thinking-spinner').forEach((el) => {
        el.remove();
    });

    document.querySelectorAll('#live-thinking-section').forEach((section) => {
        section.removeAttribute('id');
        const label = section.querySelector('.thinking-label');
        if (label && /^Thinking/.test(label.textContent || '')) {
            label.textContent = 'Thought';
        }
        const content = section.querySelector('.thinking-content div');
        const hasContent = !!(content && content.textContent && content.textContent.trim().length > 0);
        if (!hasContent) section.style.display = 'none';
    });
}

function updateSendButtonState() {
    const button = document.getElementById('sendButton');
    const input = document.getElementById('messageInput');
    if (!button || !input) return;

    const hasDraft = input.value.trim() !== '' || pendingImages.length > 0 || pendingFiles.length > 0;
    const isStopMode = isProcessing;
    const mode = isStopMode ? 'stop' : 'send';

    if (button.dataset.mode !== mode) {
        button.innerHTML = isStopMode ? SEND_BUTTON_STOP_ICON : SEND_BUTTON_SEND_ICON;
        button.dataset.mode = mode;
    }

    button.classList.toggle('active', hasDraft || isStopMode);
    button.classList.toggle('is-stop', isStopMode);
    button.disabled = false;
    button.setAttribute('title', isStopMode ? 'Stop generating' : 'Send message');
    button.setAttribute('aria-label', isStopMode ? 'Stop generating' : 'Send message');
}

window.handleSendButtonClick = function () {
    if (isProcessing) {
        window.stopGeneration();
        return;
    }
    window.sendMessage();
}

window.handleInput = function () {
    const input = document.getElementById('messageInput');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    updateSendButtonState();
}

window.handleKeyPress = function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        // On mobile, Enter inserts a newline; use the send button to send
        const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window);
        if (isMobile) return; // let default newline happen
        event.preventDefault();
        window.sendMessage();
    }
}

window.sendSuggestion = function (text) {
    document.getElementById('messageInput').value = text;
    window.handleInput();
    window.sendMessage();
}

window.newChat = function () {
    window.stopGeneration();
    saveCurrentChat();
    if (typeof window.closeCanvas === 'function') window.closeCanvas();
    conversationHistory = [];
    currentChatId = null;
    const suggestionsHTML = suggestionSets[Math.floor(Math.random() * suggestionSets.length)].map(s => `<div class="suggestion-card" onclick="window.sendSuggestion('${s.replace(/'/g, "\\'")}')"><p>${escapeHtml(s)}</p></div>`).join('');
    document.getElementById('chatArea').innerHTML = `<div class="welcome-state" id="welcomeState"><h1 class="welcome-heading">${welcomeHeadings[Math.floor(Math.random() * welcomeHeadings.length)]}</h1><div class="suggestion-grid">${suggestionsHTML}</div></div>`;
    document.getElementById('mainContent').classList.add('welcome-mode');
    messagesContainer = null;
    document.getElementById('messageInput').value = '';
    window.handleInput();
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById('scrollToBottom').classList.remove('show');
    if (window.innerWidth <= 768) window.closeSidebar();
    // Reset temp chat state
    window.isTempChat = false;
    const tempBtn = document.getElementById('tempChatBtn');
    if (tempBtn) tempBtn.classList.remove('active');
}

window.isTempChat = false;

window.toggleTempChat = function () {
    window.isTempChat = !window.isTempChat;
    const tempBtn = document.getElementById('tempChatBtn');
    if (tempBtn) tempBtn.classList.toggle('active', window.isTempChat);

    if (window.isTempChat) {
        // Save current chat before switching to temp mode
        saveCurrentChat();
        window.stopGeneration();
        if (typeof window.closeCanvas === 'function') window.closeCanvas();
        conversationHistory = [];
        currentChatId = null;
        messagesContainer = null;

        const suggestionsHTML = suggestionSets[Math.floor(Math.random() * suggestionSets.length)].map(s => `<div class="suggestion-card" onclick="window.sendSuggestion('${s.replace(/'/g, "\\'")}')"><p>${escapeHtml(s)}</p></div>`).join('');
        document.getElementById('chatArea').innerHTML = `<div class="welcome-state" id="welcomeState"><h1 class="welcome-heading">Temporary Chat</h1><p class="welcome-subtitle">This chat won't appear in your chat history, and won't be used to train our models.</p><div class="suggestion-grid">${suggestionsHTML}</div></div>`;
        document.getElementById('mainContent').classList.add('welcome-mode');
        document.getElementById('messageInput').value = '';
        window.handleInput();
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        document.getElementById('scrollToBottom').classList.remove('show');
        if (window.innerWidth <= 768) window.closeSidebar();
    } else {
        // Exiting temp chat â€” start a fresh regular chat
        conversationHistory = [];
        currentChatId = null;
        messagesContainer = null;

        const suggestionsHTML = suggestionSets[Math.floor(Math.random() * suggestionSets.length)].map(s => `<div class="suggestion-card" onclick="window.sendSuggestion('${s.replace(/'/g, "\\'")}')"><p>${escapeHtml(s)}</p></div>`).join('');
        document.getElementById('chatArea').innerHTML = `<div class="welcome-state" id="welcomeState"><h1 class="welcome-heading">${welcomeHeadings[Math.floor(Math.random() * welcomeHeadings.length)]}</h1><div class="suggestion-grid">${suggestionsHTML}</div></div>`;
        document.getElementById('mainContent').classList.add('welcome-mode');
        document.getElementById('messageInput').value = '';
        window.handleInput();
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        document.getElementById('scrollToBottom').classList.remove('show');
    }
}

function initMessagesContainer() {
    if (!messagesContainer) {
        const welcomeState = document.getElementById('welcomeState');
        if (welcomeState) {
            welcomeState.remove();
            document.getElementById('mainContent').classList.remove('welcome-mode');
        }
        messagesContainer = document.createElement('div');
        messagesContainer.className = 'messages-container';
        document.getElementById('chatArea').appendChild(messagesContainer);
    }
}

function addUserMessage(content, images = [], files = []) {
    initMessagesContainer();
    const chatArea = document.getElementById('chatArea');
    const isScrolledToBottom = chatArea.scrollHeight - chatArea.clientHeight <= chatArea.scrollTop + 10;
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group user';
    let imagesHtml = '';
    if (images.length > 0) {
        imagesHtml = '<div class="user-message-images">' + images.map(img => `<img src="${img}" alt="Attached image" class="user-attached-image" onclick="window.openImageLightbox(this.src)">`).join('') + '</div>';
    }
    let filesHtml = '';
    if (files.length > 0) {
        filesHtml = '<div class="user-message-files">' + files.map(file => `<div class="user-attached-file">${escapeHtml(file.name || 'document.pdf')}</div>`).join('') + '</div>';
    }
    messageGroup.innerHTML = `<div class="user-message-content"><div class="user-message-bubble">${imagesHtml}${filesHtml}<div class="user-message-text">${escapeHtml(content)}</div></div><div class="assistant-actions"><button class="assistant-action-btn" onclick="window.copyUserMessage(this)"><svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg></button><button class="assistant-action-btn" title="Edit message" onclick="window.editUserMessage(this)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button></div></div>`;
    messagesContainer.appendChild(messageGroup);
    updateEditButtonVisibility();
    if (isScrolledToBottom) scrollToBottom(true);
}

function parseUserContentForRender(content) {
    if (!Array.isArray(content)) {
        return { text: String(content || ''), images: [], files: [] };
    }

    const images = [];
    const files = [];
    const textParts = [];

    content.forEach((part) => {
        if (!part || typeof part !== 'object') return;
        if (part.type === 'text' && part.text) textParts.push(part.text);
        if (part.type === 'image_url' && part.image_url?.url) images.push(part.image_url.url);
        if (part.type === 'file' && part.file) {
            files.push({ name: part.file.filename || 'document.pdf' });
        }
    });

    return { text: textParts.join('\n').trim(), images, files };
}

// Show edit button only on the last user message
function updateEditButtonVisibility() {
    if (!messagesContainer) return;
    const userGroups = messagesContainer.querySelectorAll('.message-group.user');
    userGroups.forEach(g => g.classList.remove('edit-eligible'));
    if (userGroups.length > 0) {
        userGroups[userGroups.length - 1].classList.add('edit-eligible');
    }
}

// --- Core Logic ---

/** Build HTML for source cards (shared by streaming and history rendering) */
function buildSourcesHtml(sources) {
    const PREVIEW_SOURCES_COUNT = 4;
    const hasOverflow = Array.isArray(sources) && sources.length > PREVIEW_SOURCES_COUNT;
    let html = '<div class="search-sources"><div class="search-sources-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Sources</div><div class="search-sources-list' + (hasOverflow ? ' collapsed' : '') + '">';
    for (const src of sources) {
        let domain = src.url;
        try { domain = new URL(src.url).hostname.replace('www.', ''); } catch { }
        const title = (src.title || '').length > 50 ? src.title.slice(0, 47) + '...' : (src.title || src.url);
        const escapedTitle = (src.title || '').replace(/"/g, '&quot;');
        html += `<a href="${src.url}" target="_blank" rel="noopener noreferrer" class="source-card" title="${escapedTitle}">
            <span class="source-card-title">${title}</span>
            <span class="source-card-domain">${domain}</span>
        </a>`;
    }
    html += '</div>';
    if (hasOverflow) {
        html += `<button class="search-sources-toggle" type="button" onclick="window.toggleSourcesList(this)" aria-expanded="false">Show all sources (${sources.length})</button>`;
    }
    html += '</div>';
    return html;
}

window.toggleSourcesList = function (button) {
    const container = button.closest('.search-sources');
    const list = container ? container.querySelector('.search-sources-list') : null;
    if (!list) return;

    const isCollapsed = list.classList.toggle('collapsed');
    button.setAttribute('aria-expanded', String(!isCollapsed));
    const total = list.querySelectorAll('.source-card').length;
    button.textContent = isCollapsed ? `Show all sources (${total})` : 'Show fewer sources';
};

function getStreamingResponseMode(isWritingCode = false) {
    if (isWritingCode || activeStreamContext.canvasModeAtRequest) return 'code';
    if (activeStreamContext.searchEnabledAtRequest) return 'search';
    return 'normal';
}

function buildResponseActivity(mode = 'normal', compact = false) {
    const activity = {
        normal: {
            label: 'Composing response',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 12h16M12 4v16" stroke-width="1.8" stroke-linecap="round"/></svg>'
        },
        search: {
            label: 'Searching the web',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7" stroke-width="1.8"/><path d="m20 20-3.5-3.5" stroke-width="1.8" stroke-linecap="round"/></svg>'
        },
        code: {
            label: 'Building code',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        }
    };
    const selected = activity[mode] || activity.normal;
    const compactClass = compact ? ' response-activity--compact' : '';
    return `<div class="response-activity response-activity--${mode}${compactClass}">
        <span class="response-activity-icon">${selected.icon}</span>
        <span class="response-activity-label">${selected.label}</span>
        <span class="response-activity-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
    </div>`;
}

async function addAssistantMessage(content, showTyping = true, sources = null) {
    initMessagesContainer();
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group assistant';
    const chatArea = document.getElementById('chatArea');

    let imagePayload = null;
    if (typeof content === 'string' && content.startsWith('__IMAGE_RESPONSE__')) {
        try {
            imagePayload = JSON.parse(content.slice('__IMAGE_RESPONSE__'.length));
            content = imagePayload?.text || '';
        } catch {
            imagePayload = null;
        }
    }

    let thinkingContent = '';
    let finalContent = content;
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
        thinkingContent = thinkMatch[1].trim();
        finalContent = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    }

    let html = '<div class="assistant-message-content">';
    if (thinkingContent) {
        html += `
            <div class="thinking-section">
                <div class="thinking-header" onclick="window.toggleThinking(this)">
                    <svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke-width="2" stroke-linecap="round"/></svg>
                    <span class="thinking-label">Thought</span>
                    <svg class="thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round"/></svg>
                </div>
                <div class="thinking-content"><div>${formatThinkingContent(thinkingContent)}</div></div>
            </div>`;
    }

    html += `
        <div class="assistant-message-text"></div>`;

    // Render source cards if provided (for loaded chats)
    if (sources && Array.isArray(sources) && sources.length > 0) {
        html += buildSourcesHtml(sources);
    }

    html += `
        <div class="assistant-actions">
            <button class="assistant-action-btn" onclick="window.copyAssistantMessage(this)">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
            </button>
            <button class="assistant-action-btn" title="Copy rich text for Google Docs" onclick="window.copyAssistantForDocs(this)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-width="2"/><path d="M14 2v6h6" stroke-width="2"/><path d="M8 13h8M8 17h8M8 9h3" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <button class="assistant-action-btn" title="Retry" onclick="window.retryLastMessage(this)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
        </div>
    </div>`;

    messageGroup.innerHTML = html;
    messagesContainer.appendChild(messageGroup);
    const textDiv = messageGroup.querySelector('.assistant-message-text');

    // Render full content immediately — no typing animation for history/loaded messages
    textDiv.innerHTML = canvasMode ? formatContentForCanvas(finalContent) : formatContent(finalContent);
    if (imagePayload?.images?.length) {
        const imagesHtml = imagePayload.images.map((image) => {
            const src = image.url ? image.url : (image.b64 ? `data:image/png;base64,${image.b64}` : '');
            if (!src) return '';
            return `<img src="${src}" alt="Generated image" class="assistant-generated-image" onclick="window.openImageLightbox(this.src)">`;
        }).join('');
        if (imagesHtml) {
            textDiv.innerHTML += `<div class="assistant-generated-images">${imagesHtml}</div>`;
        }
    }

    renderMathInElement(messageGroup, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false });
    messageGroup.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));

    const isScrolledToBottom = chatArea.scrollHeight - chatArea.clientHeight <= chatArea.scrollTop + 10;
    if (isScrolledToBottom) scrollToBottom(true);
}

function showTypingIndicator() {
    initMessagesContainer();
    const chatArea = document.getElementById('chatArea');
    const isScrolledToBottom = chatArea.scrollHeight - chatArea.clientHeight <= chatArea.scrollTop + 10;
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group assistant';
    messageGroup.id = 'typing-indicator-group';
    const currentModelData = getCurrentModelData();
    let html = '<div class="assistant-message-content">';
    if (currentModelData?.capabilities?.reasoning) html += `<div class="thinking-section"><div class="thinking-header"><svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke-width="2" stroke-linecap="round"/></svg><span class="thinking-label">Thinking</span><div class="thinking-spinner"><span></span><span></span><span></span><span></span></div></div></div>`;
    html += `${buildResponseActivity(getStreamingResponseMode(false))}</div>`;
    messageGroup.innerHTML = html;
    messagesContainer.appendChild(messageGroup);
    if (isScrolledToBottom) scrollToBottom(true);
}

function removeTypingIndicator() { const indicator = document.getElementById('typing-indicator-group'); if (indicator) indicator.remove(); }
window.toggleThinking = function (header) { header.nextElementSibling.classList.toggle('show'); header.querySelector('.thinking-toggle').classList.toggle('expanded'); }
window.copyCode = function (button, code) { navigator.clipboard.writeText(code).then(() => { const originalText = button.innerHTML; button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; button.classList.add('copied'); setTimeout(() => { button.innerHTML = originalText; button.classList.remove('copied'); }, 2000); }); }

window.toggleSearchMode = function () {
    searchEnabled = !searchEnabled;
    localStorage.setItem('searchEnabled', searchEnabled);
    const btn = document.getElementById('searchToggle');
    if (btn) {
        btn.classList.toggle('active', searchEnabled);
        btn.title = searchEnabled
            ? 'Web search ON — AI will search the internet'
            : 'Enable web search — AI can search for live info';
    }
};

window.toggleCanvasMode = function () {
    canvasMode = !canvasMode;
    const btn = document.getElementById('canvasToggle');
    if (btn) {
        btn.classList.toggle('active', canvasMode);
        btn.title = canvasMode
            ? 'Canvas mode ON — AI will edit code directly'
            : 'Enable canvas mode — AI can edit code directly';
    }
};

window.applyToCanvas = function (code, lang) {
    if (typeof window.getCanvasState === 'function' && window.getCanvasState().isOpen) {
        // Canvas is open — update the code in place
        window.updateCanvasCode(code);
        window.switchCanvasTab('code');
    } else {
        // Canvas not open — open it with this code
        window.openCanvas(code, lang);
    }
};

// Agent-style canvas: extract code blocks, auto-apply to canvas, show only text in chat
function formatContentForCanvas(raw) {
    if (!raw) return '<p></p>';

    // Extract all code blocks
    const codeBlocks = [];
    const textOnly = raw.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        codeBlocks.push({ lang: (lang || 'html').toLowerCase(), code: code.trim() });
        return ''; // Remove code block from text
    });

    // Auto-apply the best code block to canvas
    if (codeBlocks.length > 0) {
        // Pick the largest code block (most likely the main one)
        const best = codeBlocks.reduce((a, b) => a.code.length >= b.code.length ? a : b);

        // Use setTimeout so canvas updates after DOM render completes
        setTimeout(() => {
            if (typeof window.updateCanvasCodeAndPreview === 'function') {
                window.updateCanvasCodeAndPreview(best.code, best.lang);
            }
        }, 100);
    }

    // Clean up the remaining text (remove excess whitespace from stripped blocks)
    let cleanText = textOnly.replace(/\n{3,}/g, '\n\n').trim();

    // If no text left, just return the badge
    if (!cleanText) {
        return `<div class="canvas-applied-badge" onclick="window.openCanvasPreview()" style="cursor:pointer" title="Click to open canvas preview">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
            Code applied to canvas
        </div>`;
    }

    // Format the remaining text normally
    let result = formatContent(cleanText);

    // Append "applied to canvas" badge if we extracted code
    if (codeBlocks.length > 0) {
        result += `<div class="canvas-applied-badge" onclick="window.openCanvasPreview()" style="cursor:pointer" title="Click to open canvas preview">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
            Code applied to canvas
        </div>`;
    }

    return result;
}

function formatContent(raw) {
    if (!raw) return '<p></p>';

    // 1. Extract code blocks BEFORE escaping (preserve raw content)
    const blocks = [];
    let text = raw.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        blocks.push({ lang: (lang || 'plaintext').toLowerCase(), code: code.trim() });
        return `\n[[[BLOCK_${blocks.length - 1}]]]\n`;
    });

    // 2. Extract math expressions BEFORE escaping to preserve LaTeX
    const mathBlocks = [];
    // Display math: \[...\] (LaTeX standard, can span multiple lines)
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match, math) => {
        mathBlocks.push({ display: true, content: math, delim: '\\[' });
        return `\n[[[MATH_${mathBlocks.length - 1}]]]\n`;
    });
    // Display math: $$...$$ (can span multiple lines)
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
        mathBlocks.push({ display: true, content: math, delim: '$$' });
        return `\n[[[MATH_${mathBlocks.length - 1}]]]\n`;
    });
    // Inline math: \(...\) (LaTeX standard)
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match, math) => {
        mathBlocks.push({ display: false, content: math, delim: '\\(' });
        return `[[[MATH_${mathBlocks.length - 1}]]]`;
    });
    // Inline math: $...$ (single line, not greedy)
    text = text.replace(/\$([^\$\n]+?)\$/g, (match, math) => {
        mathBlocks.push({ display: false, content: math, delim: '$' });
        return `[[[MATH_${mathBlocks.length - 1}]]]`;
    });

    // 3. Now escape HTML (math and code are safely extracted)
    text = escapeHtml(text);

    // 4. Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 5. Markdown formatting
    text = text
        .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
        .replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*?<\/li>\n?)+/gs, match => match.includes('1.') ? `<ol>${match}</ol>` : `<ul>${match}</ul>`)
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // 5b. Horizontal rules
    text = text.replace(/^---$/gm, '<hr>');

    // 5c. Markdown tables
    text = text.replace(/((?:^\|.+\|[ \t]*$\n?)+)/gm, (tableBlock) => {
        const rows = tableBlock.trim().split('\n').filter(r => r.trim());
        if (rows.length < 2) return tableBlock;
        // Check if second row is a separator (|---|---|)
        const sepRow = rows[1].trim();
        if (!/^\|[\s\-:|]+\|$/.test(sepRow)) return tableBlock;

        const parseRow = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
        const renderTableCell = (cell) => {
            // Allow only escaped <br> tags to render as line breaks in table cells.
            return cell.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
        };

        const headers = parseRow(rows[0]);
        let html = '<table><thead><tr>';
        headers.forEach(h => { html += `<th>${renderTableCell(h)}</th>`; });
        html += '</tr></thead><tbody>';

        for (let i = 2; i < rows.length; i++) {
            const cells = parseRow(rows[i]);
            html += '<tr>';
            cells.forEach(c => { html += `<td>${renderTableCell(c)}</td>`; });
            html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
    });

    // 5d. Links ([label](https://...)) and plain URLs
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, label, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    text = text.replace(/(^|[\s(])((https?:\/\/)[^\s<]+)/g, (match, prefix, url) => {
        return `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });

    // 6. Paragraphs (skip math/code placeholders)
    const paragraphs = text.split(/\n{2,}/).map(p => {
        p = p.trim();
        if (!p) return '';
        if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol>') || p.startsWith('<blockquote>') || p.startsWith('<table') || p.startsWith('<hr') || p.startsWith('[[[BLOCK_') || p.startsWith('[[[MATH_')) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    let html = paragraphs;

    // 7. Restore math expressions (raw LaTeX, unescaped) with original delimiters
    mathBlocks.forEach((m, idx) => {
        const openDelim = m.delim;
        const closeDelim = m.delim === '\\[' ? '\\]' : m.delim === '\\(' ? '\\)' : m.delim;
        html = html.replace(`[[[MATH_${idx}]]]`, `${openDelim}${m.content}${closeDelim}`);
    });

    // 8. Restore code blocks (escape code content for safe display)
    blocks.forEach((b, idx) => {
        const langClass = `language-${b.lang}`;
        const codeJson = JSON.stringify(b.code).replace(/"/g, '&quot;');
        const langJson = JSON.stringify(b.lang).replace(/"/g, '&quot;');
        const replacement = `<div class="code-block-wrapper">
                                <div class="code-block-header">
                                    <span class="code-language">${b.lang === 'plaintext' ? 'text' : b.lang}</span>
                                    <div class="code-block-actions">
                                        <button class="code-run-btn" onclick="window.openCanvas(${codeJson}, ${langJson})" title="Run code">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                                            Run
                                        </button>
                                        <button class="code-copy-btn" onclick="window.copyCode(this, ${codeJson})">
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
                                        </button>
                                    </div>
                                </div>
                                <pre><code class="${langClass}">${escapeHtml(b.code)}</code></pre>
                             </div>`;
        html = html.replace(`[[[BLOCK_${idx}]]]`, replacement);
    });
    return html || '<p></p>';
}


window.sendMessage = async function () {
    const hasSupportedModel = await ensureCurrentModelSupported(true, true);
    if (!hasSupportedModel) {
        showToast('No supported models are currently available.', 'error');
        return;
    }

    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const images = [...pendingImages]; // snapshot before clearing
    const files = [...pendingFiles];
    if ((!message && images.length === 0 && files.length === 0) || isProcessing) return;

    shouldStopTyping = false;
    abortController = new AbortController();

    if (!currentChatId && !window.isTempChat) {
        currentChatId = Date.now().toString();
        chatHistoryData[currentChatId] = {
            title: message.substring(0, 30) + (message.length > 30 ? '...' : ''),
            messages: [],
            createdAt: Date.now()
        };
    }

    addUserMessage(message, images, files);
    input.value = '';
    input.style.height = 'auto';
    pendingImages = [];
    pendingFiles = [];
    updateImagePreview();
    updateFilePreview();
    handleInput();

    // Build message content for API
    let messageContent;
    if (images.length > 0 || files.length > 0) {
        messageContent = [];
        images.forEach(img => {
            messageContent.push({ type: 'image_url', image_url: { url: img } });
        });
        files.forEach(file => {
            messageContent.push({
                type: 'file',
                file: {
                    filename: file.name,
                    file_data: file.dataUrl,
                },
            });
        });
        if (message) {
            messageContent.push({ type: 'text', text: message });
        }
    } else {
        messageContent = message;
    }
    conversationHistory.push({ role: 'user', content: messageContent });

    activeStreamContext = { searchEnabledAtRequest: false, canvasModeAtRequest: false };

    if (imageGenerationMode) {
        isProcessing = true;
        updateSendButtonState();
        showTypingIndicator();
        try {
            const imageResponse = await fetch(API_IMAGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: currentModel,
                    prompt: message || 'Generate an image',
                }),
                signal: abortController.signal,
            });

            removeTypingIndicator();
            const imagePayload = await imageResponse.json().catch(() => ({}));
            if (!imageResponse.ok) {
                throw new Error(imagePayload?.error || 'Image generation failed.');
            }

            const marker = `__IMAGE_RESPONSE__${JSON.stringify(imagePayload)}`;
            addAssistantMessage(marker, false);
            conversationHistory.push({ role: 'assistant', content: marker });
            saveCurrentChat();
            renderChatHistory();
        } catch (error) {
            removeTypingIndicator();
            if (error.name !== 'AbortError') {
                showToast('Error: ' + error.message, 'error');
            }
        } finally {
            isProcessing = false;
            shouldStopTyping = false;
            abortController = null;
            updateSendButtonState();
        }
        return;
    }

    // Reset accumulated content for new turn
    accumulatedContent = '';
    accumulatedReasoning = '';
    insideThinkTag = false;
    renderQueue = [];
    isRendering = false;
    isAutoScrollEnabled = true;
    activeStreamContext = {
        searchEnabledAtRequest: searchEnabled,
        canvasModeAtRequest: canvasMode
    };

    isProcessing = true;
    updateSendButtonState();
    showTypingIndicator();

    let assistantMessageContent = '';
    let messageGroup;

    try {
        // Build messages with optional canvas context
        let messagesForAPI = [...conversationHistory];

        // If canvas mode is ON, inject code context
        if (canvasMode) {
            let canvasSystemContent;
            // Check if canvas is open with code
            if (typeof window.getCanvasState === 'function') {
                const canvas = window.getCanvasState();
                canvasSystemContent = buildCanvasSystemPrompt(canvas);
                if (canvas.isOpen && canvas.code) {
                    canvasSystemContent += `\n\nCurrent code in canvas:\n\`\`\`${canvas.lang}\n${canvas.code}\n\`\`\``;
                }
            } else {
                canvasSystemContent = buildCanvasSystemPrompt(null);
            }
            messagesForAPI = [{ role: 'system', content: canvasSystemContent }, ...messagesForAPI];
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: currentModel,
                messages: messagesForAPI,
                searchEnabled: searchEnabled
            }),
            signal: abortController.signal
        });

        removeTypingIndicator();

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: 'An unknown error occurred.' } }));
            throw new Error(error.error.message);
        }

        initMessagesContainer();
        messageGroup = document.createElement('div');
        messageGroup.className = 'message-group assistant';

        // Always create thinking section (hidden), reveal dynamically when reasoning arrives
        let thinkingStartTime = null;
        let thinkingTimerInterval = null;
        let thinkingEndTime = null;
        let initialHtml = `<div class="assistant-message-content">
                <div class="thinking-section" id="live-thinking-section" style="display:none;">
                    <div class="thinking-header" onclick="window.toggleThinking(this)">
                        <svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke-width="2" stroke-linecap="round"/></svg>
                        <span class="thinking-label">Thinking</span>
                        <div class="thinking-spinner"><span></span><span></span><span></span><span></span></div>
                        <svg class="thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round"/></svg>
                    </div>
                    <div class="thinking-content" id="live-thinking-content"><div></div></div>
                </div>
                <div class="assistant-message-text">${buildResponseActivity(getStreamingResponseMode(false))}</div>
            </div> `;

        messageGroup.innerHTML = initialHtml;
        messagesContainer.appendChild(messageGroup);
        const assistantMessageContainer = messageGroup.querySelector('.assistant-message-text');
        assistantMessageContainer.classList.add('streaming');
        const thinkingContentContainer = messageGroup.querySelector('#live-thinking-content');
        const thinkingSection = messageGroup.querySelector('#live-thinking-section');
        let thinkingRevealed = false;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Track full content locally for history saving
        let reasoningContent = '';
        let fullAssistantContent = '';
        let searchSources = []; // Collected from SSE 'sources' event
        let currentSSEEvent = ''; // Track custom SSE event types

        // --- Loop / repetition detection ---
        let loopCheckCounter = 0;
        const LOOP_CHECK_INTERVAL = 200; // Check every N content chars
        const LOOP_PATTERN_MIN_LEN = 40; // Minimum pattern length to detect
        const LOOP_REPEAT_THRESHOLD = 3; // Repeats needed to trigger abort
        let loopDetected = false;

        function detectLoop(text) {
            if (text.length < LOOP_PATTERN_MIN_LEN * LOOP_REPEAT_THRESHOLD) return false;
            // Check for repeating patterns in the last portion of text
            const tail = text.slice(-800);
            for (let patLen = LOOP_PATTERN_MIN_LEN; patLen <= Math.floor(tail.length / LOOP_REPEAT_THRESHOLD); patLen++) {
                const pattern = tail.slice(-patLen);
                let count = 0;
                let pos = tail.length - patLen;
                while (pos >= 0) {
                    if (tail.slice(pos, pos + patLen) === pattern) {
                        count++;
                        pos -= patLen;
                    } else {
                        break;
                    }
                }
                if (count >= LOOP_REPEAT_THRESHOLD) return true;
            }
            return false;
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done || shouldStopTyping) {
                if (shouldStopTyping) reader.cancel();
                break;
            }

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                // Track custom SSE event types (e.g. 'event: sources')
                if (line.startsWith('event: ')) {
                    currentSSEEvent = line.substring(7).trim();
                    continue;
                }
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data.trim() === '[DONE]') break;

                    // Handle custom 'sources' event
                    if (currentSSEEvent === 'sources') {
                        try {
                            const sources = JSON.parse(data);
                            if (Array.isArray(sources)) searchSources = sources;
                        } catch { }
                        currentSSEEvent = '';
                        continue;
                    }
                    currentSSEEvent = ''; // Reset for normal data events

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices[0]?.delta;

                        // Push to render queue for UI
                        if (delta) {
                            renderQueue.push(delta);
                            if (!isRendering) processRenderQueue(assistantMessageContainer, thinkingContentContainer, thinkingSection, () => {
                                if (!thinkingStartTime) thinkingStartTime = Date.now();
                                thinkingRevealed = true;
                            });

                            // Synchronously accumulate for history
                            if (delta.reasoning_content || delta.reasoning) {
                                if (!thinkingStartTime) thinkingStartTime = Date.now();
                                _thinkingStartRef = thinkingStartTime;
                                // Start live thinking timer (only once)
                                if (!thinkingTimerInterval && thinkingSection) {
                                    const labelEl = thinkingSection.querySelector('.thinking-label');
                                    if (labelEl) {
                                        thinkingTimerInterval = setInterval(() => {
                                            const elapsed = Math.round((Date.now() - thinkingStartTime) / 1000);
                                            labelEl.textContent = `Thinking... ${elapsed}s`;
                                        }, 1000);
                                        _thinkingTimerRef = thinkingTimerInterval;
                                    }
                                }
                                reasoningContent += (delta.reasoning_content || delta.reasoning);
                            }
                            // Also start timer for <think> tags in content
                            if (delta.content && delta.content.includes('<think>') && !thinkingTimerInterval && thinkingSection) {
                                if (!thinkingStartTime) thinkingStartTime = Date.now();
                                _thinkingStartRef = thinkingStartTime;
                                const labelEl = thinkingSection.querySelector('.thinking-label');
                                if (labelEl) {
                                    thinkingTimerInterval = setInterval(() => {
                                        const elapsed = Math.round((Date.now() - thinkingStartTime) / 1000);
                                        labelEl.textContent = `Thinking... ${elapsed}s`;
                                    }, 1000);
                                    _thinkingTimerRef = thinkingTimerInterval;
                                }
                            }
                            if (delta.content) {
                                fullAssistantContent += delta.content;
                                // Loop detection: check periodically
                                loopCheckCounter += delta.content.length;
                                if (loopCheckCounter >= LOOP_CHECK_INTERVAL) {
                                    loopCheckCounter = 0;
                                    if (detectLoop(fullAssistantContent)) {
                                        loopDetected = true;
                                        reader.cancel();
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                }
            }
            if (loopDetected) break;
        }

        // Wait for render queue to drain before finalizing
        while (renderQueue.length > 0 || isRendering) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Use accumulated values from the render engine (which already parsed <think> tags in real-time)
        // Read AFTER drain so all reasoning is captured
        let thinkingContent = accumulatedReasoning || reasoningContent;
        let finalContent = accumulatedContent || fullAssistantContent;

        // Build final HTML
        // Stop live thinking timer if still running
        if (thinkingTimerInterval) { clearInterval(thinkingTimerInterval); thinkingTimerInterval = null; }
        // Use saved end time (when content started) or fall back to now
        const thinkingDuration = thinkingStartTime ? Math.round(((thinkingEndTime || _thinkingEndTimeRef || Date.now()) - thinkingStartTime) / 1000) : null;
        const thinkingLabel = thinkingDuration ? `Thought for ${thinkingDuration}s` : 'Thought';

        let finalHtml = '<div class="assistant-message-content">';

        if (thinkingContent || thinkingStartTime) {
            finalHtml += `
    <div class="thinking-section">
                    <div class="thinking-header" onclick="window.toggleThinking(this)">
                        <svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke-width="2" stroke-linecap="round"/></svg>
                        <span class="thinking-label">${thinkingLabel}</span>
                        <svg class="thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round"/></svg>
                    </div>
                    <div class="thinking-content"><div>${formatThinkingContent(thinkingContent)}</div></div>
                </div>
    `;
        }

        const formattedContent = canvasMode ? formatContentForCanvas(finalContent) : formatContent(finalContent);

        finalHtml += `
    <div class="assistant-message-text"> ${formattedContent}</div>`;

        // Add search source cards if available
        if (searchSources.length > 0) {
            finalHtml += buildSourcesHtml(searchSources);
        }

        finalHtml += `
        <div class="assistant-actions">
            <button class="assistant-action-btn" onclick="window.copyAssistantMessage(this)">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
            </button>
            <button class="assistant-action-btn" title="Copy rich text for Google Docs" onclick="window.copyAssistantForDocs(this)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-width="2"/><path d="M14 2v6h6" stroke-width="2"/><path d="M8 13h8M8 17h8M8 9h3" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <button class="assistant-action-btn" title="Retry" onclick="window.retryLastMessage(this)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
        </div>
        </div> `;

        messageGroup.innerHTML = finalHtml;
        // Remove streaming class from finalized content
        const finalTextEl = messageGroup.querySelector('.assistant-message-text');
        if (finalTextEl) finalTextEl.classList.remove('streaming');
        renderMathInElement(messageGroup, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false });
        messageGroup.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));

        if (!shouldStopTyping) {
            // Store both content and reasoning for history
            const fullContent = thinkingContent ? `<think>${thinkingContent}</think>\n\n${finalContent}` : finalContent;
            conversationHistory.push({ role: 'assistant', content: fullContent, sources: searchSources.length > 0 ? searchSources : undefined });
            saveCurrentChat();
            renderChatHistory();
        }

        // Show loop detection warning if triggered
        if (loopDetected && messageGroup) {
            const warningEl = document.createElement('div');
            warningEl.className = 'loop-warning';
            warningEl.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>Response stopped — repetitive loop detected. Try rephrasing your prompt or switching models.</span>
            `;
            const contentEl = messageGroup.querySelector('.assistant-message-content');
            if (contentEl) contentEl.appendChild(warningEl);
            showToast('Loop detected — response auto-stopped to save quota', 'warning');
        }

    } catch (error) {
        removeTypingIndicator();
        if (error.name !== 'AbortError') {
            showToast('Error: ' + error.message, 'error');
            console.error('Error:', error);
            if (messageGroup) {
                messageGroup.innerHTML = `<div class="assistant-message-content"> <div class="assistant-message-text"><p style="color: var(--accent-error);">Sorry, an error occurred.</p></div></div> `;
            }
        }
    } finally {
        isProcessing = false;
        if (shouldStopTyping) cleanupStreamingUI();
        shouldStopTyping = false;
        updateSendButtonState();
        abortController = null;
    }
}

// Adaptive Render Engine
let accumulatedContent = '';
let accumulatedReasoning = '';
let insideThinkTag = false;
let _thinkingTimerRef = null; // module-level ref so processRenderQueue can stop it
let _thinkingStartRef = null;
let _thinkingEndTimeRef = null;

// Format reasoning/thinking content into readable paragraphs
function formatThinkingContent(text) {
    if (!text) return '';
    // First, if the text already has paragraph breaks, use formatContent directly
    if (text.includes('\n\n')) {
        return formatContent(text);
    }
    // Break at common reasoning transition markers
    // These indicate shifts in the AI's thinking
    const markers = [
        /(?<=\. )(Wait[,.])/g,
        /(?<=\. )(But wait[,.])/g,
        /(?<=\. )(Actually[,.])/g,
        /(?<=\. )(Hmm[,.])/g,
        /(?<=\. )(Let me )/g,
        /(?<=\. )(Let's )/g,
        /(?<=\. )(Now[,] )/g,
        /(?<=\. )(So[,] )/g,
        /(?<=\. )(OK[,. ])/gi,
        /(?<=\. )(First[,] )/g,
        /(?<=\. )(Next[,] )/g,
        /(?<=\. )(Then[,] )/g,
        /(?<=\. )(Therefore[,] )/g,
        /(?<=\. )(However[,] )/g,
        /(?<=\. )(Also[,] )/g,
        /(?<=\. )(Since )/g,
        /(?<=\. )(Because )/g,
        /(?<=\. )(This means )/g,
        /(?<=\. )(That means )/g,
        /(?<=\. )(In other words[,] )/g,
        /(?<=\. )(Alternatively[,] )/g,
        /(?<=\. )(The answer )/g,
        /(?<=\. )(Wait, maybe )/g,
        /(?<=\. )(Yes[,.!] )/g,
        /(?<=\. )(No[,.!] )/g,
    ];

    let formatted = text;
    for (const marker of markers) {
        formatted = formatted.replace(marker, '\n\n$1');
    }

    return formatContent(formatted);
}

/**
 * Strip trailing incomplete code/LaTeX blocks from text for clean live display.
 * Returns { displayText, isWritingCode, isWritingMath } so the caller can
 * show appropriate placeholders.
 */
function getDisplayableContent(text) {
    const sourceText = text || '';
    let displayText = sourceText;
    let isWritingCode = false;
    let isWritingMath = false;
    let unclosedCodeLang = 'plaintext';
    let unclosedCodeContent = '';

    // Count triple-backticks. If odd, we have an unclosed code block.
    const backtickMatches = displayText.match(/```/g);
    if (backtickMatches && backtickMatches.length % 2 !== 0) {
        const lastOpen = displayText.lastIndexOf('```');
        const fenceTail = displayText.substring(lastOpen + 3);
        const firstNewline = fenceTail.indexOf('\n');
        let lang = 'plaintext';
        let code = '';

        if (firstNewline !== -1) {
            lang = fenceTail.substring(0, firstNewline).trim() || 'plaintext';
            code = fenceTail.substring(firstNewline + 1);
        } else {
            lang = fenceTail.trim() || 'plaintext';
        }

        unclosedCodeLang = normalizeCodeLang(lang);
        unclosedCodeContent = code;
        displayText = displayText.substring(0, lastOpen);
        isWritingCode = true;
    }

    // Check for unclosed display math $$ … $$
    const ddMatches = displayText.match(/\$\$/g);
    if (ddMatches && ddMatches.length % 2 !== 0) {
        const lastOpen = displayText.lastIndexOf('$$');
        displayText = displayText.substring(0, lastOpen);
        isWritingMath = true;
    }

    // Check for unclosed \[ … \]
    const openBracket = (displayText.match(/\\\[/g) || []).length;
    const closeBracket = (displayText.match(/\\\]/g) || []).length;
    if (openBracket > closeBracket) {
        const lastOpen = displayText.lastIndexOf('\\[');
        displayText = displayText.substring(0, lastOpen);
        isWritingMath = true;
    }

    // Check for unclosed \( … \)
    const openParen = (displayText.match(/\\\(/g) || []).length;
    const closeParen = (displayText.match(/\\\)/g) || []).length;
    if (openParen > closeParen) {
        const lastOpen = displayText.lastIndexOf('\\(');
        displayText = displayText.substring(0, lastOpen);
        isWritingMath = true;
    }

    const closedFenceCount = (displayText.match(/```/g) || []).length;
    const completeCodeBlockCount = Math.floor(closedFenceCount / 2);

    return {
        displayText: displayText.trimEnd(),
        isWritingCode,
        isWritingMath,
        unclosedCodeLang,
        unclosedCodeContent,
        completeCodeBlockCount
    };
}

/**
 * Check if math delimiters are all closed before rendering KaTeX.
 */
function hasUnclosedMath(text) {
    if (!text) return false;
    const codeBlocks = (text.match(/```/g) || []).length;
    if (codeBlocks % 2 !== 0) return true;
    const doubleDollar = (text.match(/\$\$/g) || []).length;
    if (doubleDollar % 2 !== 0) return true;
    const openBracket = (text.match(/\\\[/g) || []).length;
    const closeBracket = (text.match(/\\\]/g) || []).length;
    if (openBracket > closeBracket) return true;
    const openParen = (text.match(/\\\(/g) || []).length;
    const closeParen = (text.match(/\\\)/g) || []).length;
    if (openParen > closeParen) return true;
    return false;
}

function normalizeCodeLang(lang) {
    const normalized = String(lang || 'plaintext').toLowerCase().trim();
    const cleaned = normalized.replace(/[^a-z0-9_+\-#]/g, '');
    return cleaned || 'plaintext';
}

function getAdaptiveRenderIntervalMs(queueSize) {
    if (queueSize > 240) return 22;
    if (queueSize > 120) return 32;
    if (queueSize > 40) return 48;
    return 68;
}

function buildStreamingRenderState(rawText) {
    const { displayText, isWritingCode, isWritingMath, unclosedCodeLang, unclosedCodeContent, completeCodeBlockCount } = getDisplayableContent(rawText);
    const responseMode = getStreamingResponseMode(isWritingCode);
    const activityHtml = buildResponseActivity(responseMode, displayText.trim().length > 0);
    let rendered = formatContent(displayText);

    if (isWritingCode) {
        const lang = normalizeCodeLang(unclosedCodeLang);
        const langLabel = lang === 'plaintext' ? 'code' : lang;
        rendered += `<div class="streaming-code-block">
            <div class="streaming-code-block-header">${escapeHtml(langLabel)} <span>streaming</span></div>
            <pre><code class="language-${lang}">${escapeHtml(unclosedCodeContent || '')}</code></pre>
        </div>`;
    } else if (isWritingMath) {
        rendered += '<div class="streaming-placeholder"><div class="streaming-placeholder-dots"><span></span><span></span><span></span></div><span>Writing math...</span></div>';
    }

    if (!isWritingCode) {
        rendered += '<span class="streaming-cursor">|</span>';
    }

    rendered = `${activityHtml}${rendered}`;
    const signature = `${displayText.length}|${isWritingCode ? 1 : 0}|${isWritingMath ? 1 : 0}|${unclosedCodeContent.length}|${completeCodeBlockCount}|${responseMode}`;

    return { html: rendered, signature };
}
function buildCanvasStreamingRenderState(rawText) {
    let liveText = rawText || '';
    liveText = liveText.replace(/```[a-zA-Z0-9_+-]*\n[\s\S]*?```/g, '');

    const unclosedIdx = liveText.indexOf('```');
    let isWritingCode = false;
    if (unclosedIdx !== -1) {
        liveText = liveText.substring(0, unclosedIdx);
        isWritingCode = true;
    }

    liveText = liveText.replace(/\n{3,}/g, '\n\n').trim();
    const writingBadge = '<div class="canvas-applied-badge" style="opacity:0.7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Writing to canvas...</div>';
    const activityHtml = buildResponseActivity('code', liveText.trim().length > 0);

    let html;
    if (liveText) {
        const cursorHtml = isWritingCode ? '' : '<span class="streaming-cursor">|</span>';
        html = activityHtml + formatContent(liveText) + cursorHtml + (isWritingCode ? writingBadge : '');
    } else {
        html = activityHtml + writingBadge;
    }

    const signature = `${liveText.length}|${isWritingCode ? 1 : 0}|code`;
    return { html, signature };
}
async function processRenderQueue(contentContainer, thinkingContainer, thinkingSection, onThinkingRevealed) {
    if (isRendering) return;
    isRendering = true;

    let lastRenderTime = 0;
    let lastMathRenderTime = 0;
    let lastRenderedSignature = '';
    let pendingContentUpdate = false;
    let pendingReasoningUpdate = false;

    const process = () => {
        if (renderQueue.length === 0 && !pendingContentUpdate && !pendingReasoningUpdate) {
            // Nothing left — do one final render to flush any pending partial
            isRendering = false;
            return;
        }
        if (shouldStopTyping) {
            if (pendingReasoningUpdate && thinkingContainer) {
                const innerDiv = thinkingContainer.querySelector('div');
                if (innerDiv) innerDiv.innerHTML = formatThinkingContent(accumulatedReasoning);
            }
            if (contentContainer) {
                const staticContent = canvasMode ? formatContentForCanvas(accumulatedContent) : formatContent(accumulatedContent);
                contentContainer.innerHTML = staticContent;
                contentContainer.classList.remove('streaming');
            }
            if (thinkingSection) {
                const spinner = thinkingSection.querySelector('.thinking-spinner');
                if (spinner) spinner.remove();
                const label = thinkingSection.querySelector('.thinking-label');
                if (label && /^Thinking/.test(label.textContent || '')) label.textContent = 'Thought';
                const hasThinking = (accumulatedReasoning || '').trim().length > 0;
                if (!hasThinking) thinkingSection.style.display = 'none';
            }
            isRendering = false;
            return;
        }

        // --- Phase 1: Drain ALL available tokens (no limit) ---
        // This never blocks — we just accumulate strings.
        while (renderQueue.length > 0) {
            const delta = renderQueue.shift();

            // Handle dedicated reasoning fields
            const reasoning = delta?.reasoning_content || delta?.reasoning;
            if (reasoning) {
                accumulatedReasoning += reasoning;
                pendingReasoningUpdate = true;
            }

            // Handle content — parse <think> tags in real-time
            const content = delta?.content;
            if (content) {
                let remaining = content;
                while (remaining.length > 0) {
                    if (insideThinkTag) {
                        const closeIdx = remaining.indexOf('</think>');
                        if (closeIdx !== -1) {
                            accumulatedReasoning += remaining.substring(0, closeIdx);
                            pendingReasoningUpdate = true;
                            insideThinkTag = false;
                            remaining = remaining.substring(closeIdx + 8);
                        } else {
                            accumulatedReasoning += remaining;
                            pendingReasoningUpdate = true;
                            remaining = '';
                        }
                    } else {
                        const openIdx = remaining.indexOf('<think>');
                        if (openIdx !== -1) {
                            if (openIdx > 0) {
                                accumulatedContent += remaining.substring(0, openIdx);
                                pendingContentUpdate = true;
                            }
                            insideThinkTag = true;
                            remaining = remaining.substring(openIdx + 7);
                        } else {
                            accumulatedContent += remaining;
                            pendingContentUpdate = true;
                            remaining = '';
                        }
                    }
                }
            }
        }

        // --- Phase 2: Throttled DOM update ---
        const now = Date.now();
        const elapsed = now - lastRenderTime;

        const RENDER_INTERVAL_MS = getAdaptiveRenderIntervalMs(renderQueue.length);
        if (elapsed >= RENDER_INTERVAL_MS && (pendingContentUpdate || pendingReasoningUpdate)) {
            lastRenderTime = now;
            let didRenderContent = false;

            // Reveal thinking section as soon as reasoning arrives
            if (pendingReasoningUpdate && thinkingSection && thinkingSection.style.display === 'none') {
                thinkingSection.style.display = '';
                if (onThinkingRevealed) onThinkingRevealed();
            }

            if (pendingReasoningUpdate && thinkingContainer) {
                const innerDiv = thinkingContainer.querySelector('div');
                if (innerDiv) innerDiv.innerHTML = formatThinkingContent(accumulatedReasoning);
            }

            if (pendingContentUpdate) {
                // Stop thinking timer when actual content starts arriving
                if (_thinkingTimerRef && thinkingSection) {
                    clearInterval(_thinkingTimerRef);
                    const elapsedSec = _thinkingStartRef ? Math.round((Date.now() - _thinkingStartRef) / 1000) : 0;
                    const labelEl = thinkingSection.querySelector('.thinking-label');
                    if (labelEl) labelEl.textContent = `Thought for ${elapsedSec}s`;
                    _thinkingTimerRef = null;
                    _thinkingEndTimeRef = Date.now();
                }

                const liveState = canvasMode
                    ? buildCanvasStreamingRenderState(accumulatedContent)
                    : buildStreamingRenderState(accumulatedContent);

                if (liveState.signature !== lastRenderedSignature) {
                    contentContainer.innerHTML = liveState.html;
                    lastRenderedSignature = liveState.signature;
                    didRenderContent = true;
                }
            }

            // Keep math rendering lightweight during stream; full formatting runs on finalize.
            if (pendingReasoningUpdate && thinkingContainer && typeof renderMathInElement === 'function') {
                if (now - lastMathRenderTime > 1800 && !hasUnclosedMath(accumulatedReasoning)) {
                    lastMathRenderTime = now;
                    try {
                        const katexOpts = { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false };
                        renderMathInElement(thinkingContainer, katexOpts);
                    } catch (e) { }
                }
            }

            // Reset pending flags after render
            pendingContentUpdate = false;
            pendingReasoningUpdate = false;

            // Instant scroll during streaming — no competing smooth scroll
            if (isAutoScrollEnabled && (didRenderContent || pendingReasoningUpdate)) {
                const chatArea = document.getElementById('chatArea');
                if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
            }
        }

        requestAnimationFrame(process);
    };

    requestAnimationFrame(process);
}


window.deleteChat = function (chatId, event) {
    if (event) event.stopPropagation();
    window.closeChatMenu();
    delete chatHistoryData[chatId];
    localStorage.setItem('chatHistory', JSON.stringify(chatHistoryData));
    if (currentChatId === chatId) window.newChat();
    renderChatHistory();
}

window.openChatMenu = function (chatId, event) {
    event.stopPropagation();
    // Close any open menu first
    window.closeChatMenu();
    const navItem = event.target.closest('.nav-item');
    navItem.classList.add('menu-open');
    const menu = navItem.querySelector('.chat-context-menu');
    if (menu) menu.classList.add('show');
}

window.closeChatMenu = function () {
    document.querySelectorAll('.nav-item.menu-open').forEach(el => el.classList.remove('menu-open'));
    document.querySelectorAll('.chat-context-menu.show').forEach(el => el.classList.remove('show'));
}

window.renameChat = function (chatId, event) {
    if (event) event.stopPropagation();
    window.closeChatMenu();
    const navItem = document.querySelector(`.nav-item[data-chat-id="${chatId}"]`);
    if (!navItem) return;
    const textEl = navItem.querySelector('.nav-item-text');
    const oldTitle = chatHistoryData[chatId].title;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-rename-input';
    input.value = oldTitle;
    textEl.replaceWith(input);
    input.focus();
    input.select();

    const save = () => {
        const newTitle = input.value.trim() || oldTitle;
        chatHistoryData[chatId].title = newTitle;
        localStorage.setItem('chatHistory', JSON.stringify(chatHistoryData));
        renderChatHistory();
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = oldTitle; input.blur(); }
    });
}

window.pinChat = function (chatId, event) {
    if (event) event.stopPropagation();
    window.closeChatMenu();
    chatHistoryData[chatId].pinned = !chatHistoryData[chatId].pinned;
    localStorage.setItem('chatHistory', JSON.stringify(chatHistoryData));
    renderChatHistory();
}

// ... Additional helpers will be added below ...
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function buildDocsHtmlFromAssistantText(messageTextEl) {
    const clone = messageTextEl.cloneNode(true);

    clone.querySelectorAll('.code-header-right, .copy-code-btn, .code-run-btn, .code-run-output').forEach(el => el.remove());

    // Prefer plain math text over KaTeX DOM for cleaner Docs pastes.
    clone.querySelectorAll('.katex').forEach(el => {
        const annotation = el.querySelector('annotation');
        const text = annotation ? annotation.textContent : (el.textContent || '');
        el.replaceWith(document.createTextNode(text));
    });

    const inlineStyles = {
        p: 'margin: 0 0 12px 0;',
        h1: 'font-size: 24px; line-height: 1.3; margin: 24px 0 12px 0; font-weight: 700;',
        h2: 'font-size: 20px; line-height: 1.35; margin: 20px 0 10px 0; font-weight: 700;',
        h3: 'font-size: 17px; line-height: 1.4; margin: 16px 0 8px 0; font-weight: 700;',
        ul: 'margin: 0 0 12px 24px; padding: 0;',
        ol: 'margin: 0 0 12px 24px; padding: 0;',
        li: 'margin: 0 0 6px 0;',
        pre: 'background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 12px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap;',
        code: 'background: #f3f4f6; border-radius: 4px; padding: 2px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;',
        blockquote: 'margin: 12px 0; padding: 8px 12px; border-left: 3px solid #d1d5db; color: #374151; background: #f9fafb;',
        table: 'border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px;',
        th: 'border: 1px solid #d1d5db; padding: 8px; background: #f3f4f6; text-align: left; font-weight: 600;',
        td: 'border: 1px solid #d1d5db; padding: 8px; vertical-align: top;',
        a: 'color: #2563eb; text-decoration: underline;'
    };

    Object.entries(inlineStyles).forEach(([selector, style]) => {
        clone.querySelectorAll(selector).forEach(el => {
            if (selector === 'code' && el.closest('pre')) return;
            el.style.cssText = `${el.style.cssText}; ${style}`;
        });
    });

    clone.querySelectorAll('*').forEach(el => {
        el.removeAttribute('class');
        if (el.tagName !== 'A') el.removeAttribute('target');
        if (el.tagName !== 'A') el.removeAttribute('rel');
    });

    return `<!doctype html><html><body><div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #111827; font-size: 14px; line-height: 1.7;">${clone.innerHTML}</div></body></html>`;
}

async function copyRichHtmlToClipboard(html, plainText) {
    if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return true;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plainText);
        return false;
    }
    return false;
}
window.copyAssistantMessage = function (button) { const messageText = button.closest('.assistant-message-content').querySelector('.assistant-message-text'); navigator.clipboard.writeText(messageText ? messageText.innerText : '').then(() => { const originalContent = button.innerHTML; button.innerHTML = `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"> <path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg> `; setTimeout(() => { button.innerHTML = originalContent; }, 2000); }).catch(err => console.error('Failed to copy text: ', err)); }
window.copyAssistantForDocs = async function (button) {
    const messageText = button.closest('.assistant-message-content').querySelector('.assistant-message-text');
    if (!messageText) return;

    const html = buildDocsHtmlFromAssistantText(messageText);
    const plainText = messageText.innerText || '';
    try {
        const copiedRich = await copyRichHtmlToClipboard(html, plainText);
        const originalContent = button.innerHTML;
        button.innerHTML = `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"> <path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg> `;
        setTimeout(() => { button.innerHTML = originalContent; }, 2000);
        showToast(copiedRich ? 'Copied in Google Docs format. Paste in Docs with Ctrl+V.' : 'Copied plain text (rich copy not supported in this browser).', 'success');
    } catch (err) {
        console.error('Failed to copy docs format:', err);
        showToast('Unable to copy for Docs. Please try again.', 'error');
    }
}
window.copyUserMessage = function (button) { const messageText = button.closest('.user-message-content').querySelector('.user-message-text'); navigator.clipboard.writeText(messageText ? messageText.innerText : '').then(() => { const originalContent = button.innerHTML; button.innerHTML = `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"> <path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg> `; setTimeout(() => { button.innerHTML = originalContent; }, 2000); }).catch(err => console.error('Failed to copy text: ', err)); }

window.retryLastMessage = function (button) {
    // Prevent retry while a response is being generated
    if (isProcessing) {
        showToast('Please wait for the current response to finish.', 'warning');
        return;
    }

    // Find the assistant message group that contains this button
    const assistantGroup = button.closest('.message-group.assistant');
    if (!assistantGroup) return;

    // Find the preceding user message group
    const userGroup = assistantGroup.previousElementSibling;
    if (!userGroup || !userGroup.classList.contains('user')) {
        showToast('Could not find the original prompt to retry.', 'error');
        return;
    }

    // Extract the original user message text
    const userTextEl = userGroup.querySelector('.user-message-text');
    const originalMessage = userTextEl ? userTextEl.innerText.trim() : '';
    if (!originalMessage) {
        showToast('Could not extract the original prompt.', 'error');
        return;
    }

    // Remove the last assistant + user pair from conversation history
    // Walk backward: remove the last assistant, then the last user
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'assistant') {
            conversationHistory.splice(i, 1);
            break;
        }
    }
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'user') {
            conversationHistory.splice(i, 1);
            break;
        }
    }

    // Remove both message groups from DOM
    assistantGroup.remove();
    userGroup.remove();

    // Save updated state
    saveCurrentChat();

    // Re-send the original message by populating the input and triggering send
    const input = document.getElementById('messageInput');
    input.value = originalMessage;
    sendMessage();
};

window.editUserMessage = function (button) {
    if (isProcessing) {
        showToast('Please wait for the current response to finish.', 'warning');
        return;
    }

    const userGroup = button.closest('.message-group.user');
    if (!userGroup) return;

    const bubble = userGroup.querySelector('.user-message-bubble');
    const textEl = userGroup.querySelector('.user-message-text');
    if (!textEl || !bubble) return;

    const originalText = textEl.innerText.trim();

    // Don't open a second editor
    if (bubble.querySelector('.edit-message-textarea')) return;

    // Preserve bubble markup so cancel can restore it in-place.
    bubble.dataset.editOriginalHtml = bubble.innerHTML;

    // Hide the actions bar while editing
    const actionsBar = userGroup.querySelector('.assistant-actions');
    if (actionsBar) actionsBar.style.display = 'none';

    // Replace bubble content with an editor
    const editorHtml = `
        <div class="edit-message-card">
            <textarea class="edit-message-textarea" rows="3">${originalText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
            <div class="edit-message-actions">
                <button class="edit-cancel-btn" onclick="window.cancelEditMessage(this)">Cancel</button>
                <button class="edit-save-btn" onclick="window.submitEditMessage(this)">Send</button>
            </div>
        </div>
    `;
    bubble.innerHTML = editorHtml;
    const textarea = bubble.querySelector('.edit-message-textarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Escape to cancel
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.cancelEditMessage(textarea);
        }
    });
};

window.cancelEditMessage = function (el) {
    const userGroup = el.closest('.message-group.user');
    if (!userGroup) return;

    const bubble = userGroup.querySelector('.user-message-bubble');
    if (!bubble) return;

    if (bubble.dataset.editOriginalHtml) {
        bubble.innerHTML = bubble.dataset.editOriginalHtml;
        delete bubble.dataset.editOriginalHtml;
    }

    const actionsBar = userGroup.querySelector('.assistant-actions');
    if (actionsBar) actionsBar.style.display = '';
    updateEditButtonVisibility();
};

window.submitEditMessage = function (el) {
    if (isProcessing) return;

    const userGroup = el.closest('.message-group.user');
    if (!userGroup) return;

    const textarea = userGroup.querySelector('.edit-message-textarea');
    if (!textarea) return;

    const newText = textarea.value.trim();
    if (!newText) {
        showToast('Message cannot be empty.', 'warning');
        return;
    }

    // Find the index of this user group in the DOM to map to conversationHistory
    const allUserGroups = Array.from(messagesContainer.querySelectorAll('.message-group.user'));
    const userIndex = allUserGroups.indexOf(userGroup);

    // Find the corresponding user entry in conversationHistory
    let historyIndex = -1;
    let userCount = 0;
    for (let i = 0; i < conversationHistory.length; i++) {
        if (conversationHistory[i].role === 'user') {
            if (userCount === userIndex) {
                historyIndex = i;
                break;
            }
            userCount++;
        }
    }

    // Remove all conversation history from this user message onward
    if (historyIndex !== -1) {
        conversationHistory.splice(historyIndex);
    }

    // Remove this user message group and all following siblings from the DOM
    let nextSibling = userGroup.nextElementSibling;
    while (nextSibling) {
        const toRemove = nextSibling;
        nextSibling = nextSibling.nextElementSibling;
        toRemove.remove();
    }
    userGroup.remove();

    // Save and re-send the edited message
    saveCurrentChat();
    const input = document.getElementById('messageInput');
    input.value = newText;
    updateEditButtonVisibility();
    sendMessage();
};

window.showToast = function (message, type = 'success') { const toast = document.createElement('div'); toast.className = `toast ${type} `; toast.textContent = message; document.body.appendChild(toast); setTimeout(() => toast.remove(), 3000); }

// Smooth scroll with requestAnimationFrame for better performance
window.scrollToBottom = function (smooth = true) {
    const chatArea = document.getElementById('chatArea');

    // If not smooth (forced), jump immediately
    if (!smooth) {
        chatArea.scrollTop = chatArea.scrollHeight;
        return;
    }

    // For smooth auto-scroll, we use native behavior but only if deviation is significant
    const target = chatArea.scrollHeight;
    const current = chatArea.scrollTop + chatArea.clientHeight;

    if (Math.abs(target - current) > 10) {
        chatArea.scrollTo({ top: target, behavior: 'smooth' });
    }

    // Re-enable auto-scroll when explicitly called
    isAutoScrollEnabled = true;
}

function setupScrollDetection() {
    const chatArea = document.getElementById('chatArea');
    const scrollBtn = document.getElementById('scrollToBottom');
    let lastScrollTop = chatArea.scrollTop;

    // Backup: Early detection of interaction
    chatArea.addEventListener('wheel', (e) => {
        // If scrolling UP, kill auto-scroll immediately
        if (e.deltaY < 0) isAutoScrollEnabled = false;
    }, { passive: true });

    chatArea.addEventListener('touchstart', (e) => {
        isAutoScrollEnabled = false; // Assume interaction stops auto-scroll initially
    }, { passive: true });

    chatArea.addEventListener('scroll', () => {
        const currentScrollTop = chatArea.scrollTop;
        const threshold = 4;
        const distanceToBottom = chatArea.scrollHeight - currentScrollTop - chatArea.clientHeight;
        const isAtBottom = distanceToBottom <= threshold;

        // "Sensitivity" check: If we moved UP, user is fighting auto-scroll.
        // Use a tiny epsilon (0.5) to handle sub-pixel rendering differences.
        if (currentScrollTop < lastScrollTop - 0.5) {
            isAutoScrollEnabled = false;
        }

        // If we actively hit the bottom (scrolled down), re-engage
        if (isAtBottom) {
            isAutoScrollEnabled = true;
        }

        lastScrollTop = currentScrollTop;

        if (scrollBtn) {
            scrollBtn.classList.toggle('show', !isAutoScrollEnabled && messagesContainer);
        }
    }, { passive: true });
}

function saveCurrentChat() { if (!window.isTempChat && currentChatId && chatHistoryData[currentChatId] && conversationHistory.length > 0) { chatHistoryData[currentChatId].messages = conversationHistory; localStorage.setItem('chatHistory', JSON.stringify(chatHistoryData)); } }
function loadChatHistory() { const stored = localStorage.getItem('chatHistory'); if (stored) chatHistoryData = JSON.parse(stored); renderChatHistory(); }

function renderChatHistory() {
    const historyContainer = document.getElementById('chatHistory');
    // Remove all dynamic items
    historyContainer.querySelectorAll('.nav-item, .sidebar-section-label').forEach(el => el.remove());

    const entries = Object.entries(chatHistoryData).sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0));
    const pinned = entries.filter(([, chat]) => chat.pinned);
    const unpinned = entries.filter(([, chat]) => !chat.pinned);

    const menuIcon = `<svg width = "16" height = "16" viewBox = "0 0 24 24" fill = "currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg> `;
    const renameIcon = `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"> <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg> `;
    const pinIcon = `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"> <path d="M12 17v5M9 3h6l1 7h1a2 2 0 010 4H7a2 2 0 010-4h1l1-7z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg> `;
    const deleteIcon = `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"> <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke-width="2" stroke-linecap="round" /></svg> `;

    function buildItem(chatId, chat) {
        const isPinned = chat.pinned;
        const item = document.createElement('div');
        item.className = 'nav-item' + (chatId === currentChatId ? ' active' : '');
        item.setAttribute('data-chat-id', chatId);
        item.innerHTML = `<span class="nav-item-text"> ${escapeHtml(chat.title)}</span>
            <button class="chat-menu-btn" onclick="openChatMenu('${chatId}', event)">${menuIcon}</button>
            <div class="chat-context-menu">
                <div class="chat-menu-item" onclick="renameChat('${chatId}', event)">${renameIcon} Rename</div>
                <div class="chat-menu-item" onclick="pinChat('${chatId}', event)">${pinIcon} ${isPinned ? 'Unpin chat' : 'Pin chat'}</div>
                <div class="chat-menu-item delete-item" onclick="deleteChat('${chatId}', event)">${deleteIcon} Delete</div>
            </div>`;
        item.onclick = (e) => { if (!e.target.closest('.chat-menu-btn') && !e.target.closest('.chat-context-menu')) loadChat(chatId, item); };
        return item;
    }

    if (pinned.length > 0) {
        const label = document.createElement('div');
        label.className = 'sidebar-section-label';
        label.textContent = 'Pinned';
        historyContainer.appendChild(label);
        pinned.forEach(([chatId, chat]) => historyContainer.appendChild(buildItem(chatId, chat)));
    }

    if (unpinned.length > 0) {
        if (pinned.length > 0) {
            const label = document.createElement('div');
            label.className = 'sidebar-section-label';
            label.textContent = 'Recent';
            historyContainer.appendChild(label);
        }
        unpinned.forEach(([chatId, chat]) => historyContainer.appendChild(buildItem(chatId, chat)));
    }
}

// Close context menu on outside click
document.addEventListener('click', () => { window.closeChatMenu(); });

function loadChat(chatId, itemEl) {
    window.stopGeneration();
    shouldStopTyping = false;
    saveCurrentChat();
    if (typeof window.closeCanvas === 'function') window.closeCanvas();
    const chat = chatHistoryData[chatId];
    currentChatId = chatId;
    conversationHistory = chat.messages || [];
    const chatArea = document.getElementById('chatArea');
    chatArea.innerHTML = '';
    document.getElementById('mainContent').classList.remove('welcome-mode');
    messagesContainer = document.createElement('div');
    messagesContainer.className = 'messages-container';
    chatArea.appendChild(messagesContainer);
    conversationHistory.forEach(msg => {
        if (msg.role === 'user') {
            const parsed = parseUserContentForRender(msg.content);
            addUserMessage(parsed.text, parsed.images, parsed.files);
        } else if (msg.role === 'assistant') {
            addAssistantMessage(msg.content, false, msg.sources || null);
        }
    });
    document.querySelectorAll('#chatHistory .nav-item').forEach(item => item.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');
    window.scrollToBottom(false);
    if (window.innerWidth <= 768) window.closeSidebar();
}

// Event Listeners for miscellaneous things
window.addEventListener('load', () => {
    const input = document.getElementById('messageInput');
    if (input) input.focus();
    // Init search toggle from localStorage
    const searchBtn = document.getElementById('searchToggle');
    if (searchBtn && searchEnabled) searchBtn.classList.add('active');
});
document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') window.closeUsernameModal(); });
document.getElementById('usernameInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') window.saveUsername(); });
window.addEventListener('orientationchange', () => { setTimeout(() => { window.scrollToBottom(false); }, 300); });


// Image lightbox
window.openImageLightbox = function (src) {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox-overlay';
    overlay.innerHTML = `<img src="${src}" class="image-lightbox-img"><button class="image-lightbox-close">&times;</button>`;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.classList.contains('image-lightbox-close')) {
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 200);
        }
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const onKey = (e) => { if (e.key === 'Escape') { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
}



