// AI Chat Bridge - Side Panel Script

// DOM Elements
const elements = {
  globalStatus: document.getElementById('global-status'),
  session1Card: document.getElementById('session1-card'),
  session1Status: document.getElementById('session1-status'),
  session1Platform: document.getElementById('session1-platform'),
  session2Card: document.getElementById('session2-card'),
  session2Status: document.getElementById('session2-status'),
  session2Platform: document.getElementById('session2-platform'),
  configPanel: document.getElementById('config-panel'),
  configToggle: document.getElementById('config-toggle'),
  replyDelay: document.getElementById('reply-delay'),
  maxTurns: document.getElementById('max-turns'),
  contextMessages: document.getElementById('context-messages'),
  saveConfig: document.getElementById('save-config'),
  topicInput: document.getElementById('topic-input'),
  initialPrompt: document.getElementById('initial-prompt'),
  promptPanel: document.getElementById('prompt-panel'),
  sessionsPanel: document.querySelector('.sessions-panel'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  conversationHistory: document.getElementById('conversation-history'),
  messageCount: document.getElementById('message-count'),
  clearHistory: document.getElementById('clear-history'),
  autoScroll: document.getElementById('auto-scroll'),
  turnIndicator: document.getElementById('turn-indicator')
};

// Track selected template
let selectedTemplate = null;

// Template generators - take topic as input
const promptGenerators = {
  debate: (topic) => `Bạn đang tham gia một cuộc tranh luận với một AI khác.

📌 CHỦ ĐỀ: "${topic}"

⚠️ QUAN TRỌNG - QUY TẮC BẮT BUỘC:
1. MỖI câu trả lời PHẢI DƯỚI 200 TỪ (khoảng 3-4 câu)
2. Chỉ đưa ra MỘT luận điểm duy nhất mỗi lượt
3. Kết thúc bằng MỘT câu hỏi ngắn cho đối phương
4. KHÔNG viết dài dòng, KHÔNG liệt kê nhiều ý

📋 CÁCH TRẢ LỜI:
- 1-2 câu: Nêu quan điểm hoặc phản biện
- 1 câu: Luận điểm chính
- 1 câu: Câu hỏi cho đối phương

Bắt đầu với lập trường của bạn (NHỚ: dưới 200 từ!)`,
  
  story: (topic) => `Hãy cùng viết một câu chuyện với AI khác!

📌 CHỦ ĐỀ: "${topic}"

⚠️ QUAN TRỌNG - QUY TẮC BẮT BUỘC:
1. MỖI lượt CHỈ VIẾT 2-3 CÂU (dưới 100 từ)
2. Tiếp nối từ đoạn trước, KHÔNG lặp lại
3. Tạo tình huống để người khác tiếp tục
4. KHÔNG viết kết thúc truyện

Bắt đầu với 2-3 câu mở đầu hấp dẫn!`,
  
  qa: (topic) => `Bạn đang phỏng vấn một AI khác.

📌 CHỦ ĐỀ: "${topic}"

⚠️ QUAN TRỌNG - QUY TẮC BẮT BUỘC:
1. MỖI lượt CHỈ HỎI 1 CÂU HỎI (dưới 50 từ)
2. Nếu đang trả lời: TRẢ LỜI NGẮN GỌN (2-3 câu, dưới 100 từ)
3. KHÔNG hỏi nhiều câu cùng lúc
4. KHÔNG trả lời dài dòng

Bắt đầu với MỘT câu hỏi đầu tiên!`,
  
  brainstorm: (topic) => `Hãy cùng brainstorm với AI khác!

📌 VẤN ĐỀ: "${topic}"

⚠️ QUAN TRỌNG - QUY TẮC BẮT BUỘC:
1. MỖI lượt CHỈ ĐƯA 1 Ý TƯỞNG (dưới 100 từ)
2. Mô tả ý tưởng trong 2-3 câu ngắn
3. Có thể bổ sung hoặc kết hợp ý tưởng trước
4. KHÔNG liệt kê nhiều ý tưởng

Bắt đầu với 1 ý tưởng đầu tiên!`
};

// Platform icons
const platformIcons = {
  gemini: '✨',
  chatgpt: '🤖',
  unknown: '❓'
};

// Track if config has been modified by user
let configModified = false;
let statePollingInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Side Panel] Initializing...');
  initializeUI();
  loadState();
  loadConfigOnce(); // Load config only once at start
  setupEventListeners();
  
  // Poll for state updates (but not config)
  statePollingInterval = setInterval(loadStateOnly, 2000);
});

function initializeUI() {
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = true;
}

// Load state and history only (called repeatedly)
async function loadStateOnly() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    updateUI(response);
    
    const historyResponse = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATION_HISTORY' });
    if (historyResponse.history) {
      renderConversationHistory(historyResponse.history);
    }
  } catch (error) {
    console.error('[Side Panel] Failed to load state:', error);
  }
}

// Load state + config (called once at startup)
async function loadState() {
  await loadStateOnly();
  await loadConfigOnce();
}

// Load config only once at startup
async function loadConfigOnce() {
  if (configModified) return; // Don't overwrite user's changes
  
  try {
    const configData = await chrome.storage.local.get(['config']);
    if (configData.config) {
      elements.replyDelay.value = configData.config.autoReplyDelay || 2000;
      elements.maxTurns.value = configData.config.maxTurns || 50;
      elements.contextMessages.value = configData.config.contextMessages || 4;
    }
  } catch (error) {
    console.error('[Side Panel] Failed to load config:', error);
  }
}

function setupEventListeners() {
  // Config panel toggle
  elements.configToggle.addEventListener('click', () => {
    elements.configPanel.classList.toggle('collapsed');
  });
  
  // Sessions panel toggle
  document.getElementById('sessions-toggle').addEventListener('click', () => {
    elements.sessionsPanel.classList.toggle('collapsed');
  });
  
  // Prompt panel toggle
  document.getElementById('prompt-toggle').addEventListener('click', () => {
    elements.promptPanel.classList.toggle('collapsed');
  });
  
  // Template buttons - generate prompt based on topic
  document.querySelectorAll('.template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = btn.dataset.template;
      const topic = elements.topicInput.value.trim();
      
      // Remove active class from all buttons
      document.querySelectorAll('.template-btn').forEach(b => b.classList.remove('active'));
      
      // Add active class to clicked button
      btn.classList.add('active');
      selectedTemplate = template;
      
      if (!topic) {
        showToast('⚠️ Vui lòng nhập chủ đề trước!', 'error');
        elements.topicInput.focus();
        return;
      }
      
      if (promptGenerators[template]) {
        const generatedPrompt = promptGenerators[template](topic);
        elements.initialPrompt.value = generatedPrompt;
        showToast('✅ Đã tạo prompt ' + template.toUpperCase() + '!', 'success');
      }
    });
  });
  
  // Auto-generate prompt when topic changes (if template selected)
  elements.topicInput.addEventListener('input', () => {
    if (selectedTemplate && elements.topicInput.value.trim()) {
      const topic = elements.topicInput.value.trim();
      elements.initialPrompt.value = promptGenerators[selectedTemplate](topic);
    }
  });
  
  // Track config changes
  elements.replyDelay.addEventListener('input', () => { configModified = true; });
  elements.maxTurns.addEventListener('input', () => { configModified = true; });
  elements.contextMessages.addEventListener('input', () => { configModified = true; });
  
  // Save config
  elements.saveConfig.addEventListener('click', saveConfiguration);
  
  // Start/Stop buttons
  elements.startBtn.addEventListener('click', startConversation);
  elements.stopBtn.addEventListener('click', stopConversation);
  
  // Clear history
  elements.clearHistory.addEventListener('click', clearHistory);
  
  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Side Panel] Received message:', message.type);
    
    switch (message.type) {
      case 'STATE_UPDATE':
        updateUI(message.state);
        break;
      case 'NEW_MESSAGE':
        renderConversationHistory(message.history);
        break;
      case 'CONVERSATION_CLEARED':
        lastRenderedCount = 0;
        renderConversationHistory([]);
        expandPanelsForSetup();
        break;
    }
    sendResponse({ received: true });
  });
}

// Collapse panels when conversation is active
function collapsePanelsForChat() {
  elements.configPanel.classList.add('collapsed');
  elements.sessionsPanel.classList.add('collapsed');
  if (elements.promptPanel) {
    elements.promptPanel.classList.add('collapsed');
  }
  document.querySelector('.conversation-panel').classList.add('expanded');
}

// Expand panels when setting up
function expandPanelsForSetup() {
  elements.sessionsPanel.classList.remove('collapsed');
  if (elements.promptPanel) {
    elements.promptPanel.classList.remove('collapsed');
  }
  document.querySelector('.conversation-panel').classList.remove('expanded');
}

let wasActive = false;

function updateUI(state) {
  if (!state) return;
  
  // Update global status
  const isActive = state.isActive;
  elements.globalStatus.className = `status-badge ${isActive ? 'active' : ''}`;
  elements.globalStatus.querySelector('.status-label').textContent = isActive ? 'Active' : 'Inactive';
  
  // Auto-collapse/expand panels based on conversation state
  if (isActive && !wasActive) {
    // Just started - collapse panels
    collapsePanelsForChat();
  } else if (!isActive && wasActive) {
    // Just stopped - expand panels
    expandPanelsForSetup();
  }
  wasActive = isActive;
  
  // Update session cards
  updateSessionCard(
    elements.session1Card,
    elements.session1Status,
    elements.session1Platform,
    state.session1.connected,
    state.session1.platform
  );
  
  updateSessionCard(
    elements.session2Card,
    elements.session2Status,
    elements.session2Platform,
    state.session2.connected,
    state.session2.platform
  );
  
  // Update button states
  const canStart = state.session1.connected && state.session2.connected && !isActive;
  const canStop = isActive;
  
  elements.startBtn.disabled = !canStart;
  elements.stopBtn.disabled = !canStop;
  
  // Update message count
  elements.messageCount.textContent = state.messageCount || 0;
  
  // Update turn indicator
  if (isActive) {
    const turnText = state.currentTurn === 1 ? '🔵 Agent A đang trả lời...' : '🟢 Agent B đang trả lời...';
    elements.turnIndicator.textContent = turnText;
    elements.turnIndicator.classList.add('active');
  } else {
    elements.turnIndicator.textContent = state.session1.connected && state.session2.connected ? '✅ Ready' : '⏳ Waiting...';
    elements.turnIndicator.classList.remove('active');
  }
}

function updateSessionCard(card, statusEl, platformEl, connected, platform) {
  card.className = `session-card ${connected ? 'connected' : ''}`;
  
  statusEl.textContent = connected ? 'Connected' : 'Disconnected';
  statusEl.className = `session-status ${connected ? 'connected' : 'disconnected'}`;
  
  if (connected && platform) {
    const icon = platformIcons[platform] || platformIcons.unknown;
    platformEl.innerHTML = `
      <span class="platform-icon">${icon}</span>
      <span>${platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
    `;
  } else {
    platformEl.innerHTML = `
      <span class="platform-icon">—</span>
      <span>Not connected</span>
    `;
  }
}

async function saveConfiguration() {
  const config = {
    autoReplyDelay: parseInt(elements.replyDelay.value) || 2000,
    maxTurns: parseInt(elements.maxTurns.value) || 50,
    contextMessages: parseInt(elements.contextMessages.value) || 4
  };
  
  console.log('[Side Panel] Saving config:', config);
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: config
    });
    
    console.log('[Side Panel] Config saved:', result);
    configModified = false; // Reset flag after successful save
    showToast('✅ Config saved!', 'success');
  } catch (error) {
    console.error('[Side Panel] Failed to save config:', error);
    showToast('❌ Failed to save', 'error');
  }
}

async function startConversation() {
  const initialPrompt = elements.initialPrompt.value.trim();
  
  if (!initialPrompt) {
    showToast('⚠️ Please enter a prompt', 'error');
    return;
  }
  
  elements.startBtn.disabled = true;
  elements.startBtn.textContent = 'Starting...';
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_CONVERSATION',
      initialPrompt: initialPrompt
    });
    
    if (response.success) {
      showToast('🚀 Conversation started!', 'success');
    } else {
      showToast('❌ ' + (response.error || 'Failed to start'), 'error');
    }
  } catch (error) {
    console.error('[Side Panel] Failed to start:', error);
    showToast('❌ Failed to start', 'error');
  }
  
  // Reset button
  setTimeout(() => {
    elements.startBtn.innerHTML = '<span class="btn-icon">▶️</span> Start';
    loadState();
  }, 500);
}

async function stopConversation() {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_CONVERSATION' });
    
    // Immediately update UI
    wasActive = false;
    elements.globalStatus.className = 'status-badge';
    elements.globalStatus.querySelector('.status-label').textContent = 'Inactive';
    elements.turnIndicator.textContent = '⏹️ Stopped';
    elements.turnIndicator.classList.remove('active');
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    
    // Expand panels back
    expandPanelsForSetup();
    
    showToast('⏹️ Conversation stopped', 'success');
  } catch (error) {
    console.error('[Side Panel] Failed to stop:', error);
    showToast('❌ Failed to stop', 'error');
  }
}

async function clearHistory() {
  if (!confirm('Clear all conversation history?')) return;
  
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    lastRenderedCount = 0; // Reset render counter
    showToast('🗑️ History cleared', 'success');
  } catch (error) {
    console.error('[Side Panel] Failed to clear:', error);
    showToast('❌ Failed to clear', 'error');
  }
}

// Track rendered messages to avoid re-rendering
let lastRenderedCount = 0;

function renderConversationHistory(history) {
  if (!history || history.length === 0) {
    elements.conversationHistory.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💭</span>
        <p>No messages yet</p>
        <p class="empty-hint">Start a conversation to see messages here</p>
      </div>
    `;
    elements.messageCount.textContent = '0';
    lastRenderedCount = 0;
    return;
  }
  
  elements.messageCount.textContent = history.length;
  
  // Check if we need full re-render or just append
  if (lastRenderedCount === 0 || history.length < lastRenderedCount) {
    // Full re-render
    elements.conversationHistory.innerHTML = history.map((msg, index) => {
      return createMessageHTML(msg, index === history.length - 1);
    }).join('');
  } else if (history.length > lastRenderedCount) {
    // Only append new messages
    const newMessages = history.slice(lastRenderedCount);
    newMessages.forEach(msg => {
      const div = document.createElement('div');
      div.innerHTML = createMessageHTML(msg, true);
      const newElement = div.firstElementChild;
      elements.conversationHistory.appendChild(newElement);
      
      // Remove 'new' class after animation ends
      setTimeout(() => {
        newElement.classList.remove('new');
      }, 350);
    });
  }
  // If same count, do nothing (avoid unnecessary re-renders)
  
  lastRenderedCount = history.length;
  
  // Auto-scroll
  if (elements.autoScroll.checked) {
    elements.conversationHistory.scrollTop = elements.conversationHistory.scrollHeight;
  }
}

function createMessageHTML(msg, isNew) {
  const agentClass = msg.sessionNum === 1 ? 'agent-a' : 'agent-b';
  const newClass = isNew ? 'new' : '';
  const time = new Date(msg.timestamp).toLocaleTimeString('vi-VN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  return `
    <div class="message-item ${agentClass} ${newClass}" data-id="${msg.id}">
      <div class="message-meta">
        <span class="message-role">${escapeHtml(msg.role)}</span>
        <span class="message-time">${time}</span>
        <span class="message-platform">${escapeHtml(msg.platform || 'unknown')}</span>
      </div>
      <div class="message-text">${escapeHtml(msg.content)}</div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 2500);
}

// ============================================
// DEBUG LOGS FUNCTIONALITY
// ============================================

const debugElements = {
  debugPanel: document.getElementById('debug-panel'),
  debugToggle: document.getElementById('debug-toggle'),
  refreshLogs: document.getElementById('refresh-logs'),
  downloadLogs: document.getElementById('download-logs'),
  clearLogs: document.getElementById('clear-logs'),
  logContainer: document.getElementById('log-container'),
  logCount: document.getElementById('log-count')
};

// Initialize debug panel
if (debugElements.debugToggle) {
  debugElements.debugToggle.addEventListener('click', () => {
    debugElements.debugPanel.classList.toggle('collapsed');
    // Auto-refresh when opening
    if (!debugElements.debugPanel.classList.contains('collapsed')) {
      refreshLogs();
    }
  });
}

if (debugElements.refreshLogs) {
  debugElements.refreshLogs.addEventListener('click', refreshLogs);
}

if (debugElements.downloadLogs) {
  debugElements.downloadLogs.addEventListener('click', downloadLogs);
}

if (debugElements.clearLogs) {
  debugElements.clearLogs.addEventListener('click', clearLogs);
}

async function refreshLogs() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    const logs = response.logs || [];
    
    debugElements.logCount.textContent = `${logs.length} logs`;
    
    if (logs.length === 0) {
      debugElements.logContainer.innerHTML = `
        <div class="empty-state">
          <p>No logs yet</p>
        </div>
      `;
      return;
    }
    
    // Show last 100 logs (most recent first)
    const recentLogs = logs.slice(-100).reverse();
    
    debugElements.logContainer.innerHTML = recentLogs.map(log => {
      const levelClass = log.level.toLowerCase();
      const time = new Date(log.timestamp).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      
      return `
        <div class="log-entry ${levelClass}">
          <span class="log-time">${time}</span>
          <span class="log-level">${log.level}</span>
          <span class="log-source">${escapeHtml(log.source)}</span>
          <span class="log-message">${escapeHtml(log.message)}</span>
        </div>
      `;
    }).join('');
    
    showToast(`🔄 Loaded ${logs.length} logs`, 'success');
  } catch (error) {
    console.error('[Side Panel] Failed to load logs:', error);
    showToast('❌ Failed to load logs', 'error');
  }
}

async function downloadLogs() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    const logs = response.logs || [];
    
    if (logs.length === 0) {
      showToast('⚠️ No logs to download', 'error');
      return;
    }
    
    // Format logs as text
    const lines = logs.map(log => 
      `[${log.timestamp}] [${log.level}] [${log.source}] ${log.message}`
    );
    const content = lines.join('\n');
    
    // Create download
    const filename = `ai-bridge-logs-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.log`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast(`📥 Downloaded ${filename}`, 'success');
  } catch (error) {
    console.error('[Side Panel] Failed to download logs:', error);
    showToast('❌ Failed to download', 'error');
  }
}

async function clearLogs() {
  if (!confirm('Clear all debug logs?')) return;
  
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    debugElements.logContainer.innerHTML = `
      <div class="empty-state">
        <p>Logs cleared</p>
      </div>
    `;
    debugElements.logCount.textContent = '0 logs';
    showToast('🗑️ Logs cleared', 'success');
  } catch (error) {
    console.error('[Side Panel] Failed to clear logs:', error);
    showToast('❌ Failed to clear logs', 'error');
  }
}

