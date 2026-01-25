import { models, welcomeHeadings, suggestionSets } from './config.js';

const API_URL = '/api/chat';

let conversationHistory = [];
let isProcessing = false;
let messagesContainer = null;
let currentModel = models[0]?.id || 'tngtech/deepseek-r1t2-chimera:free'; // Default fallback
let currentChatId = null;
let chatHistoryData = {};
let abortController = null;
let shouldStopTyping = false;
let isAutoScrollEnabled = true; // Default to true
let renderQueue = [];
let isRendering = false;

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadUsername();
    // Verify local storage model exists in new config
    const saved = localStorage.getItem('selectedModel');
    if (saved && models.find(m => m.id === saved)) {
        currentModel = saved;
    } else {
        currentModel = models[0].id;
        saveSelectedModel();
    }

    initializeModels();
    loadChatHistory();
    setupScrollDetection();
    initializeWelcome();
    setupGlobalClickHandler();
    setupSidebarOverlay();
    preventBodyScroll();
});

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
        if (!e.target.closest('.model-dropdown, .logo-dropdown, .header-model-btn')) closeDropdowns();
        if (!e.target.closest('.sidebar-footer')) {
            const userMenu = document.getElementById('userMenu');
            if (userMenu) userMenu.classList.remove('show');
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
    if (nameEl) nameEl.textContent = savedUsername;
    if (avatarEl) avatarEl.textContent = savedUsername.charAt(0).toUpperCase();
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
        window.closeUsernameModal();
        showToast('Username updated successfully', 'success');
    }
}

function saveSelectedModel() { localStorage.setItem('selectedModel', currentModel); }

function initializeModels() {
    const dropdown = document.getElementById('modelDropdown');
    const headerDropdown = document.getElementById('headerModelDropdown');
    const categories = {};

    models.forEach(model => {
        if (!categories[model.category]) categories[model.category] = [];
        categories[model.category].push(model);
    });

    let html = '';
    Object.keys(categories).forEach(category => {
        html += `<div class="model-section-title">${category}</div>`;
        categories[category].forEach(model => {
            html += `<div class="model-item ${model.id === currentModel ? 'selected' : ''}" data-model="${model.id}" data-badge="${model.badge}" data-name="${model.name}"><div class="model-info"><div class="model-name">${model.name}</div><div class="model-description">${model.description}</div></div><svg class="model-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
        });
    });

    if (!html) {
        html = `<div class="model-section-title">No models found</div>`;
    }

    if (dropdown) {
        dropdown.innerHTML = html;
        dropdown.querySelectorAll('.model-item').forEach(item => item.addEventListener('click', (e) => { e.stopPropagation(); selectModel(item); }));
    }
    if (headerDropdown) {
        headerDropdown.innerHTML = html;
        headerDropdown.querySelectorAll('.model-item').forEach(item => item.addEventListener('click', (e) => { e.stopPropagation(); selectModel(item); }));
    }

    const savedModelData = models.find(m => m.id === currentModel);
    if (savedModelData) {
        const badge = document.getElementById('modelBadge');
        const headerName = document.getElementById('headerModelName');
        if (badge) badge.textContent = savedModelData.badge;
        if (headerName) headerName.textContent = savedModelData.name;
    }
}

function selectModel(item) {
    document.querySelectorAll('.model-item').forEach(i => i.classList.remove('selected'));
    const modelId = item.getAttribute('data-model');
    document.querySelectorAll(`[data-model="${modelId}"]`).forEach(i => i.classList.add('selected'));
    currentModel = modelId;

    document.getElementById('modelBadge').textContent = item.getAttribute('data-badge');
    document.getElementById('headerModelName').textContent = item.getAttribute('data-name');
    saveSelectedModel();
    closeDropdowns();
}

window.toggleSidebar = function () {
    const isOpen = document.getElementById('sidebar').classList.toggle('open');
    if (window.innerWidth <= 768) {
        document.getElementById('sidebarOverlay').classList.toggle('show', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
    } else {
        document.getElementById('mainContent').classList.toggle('sidebar-open', isOpen);
    }
}

window.closeSidebar = function () {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
    document.body.style.overflow = '';
    if (window.innerWidth > 768) document.getElementById('mainContent').classList.remove('sidebar-open');
}

window.toggleModelDropdown = function (event) {
    event.stopPropagation();
    document.getElementById('headerModelDropdown').classList.remove('show');
    document.getElementById('headerChevron').classList.remove('open');
    const isOpen = document.getElementById('modelDropdown').classList.toggle('show');
    document.getElementById('chevron').classList.toggle('open', isOpen);
}

window.toggleHeaderModelDropdown = function (event) {
    event.stopPropagation();
    document.getElementById('modelDropdown').classList.remove('show');
    document.getElementById('chevron').classList.remove('open');
    const isOpen = document.getElementById('headerModelDropdown').classList.toggle('show');
    document.getElementById('headerChevron').classList.toggle('open', isOpen);
    document.body.style.overflow = (isOpen && window.innerWidth <= 768) ? 'hidden' : '';
}

function closeDropdowns() {
    document.getElementById('modelDropdown').classList.remove('show');
    document.getElementById('chevron').classList.remove('open');
    document.getElementById('headerModelDropdown').classList.remove('show');
    document.getElementById('headerChevron').classList.remove('open');
    document.body.style.overflow = '';
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
    document.getElementById('sendButton').classList.toggle('active', input.value.trim() !== '');
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
    messagesContainer = null;
    document.getElementById('messageInput').value = '';
    window.handleInput();
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById('scrollToBottom').classList.remove('show');
    if (window.innerWidth <= 768) window.closeSidebar();
}

function initMessagesContainer() {
    if (!messagesContainer) {
        const welcomeState = document.getElementById('welcomeState');
        if (welcomeState) welcomeState.remove();
        messagesContainer = document.createElement('div');
        messagesContainer.className = 'messages-container';
        document.getElementById('chatArea').appendChild(messagesContainer);
    }
}

function addUserMessage(content) {
    initMessagesContainer();
    const chatArea = document.getElementById('chatArea');
    const isScrolledToBottom = chatArea.scrollHeight - chatArea.clientHeight <= chatArea.scrollTop + 10;
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group user';
    messageGroup.innerHTML = `<div class="user-message-bubble"><div class="user-message-text">${escapeHtml(content)}</div></div>`;
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
                    <span class="thinking-label">Thinking</span>
                    <svg class="thinking-toggle expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round"/></svg>
                </div>
                <div class="thinking-content show"><div>${formatContent(thinkingContent)}</div></div>
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
            try { renderMathInElement(textDiv, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) { }
            if (isScrolledToBottom) chatArea.scrollTop = chatArea.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, 8));
        }
        if (!shouldStopTyping) textDiv.innerHTML = formatContent(finalContent);
    } else {
        textDiv.innerHTML = formatContent(finalContent);
    }

    renderMathInElement(messageGroup, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
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
    const currentModelData = models.find(m => m.id === currentModel);
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
    let text = escapeHtml(raw);
    const blocks = [];

    text = text.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        blocks.push({ lang: (lang || 'plaintext').toLowerCase(), code: code.trim() });
        return `[[[BLOCK_${blocks.length - 1}]]]`;
    });

    text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
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

    const paragraphs = text.split(/\n{2,}/).map(p => {
        p = p.trim();
        if (!p) return '';
        if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol>') || p.startsWith('<blockquote>') || p.startsWith('[[[BLOCK_')) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    let html = paragraphs;

    blocks.forEach((b, idx) => {
        const langClass = `language-${b.lang}`;
        const replacement = `<div class="code-block-wrapper">
                                <div class="code-block-header">
                                    <span class="code-language">${b.lang === 'plaintext' ? 'text' : b.lang}</span>
                                    <button class="code-copy-btn" onclick="window.copyCode(this, ${JSON.stringify(b.code).replace(/"/g, '&quot;')})">
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
                                    </button>
                                </div>
                                <pre><code class="${langClass}">${b.code}</code></pre>
                             </div>`;
        html = html.replace(`[[[BLOCK_${idx}]]]`, replacement);
    });
    return html || '<p></p>';
}

window.sendMessage = async function () {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message || isProcessing) return;

    shouldStopTyping = false;
    abortController = new AbortController();

    if (!currentChatId) {
        currentChatId = Date.now().toString();
        chatHistoryData[currentChatId] = {
            title: message.substring(0, 30) + (message.length > 30 ? '...' : ''),
            messages: [],
            createdAt: Date.now()
        };
    }

    addUserMessage(message);
    input.value = '';
    input.style.height = 'auto';
    handleInput();
    conversationHistory.push({ role: 'user', content: message });

    // Reset accumulated content for new turn
    accumulatedContent = '';
    accumulatedReasoning = '';
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

        // Check if this model supports thinking
        const currentModelData = models.find(m => m.id === currentModel);
        const supportsThinking = currentModelData?.supportsThinking;

        // Create initial structure with thinking section if supported
        let initialHtml = '<div class="assistant-message-content">';
        if (supportsThinking) {
            initialHtml += `
                <div class="thinking-section" id="live-thinking-section">
                    <div class="thinking-header" onclick="window.toggleThinking(this)">
                        <svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke-width="2" stroke-linecap="round"/></svg>
                        <span class="thinking-label">Thinking</span>
                        <div class="thinking-spinner"><span></span><span></span><span></span></div>
                        <svg class="thinking-toggle expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round"/></svg>
                    </div>
                    <div class="thinking-content show" id="live-thinking-content"><div></div></div>
                </div>`;
        }
        initialHtml += '<div class="assistant-message-text"></div></div>';

        messageGroup.innerHTML = initialHtml;
        messagesContainer.appendChild(messageGroup);
        const assistantMessageContainer = messageGroup.querySelector('.assistant-message-text');
        const thinkingContentContainer = messageGroup.querySelector('#live-thinking-content');

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
                            if (!isRendering) processRenderQueue(assistantMessageContainer, thinkingContentContainer);

                            // Synchronously accumulate for history
                            if (delta.reasoning_content || delta.reasoning) {
                                reasoningContent += (delta.reasoning_content || delta.reasoning);
                            }
                            if (delta.content) {
                                fullAssistantContent += delta.content;
                            }
                        }
                    } catch (e) { }
                }
            }
        }

        // Also check for <think> tags in the content itself (fallback for models that use that format)
        let thinkingContent = reasoningContent;
        // Wait for render queue to drain before finalizing
        while (renderQueue.length > 0 || isRendering) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        let finalContent = fullAssistantContent;

        const thinkMatch = assistantMessageContent.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            thinkingContent = (thinkingContent ? thinkingContent + '\n\n' : '') + thinkMatch[1].trim();
            finalContent = assistantMessageContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        }

        // Build final HTML
        let finalHtml = '<div class="assistant-message-content">';

        if (thinkingContent) {
            finalHtml += `
                <div class="thinking-section">
                    <div class="thinking-header" onclick="window.toggleThinking(this)">
                        <svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke-width="2" stroke-linecap="round"/></svg>
                        <span class="thinking-label">Thinking</span>
                        <svg class="thinking-toggle expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round"/></svg>
                    </div>
                    <div class="thinking-content show"><div>${formatContent(thinkingContent)}</div></div>
                </div>
            `;
        }

        finalHtml += `
            <div class="assistant-message-text">${formatContent(finalContent)}</div>
            <div class="assistant-actions">
                <button class="assistant-action-btn" onclick="window.copyAssistantMessage(this)">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>
                </button>
            </div>
        </div>`;

        messageGroup.innerHTML = finalHtml;
        renderMathInElement(messageGroup, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
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
                messageGroup.innerHTML = `<div class="assistant-message-content"><div class="assistant-message-text"><p style="color: var(--accent-error);">Sorry, an error occurred.</p></div></div>`;
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

async function processRenderQueue(contentContainer, thinkingContainer) {
    if (isRendering) return;
    isRendering = true;

    const process = () => {
        if (renderQueue.length === 0 || shouldStopTyping) {
            isRendering = false;
            return;
        }

        // Adaptive chunking: Process more items if queue is backing up
        // If queue is small (latency high), process 1 item to be responsive
        // If queue is large (high throughput), process many items to catch up
        const queueSize = renderQueue.length;
        const processCount = queueSize > 50 ? 20 : (queueSize > 20 ? 10 : (queueSize > 5 ? 2 : 1));

        let hasContentUpdate = false;
        let hasReasoningUpdate = false;

        for (let i = 0; i < processCount && renderQueue.length > 0; i++) {
            const delta = renderQueue.shift();

            const reasoning = delta?.reasoning_content || delta?.reasoning;
            if (reasoning) {
                accumulatedReasoning += reasoning;
                hasReasoningUpdate = true;
            }

            const content = delta?.content;
            if (content) {
                accumulatedContent += content;
                hasContentUpdate = true;
            }
        }

        if (hasReasoningUpdate && thinkingContainer) {
            const innerDiv = thinkingContainer.querySelector('div');
            if (innerDiv) innerDiv.innerHTML = formatContent(accumulatedReasoning);
        }

        if (hasContentUpdate) {
            contentContainer.innerHTML = formatContent(accumulatedContent + '▋');
            // Only run heavy MathJax/HighlightJS occasionally or at end, but for live stream basic formatting is enough
            // We can skip heavy formatting during fast stream for performance
        }

        if (isAutoScrollEnabled) {
            scrollToBottom(true);
        }

        requestAnimationFrame(process);
    };

    requestAnimationFrame(process);
}


window.deleteChat = function (chatId, event) {
    event.stopPropagation();
    delete chatHistoryData[chatId];
    localStorage.setItem('chatHistory', JSON.stringify(chatHistoryData));
    if (currentChatId === chatId) window.newChat();
    renderChatHistory();
}

// ... Additional helpers will be added below ...
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
window.copyAssistantMessage = function (button) { const messageText = button.closest('.assistant-message-content').querySelector('.assistant-message-text'); navigator.clipboard.writeText(messageText ? messageText.innerText : '').then(() => { const originalContent = button.innerHTML; button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; setTimeout(() => { button.innerHTML = originalContent; }, 2000); }).catch(err => console.error('Failed to copy text: ', err)); }
window.showToast = function (message, type = 'success') { const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; document.body.appendChild(toast); setTimeout(() => toast.remove(), 3000); }

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

function saveCurrentChat() { if (currentChatId && chatHistoryData[currentChatId] && conversationHistory.length > 0) { chatHistoryData[currentChatId].messages = conversationHistory; localStorage.setItem('chatHistory', JSON.stringify(chatHistoryData)); } }
function loadChatHistory() { const stored = localStorage.getItem('chatHistory'); if (stored) chatHistoryData = JSON.parse(stored); renderChatHistory(); }

function renderChatHistory() {
    const historyContainer = document.getElementById('chatHistory');
    historyContainer.querySelectorAll('.nav-item:not(:first-child), .sidebar-section-title').forEach(el => el.remove());
    const entries = Object.entries(chatHistoryData).sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0));
    if (entries.length > 0) {
        const title = document.createElement('div');
        title.className = 'sidebar-section-title';
        title.textContent = 'Recent Chats';
        historyContainer.appendChild(title);
        entries.forEach(([chatId, chat]) => {
            const item = document.createElement('div');
            item.className = 'nav-item ' + (chatId === currentChatId ? 'active' : '');
            item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke-width="2"/></svg><span class="nav-item-text">${escapeHtml(chat.title)}</span><button class="delete-chat-btn" onclick="window.deleteChat('${chatId}', event)" title="Delete chat"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke-width="2" stroke-linecap="round"/></svg></button>`;
            item.onclick = (e) => { if (!e.target.closest('.delete-chat-btn')) loadChat(chatId, item); };
            historyContainer.appendChild(item);
        });
    }
}

function loadChat(chatId, itemEl) {
    window.stopGeneration();
    shouldStopTyping = false;
    saveCurrentChat();
    const chat = chatHistoryData[chatId];
    currentChatId = chatId;
    conversationHistory = chat.messages || [];
    const chatArea = document.getElementById('chatArea');
    chatArea.innerHTML = '';
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
let lastHeight = window.innerHeight;
window.addEventListener('resize', () => {
    const currentHeight = window.innerHeight;
    if (currentHeight < lastHeight) {
        setTimeout(() => { window.scrollToBottom(true); }, 100);
    }
    lastHeight = currentHeight;
});
