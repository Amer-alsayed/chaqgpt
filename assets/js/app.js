import { models, welcomeHeadings, suggestionSets } from './config.js';

const API_URL = '/api/chat';

let conversationHistory = [];
let isProcessing = false;
let messagesContainer = null;
let currentModel = 'qwen/qwen3-vl-30b-a3b:free'; // Default: Qwen3 VL 30B A3B Thinking
let currentChatId = null;
let chatHistoryData = {};
let abortController = null;
let shouldStopTyping = false;
let isAutoScrollEnabled = true; // Default to true
let renderQueue = [];
let isRendering = false;
let availableModels = [...models]; // Initialize with config models
let pendingImages = []; // base64 data URLs for image attachments

// Load dynamic models from API
async function fetchModels() {
    try {
        const response = await fetch('/api/models');
        if (response.ok) {
            const dynamicModels = await response.json();
            if (dynamicModels && dynamicModels.length > 0) {
                availableModels = dynamicModels;
                initializeModels();

                // Restore saved model preference
                const saved = localStorage.getItem('selectedModel');
                const savedModelExists = saved && availableModels.find(m => m.id === saved);
                const currentModelExists = availableModels.find(m => m.id === currentModel);

                if (savedModelExists) {
                    currentModel = saved;
                    updateHeaderModelDisplay();
                } else if (!currentModelExists) {
                    // Prefer Qwen3 VL 30B A3B as default for new users
                    const preferredDefault = availableModels.find(m => m.id.includes('qwen3-vl-30b-a3b'));
                    currentModel = preferredDefault ? preferredDefault.id : availableModels[0].id;
                    saveSelectedModel();
                    updateHeaderModelDisplay();
                } else {
                    updateHeaderModelDisplay();
                }
            }
        }
        // Update vision UI after models are loaded
        updateVisionUI();
    } catch (error) {
        console.error('Failed to fetch dynamic models:', error);
    }
}

function updateHeaderModelDisplay() {
    const savedModelData = availableModels.find(m => m.id === currentModel);
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

    // Fetch fresh models in background
    fetchModels();

    loadChatHistory();
    setupScrollDetection();
    initializeWelcome();
    setupGlobalClickHandler();
    setupSidebarOverlay();
    preventBodyScroll();
    setupMobileKeyboard();
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
            html += `<div class="model-item ${model.id === currentModel ? 'selected' : ''}" data-model="${model.id}" data-badge="${model.badge}" data-name="${model.name}"><div class="model-info"><div class="model-name">${model.name}</div></div><svg class="model-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
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
    const modelData = availableModels.find(m => m.id === currentModel);
    const btn = document.getElementById('imageUploadBtn');
    if (btn) {
        btn.style.display = (modelData && modelData.supportsVision) ? '' : 'none';
    }
    // Clear pending images when switching to non-vision model
    if (!modelData || !modelData.supportsVision) {
        pendingImages = [];
        const container = document.getElementById('imagePreviewContainer');
        if (container) container.innerHTML = '';
    }
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
    document.getElementById('stopGenerating').classList.remove('show');
    isProcessing = false;
    document.getElementById('sendButton').disabled = false;
}

window.handleInput = function () {
    const input = document.getElementById('messageInput');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    document.getElementById('sendButton').classList.toggle('active', input.value.trim() !== '' || pendingImages.length > 0);
}

window.handleKeyPress = function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
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

function addUserMessage(content, images = []) {
    initMessagesContainer();
    const chatArea = document.getElementById('chatArea');
    const isScrolledToBottom = chatArea.scrollHeight - chatArea.clientHeight <= chatArea.scrollTop + 10;
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group user';
    let imagesHtml = '';
    if (images.length > 0) {
        imagesHtml = '<div class="user-message-images">' + images.map(img => `<img src="${img}" alt="Attached image" class="user-attached-image" onclick="window.openImageLightbox(this.src)">`).join('') + '</div>';
    }
    messageGroup.innerHTML = `<div class="user-message-bubble">${imagesHtml}<div class="user-message-text">${escapeHtml(content)}</div></div>`;
    messagesContainer.appendChild(messageGroup);
    if (isScrolledToBottom) scrollToBottom(true);
}

// --- Core Logic ---

async function addAssistantMessage(content, showTyping = true) {
    initMessagesContainer();
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group assistant';
    const chatArea = document.getElementById('chatArea');

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
        <div class="assistant-message-text"></div>
        <div class="assistant-actions">
            <button class="assistant-action-btn" onclick="window.copyAssistantMessage(this)">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
            </button>
        </div>
    </div>`;

    messageGroup.innerHTML = html;
    messagesContainer.appendChild(messageGroup);
    const textDiv = messageGroup.querySelector('.assistant-message-text');

    if (showTyping) {
        const chunkSize = 5;
        let displayedText = '';
        for (let i = 0; i < finalContent.length; i += chunkSize) {
            if (shouldStopTyping) break;
            const isScrolledToBottom = chatArea.scrollHeight - chatArea.clientHeight <= chatArea.scrollTop + 10;
            displayedText += finalContent.substring(i, i + chunkSize);
            textDiv.innerHTML = formatContent(displayedText);
            try { renderMathInElement(textDiv, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false }); } catch (e) { }
            if (isScrolledToBottom) chatArea.scrollTop = chatArea.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, 8));
        }
        if (!shouldStopTyping) textDiv.innerHTML = formatContent(finalContent);
    } else {
        textDiv.innerHTML = formatContent(finalContent);
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
    const currentModelData = availableModels.find(m => m.id === currentModel);
    let html = '<div class="assistant-message-content">';
    if (currentModelData?.supportsThinking) html += `<div class="thinking-section"><div class="thinking-header"><svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke-width="2" stroke-linecap="round"/></svg><span class="thinking-label">Thinking</span><div class="thinking-spinner"><span></span><span></span><span></span></div></div></div>`;
    html += `<div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
    messageGroup.innerHTML = html;
    messagesContainer.appendChild(messageGroup);
    if (isScrolledToBottom) scrollToBottom(true);
}

function removeTypingIndicator() { const indicator = document.getElementById('typing-indicator-group'); if (indicator) indicator.remove(); }
window.toggleThinking = function (header) { header.nextElementSibling.classList.toggle('show'); header.querySelector('.thinking-toggle').classList.toggle('expanded'); }
window.copyCode = function (button, code) { navigator.clipboard.writeText(code).then(() => { const originalText = button.innerHTML; button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; button.classList.add('copied'); setTimeout(() => { button.innerHTML = originalText; button.classList.remove('copied'); }, 2000); }); }

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

        const headers = parseRow(rows[0]);
        let html = '<table><thead><tr>';
        headers.forEach(h => { html += `<th>${h}</th>`; });
        html += '</tr></thead><tbody>';

        for (let i = 2; i < rows.length; i++) {
            const cells = parseRow(rows[i]);
            html += '<tr>';
            cells.forEach(c => { html += `<td>${c}</td>`; });
            html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
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
        const replacement = `<div class="code-block-wrapper">
                                <div class="code-block-header">
                                    <span class="code-language">${b.lang === 'plaintext' ? 'text' : b.lang}</span>
                                    <button class="code-copy-btn" onclick="window.copyCode(this, ${JSON.stringify(b.code).replace(/"/g, '&quot;')})">
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
                                    </button>
                                </div>
                                <pre><code class="${langClass}">${escapeHtml(b.code)}</code></pre>
                             </div>`;
        html = html.replace(`[[[BLOCK_${idx}]]]`, replacement);
    });
    return html || '<p></p>';
}


window.sendMessage = async function () {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const images = [...pendingImages]; // snapshot before clearing
    if ((!message && images.length === 0) || isProcessing) return;

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

    addUserMessage(message, images);
    input.value = '';
    input.style.height = 'auto';
    pendingImages = [];
    updateImagePreview();
    handleInput();

    // Build message content for API
    let messageContent;
    if (images.length > 0) {
        // OpenRouter multi-part content format for vision models
        messageContent = [];
        images.forEach(img => {
            messageContent.push({ type: 'image_url', image_url: { url: img } });
        });
        if (message) {
            messageContent.push({ type: 'text', text: message });
        }
    } else {
        messageContent = message;
    }
    conversationHistory.push({ role: 'user', content: messageContent });

    // Reset accumulated content for new turn
    accumulatedContent = '';
    accumulatedReasoning = '';
    insideThinkTag = false;
    renderQueue = [];
    isRendering = false;
    isAutoScrollEnabled = true;

    isProcessing = true;
    document.getElementById('sendButton').disabled = true;
    document.getElementById('stopGenerating').classList.add('show');
    showTypingIndicator();

    let assistantMessageContent = '';
    let messageGroup;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: currentModel,
                messages: conversationHistory
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
                        <div class="thinking-spinner"><span></span><span></span><span></span></div>
                        <svg class="thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round"/></svg>
                    </div>
                    <div class="thinking-content" id="live-thinking-content"><div></div></div>
                </div>
                <div class="assistant-message-text"></div>
            </div> `;

        messageGroup.innerHTML = initialHtml;
        messagesContainer.appendChild(messageGroup);
        const assistantMessageContainer = messageGroup.querySelector('.assistant-message-text');
        const thinkingContentContainer = messageGroup.querySelector('#live-thinking-content');
        const thinkingSection = messageGroup.querySelector('#live-thinking-section');
        let thinkingRevealed = false;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Track full content locally for history saving
        let reasoningContent = '';
        let fullAssistantContent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done || shouldStopTyping) {
                if (shouldStopTyping) reader.cancel();
                break;
            }

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data.trim() === '[DONE]') break;
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
                            }
                        }
                    } catch (e) { }
                }
            }
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

        finalHtml += `
    <div class="assistant-message-text"> ${formatContent(finalContent)}</div>
        <div class="assistant-actions">
            <button class="assistant-action-btn" onclick="window.copyAssistantMessage(this)">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
            </button>
        </div>
        </div> `;

        messageGroup.innerHTML = finalHtml;
        renderMathInElement(messageGroup, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false });
        messageGroup.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));

        if (!shouldStopTyping) {
            // Store both content and reasoning for history
            const fullContent = thinkingContent ? `<think>${thinkingContent}</think>\n\n${finalContent}` : finalContent;
            conversationHistory.push({ role: 'assistant', content: fullContent });
            saveCurrentChat();
            renderChatHistory();
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
        shouldStopTyping = false;
        document.getElementById('sendButton').disabled = false;
        document.getElementById('stopGenerating').classList.remove('show');
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

async function processRenderQueue(contentContainer, thinkingContainer, thinkingSection, onThinkingRevealed) {
    if (isRendering) return;
    isRendering = true;

    const process = () => {
        if (renderQueue.length === 0 || shouldStopTyping) {
            isRendering = false;
            return;
        }

        const queueSize = renderQueue.length;
        const processCount = queueSize > 50 ? 20 : (queueSize > 20 ? 10 : (queueSize > 5 ? 2 : 1));

        let hasContentUpdate = false;
        let hasReasoningUpdate = false;

        for (let i = 0; i < processCount && renderQueue.length > 0; i++) {
            const delta = renderQueue.shift();

            // Handle dedicated reasoning fields
            const reasoning = delta?.reasoning_content || delta?.reasoning;
            if (reasoning) {
                accumulatedReasoning += reasoning;
                hasReasoningUpdate = true;
            }

            // Handle content â€” parse <think> tags in real-time
            const content = delta?.content;
            if (content) {
                let remaining = content;
                while (remaining.length > 0) {
                    if (insideThinkTag) {
                        const closeIdx = remaining.indexOf('</think>');
                        if (closeIdx !== -1) {
                            accumulatedReasoning += remaining.substring(0, closeIdx);
                            hasReasoningUpdate = true;
                            insideThinkTag = false;
                            remaining = remaining.substring(closeIdx + 8);
                        } else {
                            accumulatedReasoning += remaining;
                            hasReasoningUpdate = true;
                            remaining = '';
                        }
                    } else {
                        const openIdx = remaining.indexOf('<think>');
                        if (openIdx !== -1) {
                            if (openIdx > 0) {
                                accumulatedContent += remaining.substring(0, openIdx);
                                hasContentUpdate = true;
                            }
                            insideThinkTag = true;
                            remaining = remaining.substring(openIdx + 7);
                        } else {
                            accumulatedContent += remaining;
                            hasContentUpdate = true;
                            remaining = '';
                        }
                    }
                }
            }
        }

        // Reveal thinking section as soon as reasoning arrives
        if (hasReasoningUpdate && thinkingSection && thinkingSection.style.display === 'none') {
            thinkingSection.style.display = '';
            if (onThinkingRevealed) onThinkingRevealed();
        }

        if (hasReasoningUpdate && thinkingContainer) {
            const innerDiv = thinkingContainer.querySelector('div');
            if (innerDiv) innerDiv.innerHTML = formatThinkingContent(accumulatedReasoning);
        }

        if (hasContentUpdate) {
            // Stop thinking timer when actual content starts arriving (reasoning ended)
            if (_thinkingTimerRef && thinkingSection) {
                clearInterval(_thinkingTimerRef);
                const elapsed = _thinkingStartRef ? Math.round((Date.now() - _thinkingStartRef) / 1000) : 0;
                const labelEl = thinkingSection.querySelector('.thinking-label');
                if (labelEl) labelEl.textContent = `Thought for ${elapsed}s`;
                _thinkingTimerRef = null;
                _thinkingEndTimeRef = Date.now();
            }
            contentContainer.innerHTML = formatContent(accumulatedContent + '▋');
        }

        // Periodically render math with KaTeX (throttled, skip if incomplete delimiters)
        if ((hasContentUpdate || hasReasoningUpdate) && typeof renderMathInElement === 'function') {
            const now = Date.now();
            if (!processRenderQueue._lastMathRender || now - processRenderQueue._lastMathRender > 1500) {
                // Check if math delimiters are all closed before rendering
                const hasUnclosedMath = (text) => {
                    if (!text) return false;
                    // Check for unclosed code blocks (```)
                    const codeBlocks = (text.match(/```/g) || []).length;
                    if (codeBlocks % 2 !== 0) return true;
                    // Check for unclosed $$ (display math)
                    const doubleDollar = (text.match(/\$\$/g) || []).length;
                    if (doubleDollar % 2 !== 0) return true;
                    // Check for unclosed \[ or \(
                    const openBracket = (text.match(/\\\[/g) || []).length;
                    const closeBracket = (text.match(/\\\]/g) || []).length;
                    if (openBracket > closeBracket) return true;
                    const openParen = (text.match(/\\\(/g) || []).length;
                    const closeParen = (text.match(/\\\)/g) || []).length;
                    if (openParen > closeParen) return true;
                    return false;
                };

                const contentReady = hasContentUpdate && !hasUnclosedMath(accumulatedContent);
                const reasoningReady = hasReasoningUpdate && !hasUnclosedMath(accumulatedReasoning);

                if (contentReady || reasoningReady) {
                    processRenderQueue._lastMathRender = now;
                    try {
                        const katexOpts = { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false };
                        if (contentReady) renderMathInElement(contentContainer, katexOpts);
                        if (reasoningReady && thinkingContainer) renderMathInElement(thinkingContainer, katexOpts);
                    } catch (e) { }
                }
            }
        }

        if (isAutoScrollEnabled) {
            scrollToBottom(true);
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
window.copyAssistantMessage = function (button) { const messageText = button.closest('.assistant-message-content').querySelector('.assistant-message-text'); navigator.clipboard.writeText(messageText ? messageText.innerText : '').then(() => { const originalContent = button.innerHTML; button.innerHTML = `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"> <path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg> `; setTimeout(() => { button.innerHTML = originalContent; }, 2000); }).catch(err => console.error('Failed to copy text: ', err)); }
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
        if (msg.role === 'user') addUserMessage(msg.content);
        else if (msg.role === 'assistant') addAssistantMessage(msg.content, false);
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
