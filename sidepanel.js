// AI Chat Bridge - Side Panel Script
function log(level, ...args) {
  const message = args.map(arg =>
    typeof arg === "object" ? JSON.stringify(arg) : String(arg)
  ).join(" ");
  chrome.runtime.sendMessage({
    type: "ADD_LOG",
    entry: {
      timestamp: new Date().toISOString(),
      level: level,
      source: "SidePanel",
      message: message
    }
  }).catch(() => { });
}
function spLog(...args) { log("INFO", ...args); }
function spWarn(...args) { log("WARN", ...args); }
function spError(...args) { log("ERROR", ...args); }

// DOM Elements
const elements = {
  globalStatus: document.getElementById('global-status'),
  session1Card: document.getElementById('session1-card'),
  session1Status: document.getElementById('session1-status'),
  session1Platform: document.getElementById('session1-platform'),
  session2Card: document.getElementById('session2-card'),
  session2Status: document.getElementById('session2-status'),
  session2Platform: document.getElementById('session2-platform'),
  replyDelay: document.getElementById('reply-delay'),
  maxTurns: document.getElementById('max-turns'),
  contextMessages: document.getElementById('context-messages'),
  activateTabs: document.getElementById('activate-tabs'),
  hybridActivationTime: document.getElementById('hybrid-activation-time'),
  hybridCheckInterval: document.getElementById('hybrid-check-interval'),
  hybridInitialDelay: document.getElementById('hybrid-initial-delay'),
  saveConfig: document.getElementById('save-config'),
  topicInput: document.getElementById('topic-input'),
  initialPrompt: document.getElementById('initial-prompt'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  continueBtn: document.getElementById('continue-btn'),
  clearConversationBtn: document.getElementById('clear-conversation-btn'),
  conversationHistory: document.getElementById('conversation-history'),
  messageCount: document.getElementById('message-count'),
  autoScroll: document.getElementById('auto-scroll'),
  turnIndicator: document.getElementById('turn-indicator'),
  backendStatus: document.getElementById('backend-status'),
  backendIndicator: document.getElementById('backend-indicator'),
  backendLabel: document.getElementById('backend-label')
};

// Track selected template (default: debate)
let selectedTemplate = 'debate';

// Reset textarea to default height
function resetTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = '44px'; // min-height
}

// Auto-resize textarea function
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  const scrollHeight = textarea.scrollHeight;
  const minHeight = 44;
  const maxHeight = 200;
  const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  textarea.style.height = newHeight + 'px';
}

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

// Platform icons (SVG paths)
const platformIcons = {
  gemini: '<svg class="platform-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>',
  chatgpt: '<svg class="platform-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>',
  unknown: '<svg class="platform-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
};

// Track if config has been modified by user
let configModified = false;
let statePollingInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  spLog('[Side Panel] Initializing...');
  initializeUI();
  loadTheme();
  loadState();
  loadConfigOnce(); // Load config only once at start
  setupEventListeners();
  
  // Initialize textarea - reset to default state
  if (elements.topicInput) {
    elements.topicInput.value = '';
    resetTextarea(elements.topicInput);
  }

  // Poll for state updates (but not config)
  statePollingInterval = setInterval(loadStateOnly, 2000);

  // Load backend status
  loadBackendStatus();
  setInterval(loadBackendStatus, 3000); // Check every 3 seconds
});

function initializeUI() {
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = true;
  elements.continueBtn.disabled = true;

  // Enable send button if there's text in the input
  updateSendButtonState();
}

// Update send button state based on input text and session status
function updateSendButtonState(forceCanStart = null) {
  const hasText = elements.topicInput.value.trim().length > 0;

  if (forceCanStart !== null) {
    // If session state is provided, use it
    elements.startBtn.disabled = !forceCanStart && !hasText;
  } else {
    // Otherwise, enable if there's text
    elements.startBtn.disabled = !hasText;
  }
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

    // Also refresh available agents periodically
    loadAvailableAgents();
  } catch (error) {
    spError('[Side Panel] Failed to load state:', error);
  }
}

// Load state + config (called once at startup)
async function loadState() {
  await loadStateOnly();
  await loadConfigOnce();
  // Also load available agents
  loadAvailableAgents();
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
      // Handle activateTabs: support both old boolean and new string mode
      let activateTabsValue = configData.config.activateTabs || 'hybrid';
      if (typeof activateTabsValue === 'boolean') {
        activateTabsValue = activateTabsValue ? 'always' : 'never';
      }
      if (!['always', 'never', 'hybrid'].includes(activateTabsValue)) {
        activateTabsValue = 'hybrid';
      }
      elements.activateTabs.value = activateTabsValue;
      
      // Load hybrid mode timeout settings
      if (elements.hybridActivationTime) {
        elements.hybridActivationTime.value = configData.config.hybridActivationTime || 1500;
      }
      if (elements.hybridCheckInterval) {
        elements.hybridCheckInterval.value = configData.config.hybridCheckInterval || 30000;
      }
      if (elements.hybridInitialDelay) {
        elements.hybridInitialDelay.value = configData.config.hybridInitialDelay || 30000;
      }
      
      // Show/hide hybrid timeout settings based on mode
      updateHybridSettingsVisibility(activateTabsValue);
    }
  } catch (error) {
    spError('[Side Panel] Failed to load config:', error);
  }
}

function setupEventListeners() {
  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Tab navigation
  document.querySelectorAll('.tab-icon').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });

  // Template quick buttons in chat header
  document.querySelectorAll('.template-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = btn.dataset.template;

      // Remove active class from all buttons
      document.querySelectorAll('.template-quick-btn').forEach(b => b.classList.remove('active'));

      // Add active class to clicked button
      btn.classList.add('active');
      selectedTemplate = template;

      // Auto-generate prompt if topic exists
      const topic = elements.topicInput.value.trim();
      if (topic && promptGenerators[template]) {
        elements.initialPrompt.value = promptGenerators[template](topic);
        showToast('✅ Template ' + template.toUpperCase() + ' selected', 'success');
      } else {
        showToast('✅ Template ' + template.toUpperCase() + ' selected', 'success');
      }
    });
  });

  // Auto-generate prompt when topic changes (if template selected)
  elements.topicInput.addEventListener('input', () => {
    // Auto-resize textarea
    autoResizeTextarea(elements.topicInput);

    if (selectedTemplate && elements.topicInput.value.trim()) {
      const topic = elements.topicInput.value.trim();
      elements.initialPrompt.value = promptGenerators[selectedTemplate](topic);
    }

    // Enable send button when there's text (even if sessions not connected)
    const hasText = elements.topicInput.value.trim().length > 0;
    if (hasText) {
      elements.startBtn.disabled = false;
    } else {
      // Re-check session state to determine if button should be disabled
      updateSendButtonState();
    }
  });

  // Enter key to send (normal chat behavior)
  elements.topicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!elements.startBtn.disabled) {
        startConversation();
      }
    }
  });

  // Track config changes
  elements.replyDelay.addEventListener('input', () => { configModified = true; });
  elements.maxTurns.addEventListener('input', () => { configModified = true; });
  elements.contextMessages.addEventListener('input', () => { configModified = true; });
  if (elements.activateTabs) {
    elements.activateTabs.addEventListener('change', () => { configModified = true; });
  }

  // Save config
  elements.saveConfig.addEventListener('click', saveConfiguration);

  // Start/Stop/Continue buttons
  elements.startBtn.addEventListener('click', startConversation);
  elements.stopBtn.addEventListener('click', stopConversation);
  elements.continueBtn.addEventListener('click', continueConversation);

  // Clear conversation (near stop button)
  if (elements.clearConversationBtn) {
    elements.clearConversationBtn.addEventListener('click', clearHistory);
  }

  // Expand/collapse conversation view
  const expandBtn = document.getElementById('expand-conversation-btn');
  const collapseBtn = document.getElementById('collapse-conversation-btn');
  
  if (expandBtn && collapseBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      spLog('[Side Panel] Expand button clicked, enabling focus mode');
      document.body.classList.add('conversation-focus-mode');
      expandBtn.style.display = 'none';
      collapseBtn.style.display = 'flex';
      spLog('[Side Panel] Focus mode enabled, body classes:', document.body.className);
    });
    
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      spLog('[Side Panel] Collapse button clicked, disabling focus mode');
      document.body.classList.remove('conversation-focus-mode');
      collapseBtn.style.display = 'none';
      expandBtn.style.display = 'flex';
      spLog('[Side Panel] Focus mode disabled, body classes:', document.body.className);
    });
  } else {
    spWarn('[Side Panel] Expand/collapse buttons not found!', { expandBtn: !!expandBtn, collapseBtn: !!collapseBtn });
  }

  // Snapshot conversation
  const snapshotBtn = document.getElementById('snapshot-conversation-btn');
  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', snapshotConversation);
  }

  // Download conversation
  const downloadBtn = document.getElementById('download-conversation-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadConversation);
  }

  // Agent selectors
  const agentASelector = document.getElementById('agent-a-selector');
  const agentBSelector = document.getElementById('agent-b-selector');

  if (agentASelector) {
    agentASelector.addEventListener('change', (e) => {
      const tabId = e.target.value ? parseInt(e.target.value) : null;
      assignAgentToSlot(tabId, 1);
    });
  }

  if (agentBSelector) {
    agentBSelector.addEventListener('change', (e) => {
      const tabId = e.target.value ? parseInt(e.target.value) : null;
      assignAgentToSlot(tabId, 2);
    });
  }

  // Release buttons
  const releaseSession1Btn = document.getElementById('release-session1-btn');
  if (releaseSession1Btn) {
    releaseSession1Btn.addEventListener('click', () => releaseAgentFromSlot(1));
  }

  const releaseSession2Btn = document.getElementById('release-session2-btn');
  if (releaseSession2Btn) {
    releaseSession2Btn.addEventListener('click', () => releaseAgentFromSlot(2));
  }



  // Load available agents
  loadAvailableAgents();

  // Refresh agents button
  const refreshAgentsBtn = document.getElementById('refresh-agents-btn');
  if (refreshAgentsBtn) {
    refreshAgentsBtn.addEventListener('click', async () => {
      // Trigger auto-registration to catch any missed tabs
      try {
        await chrome.runtime.sendMessage({ type: 'AUTO_REGISTER_TABS' });
        showToast('🔄 Refreshing agents...', 'success');
        setTimeout(() => {
          loadAvailableAgents();
          loadRegisteredUrls(); // Also refresh platforms list
        }, 1000);
      } catch (error) {
        spError('[Side Panel] Refresh error:', error);
        showToast('❌ Failed to refresh', 'error');
      }
    });
  }

  // Auto-open settings
  const autoOpenOnStart = document.getElementById('auto-open-on-start');
  const autoOpenEmptyTabs = document.getElementById('auto-open-empty-tabs');
  const openSelectedPlatformsBtn = document.getElementById('open-selected-platforms-btn');
  const openInEmptyTabsBtn = document.getElementById('open-in-empty-tabs-btn');

  if (autoOpenOnStart) {
    autoOpenOnStart.addEventListener('change', async () => {
      await updateAutoOpenSettings({
        openOnBrowserStart: autoOpenOnStart.checked
      });
    });
  }

  if (autoOpenEmptyTabs) {
    autoOpenEmptyTabs.addEventListener('change', async () => {
      await updateAutoOpenSettings({
        openInEmptyTabs: autoOpenEmptyTabs.checked
      });
    });
  }

  if (openSelectedPlatformsBtn) {
    openSelectedPlatformsBtn.addEventListener('click', async () => {
      await openSelectedPlatforms();
    });
  }

  if (openInEmptyTabsBtn) {
    openInEmptyTabsBtn.addEventListener('click', async () => {
      await openInEmptyTabs();
    });
  }

  // Load registered URLs on startup
  loadRegisteredUrls();

  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    spLog('[Side Panel] Received message:', message.type);

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
        break;
      case 'BACKEND_STATUS_UPDATE':
        updateBackendStatusUI(message.status);
        break;
      case 'AVAILABLE_AGENTS_UPDATE':
        renderAvailableAgents(message.agents);
        break;
    }
    // Don't sendResponse blindly - it interferes with other message channels!
  });
}

// Theme management
function loadTheme() {
  try {
    const savedTheme = localStorage.getItem('ai-bridge-theme') || 'light';
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  } catch (error) {
    spError('[Side Panel] Failed to load theme:', error);
  }
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  const theme = isDark ? 'dark' : 'light';

  try {
    localStorage.setItem('ai-bridge-theme', theme);
    showToast(isDark ? '🌙 Dark theme enabled' : '☀️ Light theme enabled', 'success');
  } catch (error) {
    spError('[Side Panel] Failed to save theme:', error);
  }
}

// Tab switching function
function switchTab(tabName) {
  spLog('[Side Panel] Switching to tab:', tabName);

  // Update tab icons
  document.querySelectorAll('.tab-icon').forEach(tab => {
    tab.classList.remove('active');
  });
  const activeTab = document.querySelector(`.tab-icon[data-tab="${tabName}"]`);
  if (activeTab) {
    activeTab.classList.add('active');
    spLog('[Side Panel] Tab icon activated:', tabName);
  } else {
    spError('[Side Panel] Tab icon not found:', tabName);
  }

  // Update tab pages - hide all first
  document.querySelectorAll('.tab-page').forEach(page => {
    page.classList.remove('active');
  });

  // Show the selected tab page
  const activePage = document.getElementById(`${tabName}-tab-page`);
  if (activePage) {
    activePage.classList.add('active');
    spLog('[Side Panel] Tab page activated:', tabName);
  } else {
    spError('[Side Panel] Tab page not found:', `${tabName}-tab-page`);
  }

  // Auto-refresh debug logs when opening debug tab
  if (tabName === 'debug') {
    setTimeout(() => refreshLogs(), 300);
  }
}

// ============================================
// BACKEND STATUS
// ============================================

async function loadBackendStatus() {
  try {
    // Try to get backend status from background
    // Background will query backend client if available
    const response = await chrome.runtime.sendMessage({ type: 'GET_BACKEND_STATUS' });
    if (response && response.status) {
      updateBackendStatusUI(response.status);
    }
  } catch (error) {
    // If backend client not available, show disconnected
    updateBackendStatusUI({ connected: false, status: 'disconnected' });
  }
}

function updateBackendStatusUI(status) {
  if (!elements.backendStatus) return;

  const { connected, status: statusText, extensionId, error } = status || {};

  // Remove all status classes
  elements.backendStatus.classList.remove('connected', 'connecting', 'disconnected');

  if (connected) {
    elements.backendStatus.classList.add('connected');
    elements.backendLabel.textContent = 'Backend';
    elements.backendStatus.title = `Backend Connected${extensionId ? ` (ID: ${extensionId.substring(0, 8)}...)` : ''}\nClick to refresh`;
    elements.backendStatus.style.cursor = 'pointer';
  } else if (statusText === 'connecting') {
    elements.backendStatus.classList.add('connecting');
    elements.backendLabel.textContent = 'Connecting...';
    elements.backendStatus.title = 'Connecting to backend server...';
    elements.backendStatus.style.cursor = 'wait';
  } else {
    elements.backendStatus.classList.add('disconnected');
    elements.backendLabel.textContent = 'No Backend';
    elements.backendStatus.title = (error || 'Backend server not connected. Start backend server at localhost:3000') + '\nClick to reconnect';
    elements.backendStatus.style.cursor = 'pointer';
  }

  // Add click handler to reconnect
  elements.backendStatus.onclick = async () => {
    if (statusText === 'connecting') return; // Don't allow click while connecting

    showToast('🔄 Reconnecting to backend...', 'success');

    // Trigger backend client initialization
    try {
      await chrome.runtime.sendMessage({ type: 'BACKEND_CONNECT' });
      // Refresh status after a delay
      setTimeout(loadBackendStatus, 1000);
    } catch (error) {
      showToast('❌ Failed to reconnect', 'error');
    }
  };
}

// No longer needed - panels are now in tabs

let wasActive = false;

function updateUI(state) {
  if (!state) return;

  // Update global status
  const isActive = state.isActive;
  elements.globalStatus.className = `status-badge ${isActive ? 'active' : ''}`;
  elements.globalStatus.querySelector('.status-label').textContent = isActive ? 'Active' : 'Inactive';

  wasActive = isActive;

  // Render participants dynamically
  renderParticipants(state.participants || []);

  // Update button states - need at least 2 participants
  const participants = state.participants || [];
  const allConnected = participants.length >= 2 && participants.every(p => p.connected);
  const canStart = allConnected && !isActive;
  const canStop = isActive;

  updateSendButtonState(canStart);
  elements.stopBtn.disabled = !canStop;
  
  // Update continue button - enable if there's conversation history and at least one participant
  const hasHistory = (state.messageCount || 0) > 0;
  const hasParticipants = participants.length > 0 && participants.some(p => p.connected);
  elements.continueBtn.disabled = !hasHistory || !hasParticipants;

  // Update agent selectors
  updateAgentSelectors();

  // Update message count
  elements.messageCount.textContent = state.messageCount || 0;

  // Update turn indicator
  if (isActive && participants.length > 0) {
    const currentParticipant = participants[state.currentTurn] || participants[0];
    const turnText = `${currentParticipant.role || `Participant ${state.currentTurn + 1}`} đang trả lời...`;
    const indicator = '<svg class="inline w-2 h-2 mr-1 animate-pulse" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>';
    elements.turnIndicator.innerHTML = indicator + turnText;
    elements.turnIndicator.className = 'turn-indicator active';
  } else {
    // Not active - check connection status
    if (allConnected) {
      const readyIcon = '<svg class="inline w-2 h-2 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
      elements.turnIndicator.innerHTML = readyIcon + 'Ready to start';
      elements.turnIndicator.className = 'turn-indicator ready'; // Add ready class for green color
    } else {
      const waitingIcon = '<svg class="inline w-2 h-2 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
      const needed = Math.max(2, participants.length);
      const connectedCount = participants.filter(p => p.connected).length;
      elements.turnIndicator.innerHTML = waitingIcon + `Connect agents (${connectedCount}/${needed})`;
      elements.turnIndicator.className = 'turn-indicator';
    }
  }
}

// Render all participants dynamically
function renderParticipants(participants) {
  const container = document.getElementById('participants-container');
  if (!container) return;

  // Clear container
  container.innerHTML = '';

  // Filter out empty participants (those without tabId)
  const validParticipants = participants.filter(p => p && p.tabId && p.tabId !== null);

  // Only show participants that actually exist (no empty slots)
  if (!validParticipants || validParticipants.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 20px;">
        <p style="color: var(--text-muted); font-size: 12px;">No agents added yet</p>
        <p class="empty-hint">Select agents from the list below to add them to the conversation</p>
      </div>
    `;
    return;
  }

  // Render each participant (only those with actual agents)
  validParticipants.forEach((participant, index) => {
    const hasAgent = participant.tabId && participant.tabId !== null;
    const connected = participant.connected && hasAgent;
    const platform = participant.platform || null;
    const position = participant.order || index + 1;
    
    // Check availability
    const availability = participant.availability || { available: true, reason: null, requiresLogin: false };
    const isAvailable = availability.available !== false;
    const warningReason = availability.reason || null;
    const requiresLogin = availability.requiresLogin || false;

    const card = document.createElement('div');
    card.className = `participant-card ${connected ? 'connected' : ''} ${!isAvailable ? 'unavailable' : ''}`;
    card.dataset.position = position;
    card.dataset.tabId = participant.tabId || '';

    const icon = connected && platform ? (platformIcons[platform] || platformIcons.unknown) : '';
    const platformName = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Not connected';

    card.innerHTML = `
      <div class="participant-card-row">
        <div class="participant-info">
          <div class="participant-order">
            <span class="order-number">${position}</span>
          </div>
          ${connected && platform ? icon : ''}
          <div class="participant-name-wrapper">
            <span class="${connected ? 'platform-name-text' : 'empty-slot-text'}">
              ${connected && platform ? platformName : 'Waiting for agent...'}
            </span>
            ${!isAvailable && warningReason ? `
              <div class="participant-warning" title="${escapeHtml(warningReason)}">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
                <span class="warning-text">${escapeHtml(warningReason)}</span>
              </div>
            ` : ''}
          </div>
        </div>
        
        <div class="participant-controls">
          <span class="session-status ${connected ? (isAvailable ? 'connected' : 'warning') : 'disconnected'}">
            ${connected ? (isAvailable ? 'Connected' : '⚠️ Unavailable') : 'Empty'}
          </span>
          <button class="btn-release compact" data-position="${position}" 
                  style="display:${connected ? 'flex' : 'none'};" 
                  title="Remove from conversation">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);

    // Add arrow between participants (except after last)
    if (index < validParticipants.length - 1) {
      const arrow = document.createElement('div');
      arrow.className = 'flow-arrow';
      arrow.innerHTML = `
        <svg class="flow-arrow-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
        </svg>
      `;
      container.appendChild(arrow);
    }
  });

  // Attach event listeners
  attachParticipantListeners();
}

// Attach event listeners to participant cards
function attachParticipantListeners() {
  // Selector change handlers
  document.querySelectorAll('.agent-selector').forEach(selector => {
    selector.addEventListener('change', async (e) => {
      const position = parseInt(selector.dataset.position);
      const tabId = e.target.value;

      if (!tabId) {
        // Deselecting - remove participant
        await releaseAgentFromSlot(position);
      } else {
        // Selecting - assign agent
        await assignAgentToSlot(tabId, position);
      }
    });
  });

  // Release button handlers
  document.querySelectorAll('.btn-release').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const position = parseInt(btn.dataset.position);
      await releaseAgentFromSlot(position);
    });
  });
}

async function saveConfiguration() {
  const config = {
    autoReplyDelay: parseInt(elements.replyDelay.value) || 2000,
    maxTurns: parseInt(elements.maxTurns.value) || 50,
    contextMessages: parseInt(elements.contextMessages.value) || 4,
    activateTabs: elements.activateTabs ? elements.activateTabs.value : 'hybrid',
    hybridActivationTime: elements.hybridActivationTime ? parseInt(elements.hybridActivationTime.value) || 1500 : 1500,
    hybridCheckInterval: elements.hybridCheckInterval ? parseInt(elements.hybridCheckInterval.value) || 30000 : 30000,
    hybridInitialDelay: elements.hybridInitialDelay ? parseInt(elements.hybridInitialDelay.value) || 30000 : 30000
  };

  spLog('[Side Panel] Saving config:', config);

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: config
    });

    spLog('[Side Panel] Config saved:', result);
    configModified = false; // Reset flag after successful save
    showToast('✅ Config saved!', 'success');
  } catch (error) {
    spError('[Side Panel] Failed to save config:', error);
    showToast('❌ Failed to save', 'error');
  }
}

async function startConversation() {
  const topic = elements.topicInput.value.trim();

  if (!topic) {
    showToast('⚠️ Please enter a topic', 'error');
    elements.topicInput.focus();
    return;
  }

  // Generate prompt if template is selected, otherwise use topic directly
  let initialPrompt = topic;
  if (selectedTemplate && promptGenerators[selectedTemplate]) {
    initialPrompt = promptGenerators[selectedTemplate](topic);
  }

  // Store in hidden textarea for consistency
  elements.initialPrompt.value = initialPrompt;

  elements.startBtn.disabled = true;
  elements.startBtn.innerHTML = '<svg class="btn-icon animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_CONVERSATION',
      initialPrompt: initialPrompt,
      templateType: selectedTemplate || null
    });

    if (response.success) {
      showToast('🚀 Conversation started!', 'success');
      // Clear input after starting
      elements.topicInput.value = '';
      resetTextarea(elements.topicInput);
    } else {
      showToast('❌ ' + (response.error || 'Failed to start'), 'error');
    }
  } catch (error) {
    spError('[Side Panel] Failed to start:', error);
    showToast('❌ Failed to start', 'error');
  }

  // Reset button
  setTimeout(() => {
    elements.startBtn.innerHTML = '<svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>';
    loadState();
    updateSendButtonState();
  }, 500);
}

async function stopConversation() {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_CONVERSATION' });

    // Immediately update UI
    wasActive = false;
    elements.globalStatus.className = 'status-badge';
    elements.globalStatus.querySelector('.status-label').textContent = 'Inactive';
    elements.turnIndicator.innerHTML = '<svg class="inline w-2 h-2 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10h6v4H9z"></path></svg> Stopped';
    elements.turnIndicator.classList.remove('active');
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;

    showToast('⏹️ Conversation stopped', 'success');
  } catch (error) {
    spError('[Side Panel] Failed to stop:', error);
    showToast('❌ Failed to stop', 'error');
  }
}

async function continueConversation() {
  try {
    // Get conversation history and state
    const [historyResponse, stateResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_CONVERSATION_HISTORY' }),
      chrome.runtime.sendMessage({ type: 'GET_STATE' })
    ]);

    const history = historyResponse.history || [];
    const state = stateResponse || {};

    if (history.length === 0) {
      showToast('⚠️ No conversation history to continue', 'error');
      return;
    }

    const participants = state.participants || [];
    if (participants.length === 0 || !participants.some(p => p.connected)) {
      showToast('⚠️ No active participants to continue with', 'error');
      return;
    }

    // Get the most recent message
    const lastMessage = history[history.length - 1];
    if (!lastMessage) {
      showToast('⚠️ No recent message found', 'error');
      return;
    }

    // Get initial prompt (subject) from config
    const initialPrompt = state.config?.initialPrompt || '';
    const templateType = state.config?.templateType || null;

    // Determine which agent to send to (current turn, or first available if not active)
    let targetParticipantIndex = state.currentTurn || 0;
    if (!state.isActive) {
      // If conversation is not active, find the first connected participant
      targetParticipantIndex = participants.findIndex(p => p.connected);
      if (targetParticipantIndex === -1) {
        showToast('⚠️ No connected participants available', 'error');
        return;
      }
    }

    // Build continuation message with subject and recent message
    let continuationMessage = '';
    
    if (initialPrompt && initialPrompt.trim()) {
      continuationMessage += '📌 **CHỦ ĐỀ / CÂU HỎI GỐC:**\n';
      continuationMessage += initialPrompt + '\n\n';
      continuationMessage += '─'.repeat(40) + '\n\n';
    }

    continuationMessage += '📋 **TIN NHẮN GẦN ĐÂY NHẤT:**\n';
    continuationMessage += '─'.repeat(40) + '\n';
    continuationMessage += `**${lastMessage.role || `Participant ${lastMessage.sessionNum}`}**: ${lastMessage.content}\n\n`;
    continuationMessage += '─'.repeat(40) + '\n';
    continuationMessage += '👉 **Hãy tiếp tục cuộc thảo luận dựa trên tin nhắn trên.**\n';

    // Add template-specific instructions if available
    if (templateType) {
      const wordLimit = templateType === 'debate' ? 200 : 
                       templateType === 'story' ? 100 :
                       templateType === 'qa' ? 100 :
                       templateType === 'brainstorm' ? 100 : 200;
      continuationMessage += `⚠️ Giữ câu trả lời NGẮN GỌN (2-4 câu, dưới ${wordLimit} từ).`;
    }

    elements.continueBtn.disabled = true;
    elements.continueBtn.innerHTML = '<svg class="btn-icon w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Continuing...';

    // Send continuation message
    const response = await chrome.runtime.sendMessage({
      type: 'CONTINUE_CONVERSATION',
      participantIndex: targetParticipantIndex,
      message: continuationMessage
    });

    if (response.success) {
      showToast('▶️ Conversation continued!', 'success');
      // If conversation was not active, reactivate it
      if (!state.isActive) {
        // The background script will handle reactivation
        setTimeout(() => {
          loadStateOnly();
        }, 500);
      }
    } else {
      showToast('❌ ' + (response.error || 'Failed to continue'), 'error');
    }
  } catch (error) {
    spError('[Side Panel] Failed to continue:', error);
    showToast('❌ Failed to continue', 'error');
  } finally {
    // Reset button
    setTimeout(() => {
      elements.continueBtn.innerHTML = '<svg class="btn-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Continue';
      loadState();
    }, 500);
  }
}

async function clearHistory() {
  if (!confirm('Clear all conversation history?')) return;

  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    lastRenderedCount = 0; // Reset render counter
    showToast('🗑️ History cleared', 'success');
  } catch (error) {
    spError('[Side Panel] Failed to clear:', error);
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

// Color palette for participants (distinct, accessible colors)
const participantColors = [
  { color: '#ff9500', bg: 'rgba(255, 149, 0, 0.12)' },  // Orange
  { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },  // Blue
  { color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },  // Green
  { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)' },  // Purple
  { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.12)' },  // Pink
  { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.12)' },   // Cyan
  { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },  // Amber
  { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },   // Red
  { color: '#6366f1', bg: 'rgba(99, 102, 241, 0.12)' },  // Indigo
  { color: '#14b8a6', bg: 'rgba(20, 184, 166, 0.12)' },  // Teal
];

// Dark theme colors
const participantColorsDark = [
  { color: '#ff9500', bg: 'rgba(255, 149, 0, 0.15)' },
  { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  { color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' },
  { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' },
  { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  { color: '#6366f1', bg: 'rgba(99, 102, 241, 0.15)' },
  { color: '#14b8a6', bg: 'rgba(20, 184, 166, 0.15)' },
];

function getParticipantColor(sessionNum) {
  const isDark = document.body.classList.contains('dark-theme');
  const palette = isDark ? participantColorsDark : participantColors;
  const index = (sessionNum - 1) % palette.length;
  return palette[index];
}

function createMessageHTML(msg, isNew) {
  const newClass = isNew ? 'new' : '';
  const time = new Date(msg.timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const colors = getParticipantColor(msg.sessionNum);

  return `
    <div class="message-item ${newClass}" data-id="${msg.id}" data-session="${msg.sessionNum}" style="background: ${colors.bg}; border-left: 3px solid ${colors.color};">
      <div class="message-meta">
        <span class="message-role" style="color: ${colors.color};">${escapeHtml(msg.role)}</span>
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

async function snapshotConversation() {
  try {
    // Check if html2canvas is available
    if (typeof html2canvas === 'undefined') {
      showToast('❌ Snapshot library not loaded. Please refresh the page.', 'error');
      return;
    }

    const conversationContainer = elements.conversationHistory;
    if (!conversationContainer) {
      showToast('❌ Conversation container not found', 'error');
      return;
    }

    // Check if there are messages
    const messageItems = conversationContainer.querySelectorAll('.message-item');
    const messageCount = messageItems.length;
    
    if (messageCount === 0) {
      showToast('⚠️ No conversation to snapshot', 'error');
      return;
    }

    spLog(`[Snapshot] Starting capture of ${messageCount} messages`);
    showToast(`📸 Capturing ${messageCount} messages...`, 'success');

    // Store original scroll position and styles
    const originalScrollTop = conversationContainer.scrollTop;
    const originalOverflow = conversationContainer.style.overflow;
    const originalHeight = conversationContainer.style.height;
    const originalMaxHeight = conversationContainer.style.maxHeight;
    
    // Temporarily remove overflow and height restrictions to capture full content
    conversationContainer.style.overflow = 'visible';
    conversationContainer.style.height = 'auto';
    conversationContainer.style.maxHeight = 'none';
    
    // Scroll to top to ensure we start from the beginning
    conversationContainer.scrollTop = 0;
    
    // Wait for scroll and layout to settle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Force multiple reflows to ensure all content is measured
    conversationContainer.offsetHeight;
    void conversationContainer.offsetWidth; // Force layout
    
    // Calculate actual content height by summing all message heights
    let calculatedHeight = 0;
    messageItems.forEach((msg, index) => {
      const msgHeight = msg.offsetHeight;
      const msgMargin = parseInt(getComputedStyle(msg).marginBottom) || 0;
      calculatedHeight += msgHeight + msgMargin;
      spLog(`[Snapshot] Message ${index + 1} height: ${msgHeight}px`);
    });
    
    // Get the full dimensions - use the larger of scrollHeight or calculated height
    const scrollHeight = conversationContainer.scrollHeight;
    const fullHeight = Math.max(scrollHeight, calculatedHeight + 20); // Add padding
    const containerWidth = conversationContainer.clientWidth;
    
    spLog(`[Snapshot] ScrollHeight: ${scrollHeight}px, Calculated: ${calculatedHeight}px, Using: ${fullHeight}px`);
    
    spLog(`[Snapshot] Container dimensions: ${containerWidth}x${fullHeight}px`);
    spLog(`[Snapshot] Message count: ${messageCount}`);
    
    // Get background from the container's parent or body
    const containerStyle = getComputedStyle(conversationContainer);
    const tabPage = conversationContainer.closest('.tab-page');
    const tabPageStyle = tabPage ? getComputedStyle(tabPage) : null;
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    
    // Try to get background color, prefer parent containers
    let bgColor = containerStyle.backgroundColor;
    if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
      bgColor = tabPageStyle ? tabPageStyle.backgroundColor : bodyStyle.backgroundColor;
    }
    if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
      bgColor = htmlStyle.backgroundColor;
    }
    // Fallback to theme-based solid colors (no transparency)
    if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
      bgColor = document.body.classList.contains('dark-theme') ? '#000000' : '#F2F2F7';
    }
    
    // Ensure we have a solid color (convert rgba with alpha to solid)
    if (bgColor.includes('rgba')) {
      const rgbaMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
      if (rgbaMatch) {
        const r = rgbaMatch[1];
        const g = rgbaMatch[2];
        const b = rgbaMatch[3];
        bgColor = `rgb(${r}, ${g}, ${b})`;
      }
    }
    
    spLog(`[Snapshot] Background color: ${bgColor}`);
    
    // Store theme info for use in onclone callback
    const isDarkTheme = document.body.classList.contains('dark-theme');
    
    // Configure html2canvas options for full conversation capture
    const options = {
      backgroundColor: bgColor,
      scale: 2, // Higher quality (2x)
      useCORS: true,
      logging: false,
      width: containerWidth,
      height: fullHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: containerWidth,
      windowHeight: fullHeight,
      allowTaint: false,
      removeContainer: false,
      onclone: (clonedDoc) => {
        // Ensure the cloned document has the same background and full height
        const clonedContainer = clonedDoc.querySelector('#conversation-history');
        if (clonedContainer) {
          clonedContainer.style.overflow = 'visible';
          clonedContainer.style.height = 'auto';
          clonedContainer.style.maxHeight = 'none';
          clonedContainer.style.minHeight = `${fullHeight}px`;
          clonedContainer.scrollTop = 0;
          
          // Ensure all message items are visible
          const clonedMessages = clonedContainer.querySelectorAll('.message-item');
          clonedMessages.forEach(msg => {
            msg.style.display = 'block';
            msg.style.visibility = 'visible';
          });
        }
        // Ensure body and parent containers have background
        const clonedBody = clonedDoc.body;
        if (clonedBody) {
          clonedBody.style.backgroundColor = bgColor;
        }
        const clonedTabPage = clonedDoc.querySelector('.tab-page');
        if (clonedTabPage) {
          clonedTabPage.style.backgroundColor = bgColor;
        }
      }
    };

    // Create a wrapper to center the content in the snapshot
    const wrapper = document.createElement('div');
    wrapper.id = 'snapshot-wrapper';
    wrapper.style.position = 'absolute';
    wrapper.style.left = '-9999px';
    wrapper.style.width = '800px'; // Fixed width for centered content
    wrapper.style.margin = '0 auto';
    wrapper.style.backgroundColor = bgColor;
    wrapper.style.padding = '20px';
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.display = 'flex';
    wrapper.style.justifyContent = 'center';
    
    // Clone the conversation container
    const clonedContainer = conversationContainer.cloneNode(true);
    clonedContainer.style.width = '100%';
    clonedContainer.style.maxWidth = '760px'; // 800 - 40px padding
    clonedContainer.style.margin = '0';
    clonedContainer.style.overflow = 'visible';
    clonedContainer.style.height = 'auto';
    clonedContainer.style.maxHeight = 'none';
    clonedContainer.style.backgroundColor = bgColor; // Ensure container has background
    clonedContainer.scrollTop = 0;
    
    wrapper.appendChild(clonedContainer);
    document.body.appendChild(wrapper);
    
    // Wait for layout
    await new Promise(resolve => setTimeout(resolve, 100));
    wrapper.offsetHeight; // Force reflow
    
    // Update options for the wrapper
    const wrapperHeight = clonedContainer.scrollHeight + 40; // Add padding
    const wrapperOptions = {
      backgroundColor: bgColor,
      scale: 2,
      useCORS: true,
      logging: false,
      width: 800,
      height: wrapperHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 800,
      windowHeight: wrapperHeight,
      allowTaint: false,
      removeContainer: false,
      onclone: (clonedDoc) => {
        // Ensure the cloned wrapper has proper styling
        const clonedWrapper = clonedDoc.querySelector('#snapshot-wrapper');
        if (clonedWrapper) {
          clonedWrapper.style.width = '800px';
          clonedWrapper.style.margin = '0 auto';
          clonedWrapper.style.backgroundColor = bgColor;
          clonedWrapper.style.padding = '20px';
          clonedWrapper.style.display = 'flex';
          clonedWrapper.style.justifyContent = 'center';
        }
        // Find the cloned conversation container (it's a direct child of wrapper)
        const clonedInnerContainer = clonedWrapper ? (clonedWrapper.querySelector('#conversation-history') || clonedWrapper.querySelector('.conversation-container') || clonedWrapper.firstElementChild) : null;
        if (clonedInnerContainer) {
          clonedInnerContainer.style.width = '100%';
          clonedInnerContainer.style.maxWidth = '760px';
          clonedInnerContainer.style.margin = '0';
          clonedInnerContainer.style.overflow = 'visible';
          clonedInnerContainer.style.height = 'auto';
          clonedInnerContainer.style.maxHeight = 'none';
          clonedInnerContainer.style.backgroundColor = bgColor; // Ensure container has background
          clonedInnerContainer.scrollTop = 0;
          
          // Ensure all message items are visible and have proper backgrounds
          const clonedMessages = clonedInnerContainer.querySelectorAll('.message-item');
          clonedMessages.forEach(msg => {
            msg.style.display = 'block';
            msg.style.visibility = 'visible';
            // Ensure message items maintain their background (don't override if already set)
            const msgBg = getComputedStyle(msg).backgroundColor;
            if (!msgBg || msgBg === 'rgba(0, 0, 0, 0)' || msgBg === 'transparent') {
              // If message has no background, give it a subtle one based on theme
              msg.style.backgroundColor = isDarkTheme 
                ? 'rgba(255, 255, 255, 0.05)' 
                : 'rgba(0, 0, 0, 0.02)';
            }
          });
        }
        // Ensure html and body have background
        const clonedHtml = clonedDoc.documentElement;
        if (clonedHtml) {
          clonedHtml.style.backgroundColor = bgColor;
        }
        const clonedBody = clonedDoc.body;
        if (clonedBody) {
          clonedBody.style.backgroundColor = bgColor;
          clonedBody.style.display = 'flex';
          clonedBody.style.justifyContent = 'center';
          clonedBody.style.alignItems = 'flex-start';
        }
        // Ensure all parent containers have background
        const clonedTabPage = clonedDoc.querySelector('.tab-page');
        if (clonedTabPage) {
          clonedTabPage.style.backgroundColor = bgColor;
        }
        const clonedContainer = clonedDoc.querySelector('.container');
        if (clonedContainer) {
          clonedContainer.style.backgroundColor = bgColor;
        }
      }
    };
    
    // Capture the wrapper
    spLog('[Snapshot] Starting html2canvas capture with centered wrapper...');
    const canvas = await html2canvas(wrapper, wrapperOptions);
    
    // Clean up wrapper
    document.body.removeChild(wrapper);
    
    spLog(`[Snapshot] Canvas created: ${canvas.width}x${canvas.height}px (centered)`);
    
    // Verify we captured content
    const canvasHeight = canvas.height;
    const expectedHeight = fullHeight * 2; // Account for scale factor
    const heightDiff = Math.abs(canvasHeight - expectedHeight);
    
    spLog(`[Snapshot] Canvas height: ${canvasHeight}px, Expected: ${expectedHeight}px, Diff: ${heightDiff}px`);
    
    if (canvasHeight < 100) {
      spWarn('[Snapshot] Canvas height seems too small, may not have captured all messages');
    } else if (heightDiff > 100) {
      spWarn(`[Snapshot] Height difference is significant (${heightDiff}px), some content may be missing`);
    } else {
      spLog('[Snapshot] Canvas height matches expected dimensions');
    }
    
    // Verify message count in canvas (rough check by checking if canvas is tall enough)
    const minExpectedHeight = messageCount * 50; // Rough estimate: 50px per message minimum
    if (canvasHeight < minExpectedHeight * 2) {
      spWarn(`[Snapshot] Canvas may be missing messages. Expected at least ${minExpectedHeight * 2}px for ${messageCount} messages`);
    }
    
    // Restore original scroll position and styles
    conversationContainer.scrollTop = originalScrollTop;
    conversationContainer.style.overflow = originalOverflow;
    conversationContainer.style.height = originalHeight;
    conversationContainer.style.maxHeight = originalMaxHeight;
    
    // Convert canvas to blob
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast('❌ Failed to create image', 'error');
        return;
      }

      const fileSize = (blob.size / 1024).toFixed(2);
      spLog(`[Snapshot] Image created: ${fileSize}KB`);

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.href = url;
      a.download = `ai-chat-bridge-snapshot-${timestamp}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`✅ Snapshot saved (${messageCount} messages, ${fileSize}KB)`, 'success');
    }, 'image/png', 0.95); // 95% quality

  } catch (error) {
    spError('[Side Panel] Failed to snapshot conversation:', error);
    showToast('❌ Failed to create snapshot: ' + error.message, 'error');
    
    // Restore original state on error
    if (elements.conversationHistory) {
      elements.conversationHistory.style.overflow = '';
    }
  }
}

async function downloadConversation() {
  try {
    // Get conversation history and state
    const [historyResponse, stateResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_CONVERSATION_HISTORY' }),
      chrome.runtime.sendMessage({ type: 'GET_STATE' })
    ]);

    const history = historyResponse.history || [];
    const state = stateResponse || {};
    const config = state.config || {};
    const initialPrompt = config.initialPrompt || '';
    const templateType = config.templateType || null;

    if (history.length === 0) {
      showToast('⚠️ No conversation to download', 'error');
      return;
    }

    // Build text content
    let content = 'AI Chat Bridge - Conversation Export\n';
    content += '='.repeat(50) + '\n\n';

    // Add topic/initial prompt at the top
    if (initialPrompt) {
      content += 'TOPIC / INITIAL PROMPT:\n';
      content += '-'.repeat(50) + '\n';
      content += initialPrompt + '\n\n';
      if (templateType) {
        content += `Template Type: ${templateType.toUpperCase()}\n\n`;
      }
      content += '='.repeat(50) + '\n\n';
    }

    // Add conversation messages
    content += 'CONVERSATION:\n';
    content += '='.repeat(50) + '\n\n';

    history.forEach((msg, index) => {
      const date = new Date(msg.timestamp);
      const dateStr = date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      content += `[${index + 1}] ${msg.role || `Participant ${msg.sessionNum}`} (${msg.platform || 'unknown'})\n`;
      content += `Time: ${dateStr}\n`;
      content += '-'.repeat(50) + '\n';
      content += msg.content + '\n\n';
    });

    // Create download
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.href = url;
    a.download = `ai-chat-bridge-conversation-${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('✅ Conversation downloaded', 'success');
  } catch (error) {
    spError('[Side Panel] Failed to download conversation:', error);
    showToast('❌ Failed to download', 'error');
  }
}

function updateHybridSettingsVisibility(mode) {
  const settingsDiv = document.getElementById('hybrid-timeout-settings');
  if (settingsDiv) {
    settingsDiv.style.display = (mode === 'hybrid') ? 'block' : 'none';
  }
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

// Check service worker status
async function checkServiceWorkerStatus() {
  try {
    // Try to ping the service worker
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
    return { available: true, response };
  } catch (error) {
    spWarn('[Side Panel] Service worker not responding:', error.message);
    return { available: false, error: error.message };
  }
}

// Store all logs for filtering
let allLogs = [];
let currentFilter = 'ALL'; // Current filter level: ALL, ERROR, WARN, INFO, DEBUG

const debugElements = {
  refreshLogs: document.getElementById('refresh-logs'),
  downloadLogs: document.getElementById('download-logs'),
  clearLogs: document.getElementById('clear-logs'),
  logContainer: document.getElementById('log-container'),
  logCount: document.getElementById('log-count'),
  filterButtons: document.querySelectorAll('.filter-btn')
};

// Debug panel is now handled by tab system

if (debugElements.refreshLogs) {
  debugElements.refreshLogs.addEventListener('click', refreshLogs);
}

if (debugElements.downloadLogs) {
  debugElements.downloadLogs.addEventListener('click', downloadLogs);
}

if (debugElements.clearLogs) {
  debugElements.clearLogs.addEventListener('click', clearLogs);
}

// Filter button event listeners
if (debugElements.filterButtons && debugElements.filterButtons.length > 0) {
  debugElements.filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons
      debugElements.filterButtons.forEach(b => b.classList.remove('active'));
      // Add active class to clicked button
      btn.classList.add('active');
      // Update current filter
      currentFilter = btn.dataset.filter;
      // Re-render logs with new filter
      renderFilteredLogs();
    });
  });
}

// Test log button
const testLogBtn = document.getElementById('test-log');
if (testLogBtn) {
  testLogBtn.addEventListener('click', async () => {
    try {
      spLog('[Side Panel] Creating test log...');

      // Check if extension is available
      if (!chrome.runtime || !chrome.runtime.id) {
        spError('[Side Panel] Extension runtime not available');
        showToast('❌ Extension runtime not available', 'error');
        return;
      }

      const testMessage = `Test log created at ${new Date().toISOString()}`;
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'ADD_LOG',
          entry: {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            source: 'SidePanel',
            message: testMessage
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            spError('[Side Panel] ADD_LOG error:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });

      spLog('[Side Panel] ADD_LOG response:', response);
      spLog('[Side Panel] Test log created, refreshing...');
      showToast('🧪 Test log created', 'success');
      // Wait a bit for log to be saved, then refresh
      setTimeout(() => {
        refreshLogs();
      }, 500);
    } catch (error) {
      spError('[Side Panel] Failed to create test log:', error);
      showToast('❌ Failed to create test log: ' + error.message, 'error');
    }
  });
}

async function refreshLogs() {
  try {
    spLog('[Side Panel] Refresh logs requested');

    // Check if extension is available
    if (!chrome.runtime || !chrome.runtime.id) {
      spError('[Side Panel] Extension runtime not available');
      debugElements.logContainer.innerHTML = `
        <div class="empty-state">
          <p>❌ Extension runtime not available</p>
        </div>
      `;
      debugElements.logCount.textContent = '0 logs';
      return;
    }

    // Check service worker status
    const swStatus = await checkServiceWorkerStatus();
    if (!swStatus.available) {
      spError('[Side Panel] Service worker not available:', swStatus.error);
      debugElements.logContainer.innerHTML = `
        <div class="empty-state">
          <p>❌ Service worker not responding</p>
          <p style="font-size: 0.9em; color: #888; margin-top: 0.5em;">
            Error: ${swStatus.error}<br/>
            Try: chrome://extensions → Reload extension
          </p>
        </div>
      `;
      debugElements.logCount.textContent = '0 logs';
      return;
    }
    spLog('[Side Panel] Service worker is available');

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (response) => {
        if (chrome.runtime.lastError) {
          spError('[Side Panel] GET_LOGS error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

    spLog('[Side Panel] GET_LOGS response:', response);

    if (!response) {
      spError('[Side Panel] No response from GET_LOGS');
      debugElements.logContainer.innerHTML = `
        <div class="empty-state">
          <p>❌ No response from extension. Service worker may not be running.</p>
          <p style="font-size: 0.9em; color: #888; margin-top: 0.5em;">
            Try: chrome://extensions → Reload extension → Check Service Worker
          </p>
        </div>
      `;
      debugElements.logCount.textContent = '0 logs';
      return;
    }

    allLogs = response.logs || [];
    spLog('[Side Panel] Logs received:', allLogs.length, 'entries');

    // Check storage usage
    let storageInfo = null;
    try {
      const storageResponse = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_STORAGE_USAGE' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });
      storageInfo = storageResponse;
      spLog('[Side Panel] Storage usage:', storageInfo);
    } catch (e) {
      spWarn('[Side Panel] Failed to get storage usage:', e);
    }

    // Render filtered logs
    renderFilteredLogs(storageInfo);

    showToast(`🔄 Loaded ${allLogs.length} logs`, 'success');
  } catch (error) {
    spError('[Side Panel] Failed to load logs:', error);
    showToast('❌ Failed to load logs', 'error');
  }
}

// Render logs with current filter
function renderFilteredLogs(storageInfo = null) {
  // Filter logs based on current filter
  let filteredLogs = allLogs;
  if (currentFilter !== 'ALL') {
    filteredLogs = allLogs.filter(log => log.level === currentFilter);
  }

  // Update log count
  const totalCount = allLogs.length;
  const filteredCount = filteredLogs.length;
  const countText = currentFilter === 'ALL'
    ? `${totalCount} logs`
    : `${filteredCount} of ${totalCount} logs (${currentFilter})`;
  debugElements.logCount.textContent = `${countText}${storageInfo ? ` (${storageInfo.usagePercent}% storage)` : ''}`;

  if (filteredLogs.length === 0) {
    let errorMsg = currentFilter === 'ALL'
      ? 'No logs yet. Service worker may not have started.'
      : `No ${currentFilter} logs found.`;
    if (storageInfo && parseFloat(storageInfo.usagePercent) > 90) {
      errorMsg = 'Storage may be full. Try clicking "Clear" to free up space.';
    }
    debugElements.logContainer.innerHTML = `
      <div class="empty-state">
        <p>${errorMsg}</p>
        ${currentFilter !== 'ALL' ? `<p style="font-size: 0.9em; color: #888; margin-top: 0.5em;">Try selecting "All" to see all logs.</p>` : ''}
        ${storageInfo ? `<p style="font-size: 0.9em; color: #888; margin-top: 0.5em;">Storage: ${storageInfo.usagePercent}% used (${(storageInfo.usage / 1024).toFixed(1)} KB / ${(storageInfo.quota / 1024).toFixed(1)} KB)</p>` : ''}
      </div>
    `;
    return;
  }

  // Show last 100 logs (most recent first)
  const recentLogs = filteredLogs.slice(-100).reverse();

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
}

async function downloadLogs() {
  try {
    spLog('[Side Panel] Download logs requested');

    // Check if extension is available
    if (!chrome.runtime || !chrome.runtime.id) {
      spError('[Side Panel] Extension runtime not available');
      showToast('❌ Extension runtime not available', 'error');
      return;
    }

    // Use filtered logs if available, otherwise fetch from background
    let logsToDownload = [];
    if (allLogs.length > 0) {
      // Use cached logs with current filter
      if (currentFilter === 'ALL') {
        logsToDownload = allLogs;
      } else {
        logsToDownload = allLogs.filter(log => log.level === currentFilter);
      }
    } else {
      // Fetch from background if not cached
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (response) => {
          if (chrome.runtime.lastError) {
            spError('[Side Panel] GET_LOGS error:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });

      if (!response) {
        spError('[Side Panel] No response from GET_LOGS');
        showToast('❌ No response from extension. Service worker may not be running.', 'error');
        return;
      }

      allLogs = response.logs || [];

      // Apply filter
      if (currentFilter === 'ALL') {
        logsToDownload = allLogs;
      } else {
        logsToDownload = allLogs.filter(log => log.level === currentFilter);
      }
    }

    spLog('[Side Panel] Logs to download:', logsToDownload.length, 'entries');

    if (logsToDownload.length === 0) {
      spWarn('[Side Panel] No logs to download');
      showToast(`⚠️ No ${currentFilter === 'ALL' ? '' : currentFilter + ' '}logs to download. Try clicking "Refresh" first.`, 'error');
      return;
    }

    // Format logs as text
    const lines = logsToDownload.map(log =>
      `[${log.timestamp}] [${log.level}] [${log.source}] ${log.message}`
    );
    const content = lines.join('\n');
    spLog('[Side Panel] Formatted log content length:', content.length);

    // Create download filename with filter info
    const filterSuffix = currentFilter === 'ALL' ? '' : `-${currentFilter}`;
    const filename = `ai-bridge-logs${filterSuffix}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    spLog('[Side Panel] Download completed:', filename);
    showToast(`📥 Downloaded ${filename} (${logsToDownload.length} ${currentFilter === 'ALL' ? 'logs' : currentFilter + ' logs'})`, 'success');
  } catch (error) {
    spError('[Side Panel] Failed to download logs:', error);
    showToast('❌ Failed to download: ' + error.message, 'error');
  }
}

async function clearLogs() {
  if (!confirm('Clear all debug logs?')) return;

  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    // Clear cached logs
    allLogs = [];
    // Reset filter to ALL
    currentFilter = 'ALL';
    debugElements.filterButtons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.filter === 'ALL') {
        btn.classList.add('active');
      }
    });
    // Clear display
    debugElements.logContainer.innerHTML = `
      <div class="empty-state">
        <p>Logs cleared</p>
      </div>
    `;
    debugElements.logCount.textContent = '0 logs';
    showToast('🗑️ Logs cleared', 'success');
  } catch (error) {
    spError('[Side Panel] Failed to clear logs:', error);
    showToast('❌ Failed to clear logs', 'error');
  }
}

// ============================================
// SWAP AGENTS
// ============================================

async function swapAgents() {
  const btn = document.getElementById('swap-agents-btn');
  if (btn) btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'SWAP_AGENTS' });

    if (response && response.success) {
      showToast('⇄ Agents swapped!', 'success');
      // Reload state
      setTimeout(() => {
        loadStateOnly();
      }, 500);
    } else {
      showToast('❌ Failed to swap', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Swap error:', error);
    showToast('❌ Failed to swap agents', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================
// AVAILABLE AGENTS MANAGEMENT
// ============================================

async function loadAvailableAgents() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_AVAILABLE_AGENTS' });
    if (response && response.success) {
      renderAvailableAgents(response.agents);
    }
  } catch (error) {
    spError('[Side Panel] Failed to load available agents:', error);
  }
}

// Update agent selectors with available agents
function updateAgentSelectors() {
  // Get all selectors dynamically (they're created in renderParticipants)
  const selectors = document.querySelectorAll('.agent-selector');

  if (selectors.length === 0) return;

  // Get current state to know which agents are already assigned
  chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(state => {
    // Always use GET_AVAILABLE_AGENTS to get agents from pool
    chrome.runtime.sendMessage({ type: 'GET_AVAILABLE_AGENTS' }).then(availResponse => {
      if (availResponse && availResponse.success) {
        const participants = state?.participants || [];
        const assignedTabIds = participants.map(p => p.tabId).filter(Boolean);

        // Update each selector
        selectors.forEach(selector => {
          const position = parseInt(selector.dataset.position);
          // For empty slots (when position > participants.length), currentTabId is null
          const participant = participants[position - 1];
          const currentTabId = participant?.tabId || null;
          updateSelector(selector, availResponse.agents, currentTabId, assignedTabIds);
        });
      } else {
        spError('[Side Panel] Failed to get available agents for selectors');
      }
    }).catch(error => {
      spError('[Side Panel] Error getting available agents:', error);
    });
  }).catch(error => {
    spError('[Side Panel] Error getting state:', error);
  });
}

function updateSelector(selector, agents, currentTabId, assignedTabIds) {
  if (!selector) return;

  const platformIconsMap = {
    gemini: '✨',
    chatgpt: '🤖',
    deepseek: '🔍',
    duckduckgo: '🦆',
    unknown: '❓'
  };

  // Clear and add default option
  selector.innerHTML = '<option value="">Select agent...</option>';

  // Add available agents
  agents.forEach(agent => {
    if (assignedTabIds.includes(agent.tabId) && agent.tabId !== currentTabId) {
      return; // Skip if assigned to other slot
    }

    const icon = platformIconsMap[agent.platform] || platformIconsMap.unknown;
    const title = agent.title || `${agent.platform} Chat`;
    const option = document.createElement('option');
    option.value = agent.tabId;
    option.textContent = `${icon} ${title} (${agent.platform})`;
    option.selected = agent.tabId === currentTabId;
    selector.appendChild(option);
  });

  // Enable/disable based on whether agent is selected
  selector.disabled = !!currentTabId;
}

function renderAvailableAgents(agents) {
  const listContainer = document.getElementById('available-agents-list');
  if (!listContainer) return;

  // Also update selectors when agents list changes
  updateAgentSelectors();

  if (!agents || agents.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <p>No agents available</p>
        <p class="empty-hint">Open chat tabs (ChatGPT, Gemini, etc.) to see them here</p>
      </div>
    `;
    return;
  }

  const platformIconsMap = {
    gemini: '✨',
    chatgpt: '🤖',
    deepseek: '🔍',
    duckduckgo: '🦆',
    zai: '⚡',
    kimi: '🌟',
    youcom: '💬',
    qwen: '🔮',
    unknown: '❓'
  };

  listContainer.innerHTML = agents.map(agent => {
    const icon = platformIconsMap[agent.platform] || platformIconsMap.unknown;
    const platformName = agent.platform ? agent.platform.charAt(0).toUpperCase() + agent.platform.slice(1) : 'Unknown';
    const title = agent.title || `${platformName} Chat`;
    
    // Check availability
    const availability = agent.availability || { available: true, reason: null, requiresLogin: false };
    const isAvailable = availability.available !== false;
    const warningReason = availability.reason || null;
    const requiresLogin = availability.requiresLogin || false;
    const isDeepthink = availability.deepthink || false;

    return `
      <div class="available-agent-item ${isAvailable ? '' : 'unavailable'}" data-tab-id="${agent.tabId}">
        <div class="agent-info">
          <span class="agent-icon">${icon}</span>
          <div class="agent-details">
            <div class="agent-title">
              ${escapeHtml(title)}
              ${!isAvailable ? '<span class="availability-warning" title="' + escapeHtml(warningReason || 'Not available') + '">⚠️</span>' : ''}
              ${isDeepthink ? '<span class="deepthink-warning" title="DeepThink mode active - responses may take 5-10 minutes">🧠</span>' : ''}
            </div>
            <div class="agent-platform">${platformName}</div>
            ${!isAvailable && warningReason ? `<div class="agent-warning-text">${escapeHtml(warningReason)}</div>` : ''}
            ${isDeepthink ? `<div class="agent-warning-text deepthink-text">🧠 DeepThink mode: Extended timeout (10 min)</div>` : ''}
          </div>
        </div>
        <div class="agent-actions">
          <button class="btn-remove" data-tab-id="${agent.tabId}" title="Remove from pool">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  listContainer.querySelectorAll('.available-agent-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      // Ignore if clicked on remove button
      if (e.target.closest('.btn-remove')) return;

      const tabId = parseInt(item.dataset.tabId);
      spLog('[Side Panel] Clicked agent:', tabId);

      try {
        // Get current state to count existing participants
        const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        const participants = state.participants || [];
        
        // Filter to only count participants with actual agents
        const validParticipants = participants.filter(p => p && p.tabId && p.tabId !== null);
        
        // Add agent to the next position (no empty slots needed)
        const targetPosition = validParticipants.length + 1;
        spLog('[Side Panel] Assigning agent', tabId, 'to position', targetPosition);
        await assignAgentToSlot(tabId, targetPosition);

      } catch (error) {
        spError('[Side Panel] Failed to auto-assign agent:', error);
        showToast('❌ Failed to add agent', 'error');
      }
    });
  });

  listContainer.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent item click
      const tabId = parseInt(btn.dataset.tabId);
      await removeAgentFromPool(tabId);
    });
  });
}

// Lock to prevent double-submission
let isAssigning = false;
let currentAssigningTabId = null;

// Enable/disable all agent items
function setAgentItemsDisabled(disabled, assigningTabId = null) {
  const listContainer = document.getElementById('available-agents-list');
  if (!listContainer) return;
  
  const items = listContainer.querySelectorAll('.available-agent-item');
  items.forEach(item => {
    if (disabled) {
      item.classList.add('disabled');
      // If this is the specific item being assigned, add assigning class too
      if (assigningTabId) {
        const tabId = parseInt(item.dataset.tabId);
        if (tabId === assigningTabId) {
          item.classList.add('assigning');
        }
      }
    } else {
      item.classList.remove('disabled', 'assigning');
    }
  });
}

async function assignAgentToSlot(tabId, position) {
  if (isAssigning) return;

  if (!tabId) {
    // If tabId is empty, release the slot
    await releaseAgentFromSlot(position);
    return;
  }

  try {
    isAssigning = true;
    currentAssigningTabId = parseInt(tabId);
    // Disable all agent items during assignment
    setAgentItemsDisabled(true, currentAssigningTabId);
    
    const response = await chrome.runtime.sendMessage({
      type: 'ASSIGN_AGENT_TO_SLOT',
      tabId: parseInt(tabId),
      position: position
    });

    if (response && response.success) {
      showToast(`✅ Agent assigned to position ${position}`, 'success');
      // Reload state (agents list is updated via AVAILABLE_AGENTS_UPDATE broadcast)
      setTimeout(() => {
        loadStateOnly();
      }, 500);
    } else {
      showToast('❌ Failed to assign agent', 'error');
      // Reset selector
      updateAgentSelectors();
    }
  } catch (error) {
    spError('[Side Panel] Assign error:', error);
    showToast('❌ Failed to assign agent', 'error');
    // Reset selector
    updateAgentSelectors();
  } finally {
    isAssigning = false;
    currentAssigningTabId = null;
    // Re-enable agent items after assignment completes
    setAgentItemsDisabled(false);
  }
}

async function removeAgentFromPool(tabId) {
  if (!confirm('Remove this agent from the pool?')) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'REMOVE_AGENT_FROM_POOL',
      tabId: tabId
    });

    if (response && response.success) {
      showToast('🗑️ Agent removed', 'success');
      loadAvailableAgents();
    } else {
      showToast('❌ Failed to remove agent', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Remove error:', error);
    showToast('❌ Failed to remove agent', 'error');
  }
}

async function releaseAgentFromSlot(position) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'REMOVE_PARTICIPANT',
      position: position
    });

    if (response && response.success) {
      showToast(`✅ Participant ${position} released`, 'success');
      // Reload state and agents after a short delay to ensure storage is updated
      setTimeout(() => {
        loadStateOnly();
        loadAvailableAgents();
      }, 300);
    } else {
      showToast('❌ Failed to release agent', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Release error:', error);
    showToast('❌ Failed to release agent', 'error');
  }
}

// ============================================
// AUTO-OPEN REGISTERED URLS MANAGEMENT
// ============================================

async function loadRegisteredUrls() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_REGISTERED_URLS' });
    if (response && response.success) {
      renderSupportedPlatforms(response.supportedPlatforms || [], response.selectedPlatforms || []);
      
      // Update settings checkboxes
      const autoOpenOnStart = document.getElementById('auto-open-on-start');
      const autoOpenEmptyTabs = document.getElementById('auto-open-empty-tabs');
      
      if (autoOpenOnStart && response.settings) {
        autoOpenOnStart.checked = response.settings.openOnBrowserStart || false;
      }
      if (autoOpenEmptyTabs && response.settings) {
        autoOpenEmptyTabs.checked = response.settings.openInEmptyTabs || false;
      }
    }
  } catch (error) {
    spError('[Side Panel] Failed to load platforms:', error);
  }
}

function renderSupportedPlatforms(platforms, selectedUrls) {
  const listContainer = document.getElementById('supported-platforms-list');
  if (!listContainer) return;

  if (!platforms || platforms.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <p>No supported platforms found</p>
      </div>
    `;
    return;
  }

  const selectedUrlsSet = new Set(selectedUrls);

  listContainer.innerHTML = platforms.map(platform => {
    const isSelected = selectedUrlsSet.has(platform.url);
    const displayUrl = platform.url.length > 60 ? platform.url.substring(0, 60) + '...' : platform.url;

    return `
      <label class="platform-checkbox-item" data-url="${escapeHtml(platform.url)}">
        <input type="checkbox" class="platform-checkbox" ${isSelected ? 'checked' : ''} data-url="${escapeHtml(platform.url)}">
        <div class="platform-info">
          <span class="platform-icon">${platform.icon || '❓'}</span>
          <div class="platform-details">
            <div class="platform-name">${escapeHtml(platform.name)}</div>
            <div class="platform-url" title="${escapeHtml(platform.url)}">${escapeHtml(displayUrl)}</div>
          </div>
        </div>
      </label>
    `;
  }).join('');

  // Attach event listeners
  listContainer.querySelectorAll('.platform-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      await updateSelectedPlatforms();
    });
  });
}

async function updateSelectedPlatforms() {
  const checkboxes = document.querySelectorAll('.platform-checkbox');
  const selectedUrls = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.url);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_SELECTED_PLATFORMS',
      urls: selectedUrls
    });

    if (response && response.success) {
      showToast(`✅ ${selectedUrls.length} platform(s) selected`, 'success');
    } else {
      showToast('❌ Failed to save selection', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Failed to update selected platforms:', error);
    showToast('❌ Failed to save selection', 'error');
  }
}

async function updateAutoOpenSettings(settings) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_AUTO_OPEN_SETTINGS',
      settings: settings
    });

    if (response && response.success) {
      showToast('✅ Settings saved', 'success');
    } else {
      showToast('❌ Failed to save settings', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Failed to update auto-open settings:', error);
    showToast('❌ Failed to save settings', 'error');
  }
}

async function openSelectedPlatforms() {
  const openSelectedPlatformsBtn = document.getElementById('open-selected-platforms-btn');
  try {
    if (openSelectedPlatformsBtn) {
      openSelectedPlatformsBtn.disabled = true;
      openSelectedPlatformsBtn.innerHTML = '<svg class="btn-icon w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Opening...';
    }

    const response = await chrome.runtime.sendMessage({
      type: 'OPEN_SELECTED_PLATFORMS',
      context: 'manual'
    });

    if (response && response.success) {
      showToast(`✅ Opened ${response.opened || 0} platform(s)`, 'success');
    } else {
      showToast('❌ Failed to open platforms', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Failed to open selected platforms:', error);
    showToast('❌ Failed to open platforms', 'error');
  } finally {
    setTimeout(() => {
      if (openSelectedPlatformsBtn) {
        openSelectedPlatformsBtn.disabled = false;
        openSelectedPlatformsBtn.innerHTML = '<svg class="btn-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg> Open Selected Now';
      }
    }, 1000);
  }
}

async function openInEmptyTabs() {
  const openInEmptyTabsBtn = document.getElementById('open-in-empty-tabs-btn');
  try {
    if (openInEmptyTabsBtn) {
      openInEmptyTabsBtn.disabled = true;
      openInEmptyTabsBtn.innerHTML = '<svg class="btn-icon w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Opening...';
    }

    const response = await chrome.runtime.sendMessage({
      type: 'OPEN_IN_EMPTY_TABS'
    });

    if (response && response.success) {
      if (response.message) {
        showToast(`ℹ️ ${response.message}`, 'success');
      } else {
        showToast(`✅ Opened ${response.opened || 0} URLs in empty tabs`, 'success');
      }
    } else {
      showToast('❌ Failed to open URLs', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Failed to open in empty tabs:', error);
    showToast('❌ Failed to open URLs', 'error');
  } finally {
    setTimeout(() => {
      if (openInEmptyTabsBtn) {
        openInEmptyTabsBtn.disabled = false;
        openInEmptyTabsBtn.innerHTML = '<svg class="btn-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg> Open in Empty Tabs';
      }
    }, 1000);
  }
}

