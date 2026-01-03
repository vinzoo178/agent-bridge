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
  }).catch(() => {});
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
  saveConfig: document.getElementById('save-config'),
  topicInput: document.getElementById('topic-input'),
  initialPrompt: document.getElementById('initial-prompt'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  conversationHistory: document.getElementById('conversation-history'),
  messageCount: document.getElementById('message-count'),
  clearHistory: document.getElementById('clear-history'),
  autoScroll: document.getElementById('auto-scroll'),
  turnIndicator: document.getElementById('turn-indicator'),
  backendStatus: document.getElementById('backend-status'),
  backendIndicator: document.getElementById('backend-indicator'),
  backendLabel: document.getElementById('backend-label')
};

// Track selected template (default: debate)
let selectedTemplate = 'debate';

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

  // Poll for state updates (but not config)
  statePollingInterval = setInterval(loadStateOnly, 2000);

  // Load backend status
  loadBackendStatus();
  setInterval(loadBackendStatus, 3000); // Check every 3 seconds
});

function initializeUI() {
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = true;

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

  // Save config
  elements.saveConfig.addEventListener('click', saveConfiguration);

  // Start/Stop buttons
  elements.startBtn.addEventListener('click', startConversation);
  elements.stopBtn.addEventListener('click', stopConversation);

  // Clear history
  elements.clearHistory.addEventListener('click', clearHistory);

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
        }, 1000);
      } catch (error) {
        spError('[Side Panel] Refresh error:', error);
        showToast('❌ Failed to refresh', 'error');
      }
    });
  }

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

  // Ensure we have at least 2 slots (fill with placeholders if needed)
  const displayParticipants = [...participants];
  while (displayParticipants.length < 2) {
    displayParticipants.push({
      tabId: null,
      connected: false,
      role: `Participant ${displayParticipants.length + 1}`,
      order: displayParticipants.length + 1
    });
  }

  // Render each participant (including empty/virtual slots)
  displayParticipants.forEach((participant, index) => {
    const hasAgent = participant.tabId && participant.tabId !== null;
    const connected = participant.connected && hasAgent;
    const platform = participant.platform || null;
    const position = participant.order || index + 1;

    const card = document.createElement('div');
    card.className = `participant-card ${connected ? 'connected' : ''}`;
    card.dataset.position = position;
    card.dataset.tabId = participant.tabId || '';

    const icon = connected && platform ? (platformIcons[platform] || platformIcons.unknown) : '';
    const platformName = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Not connected';

    card.innerHTML = `
      <div class="participant-header">
        <div class="participant-order">
          <span class="order-number">${position}</span>
        </div>
        <span class="participant-label">${connected && platform ? platformName : `Position ${position}`}</span>
        <span class="session-status ${connected ? 'connected' : 'disconnected'}">${connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <div class="participant-content">
        <div class="session-platform">
          ${connected && platform ? icon : '<svg class="platform-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6"></path></svg>'}
          <span>${connected && platform ? platformName : 'Not connected'}</span>
        </div>
        <div class="participant-actions">
          <select class="agent-selector" data-position="${position}" ${connected ? 'disabled' : ''}>
            <option value="">Select agent...</option>
          </select>
          <button class="btn-release" data-position="${position}" style="display:${connected ? 'flex' : 'none'};" title="Remove from conversation">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);

    // Add arrow between participants (except after last)
    if (index < displayParticipants.length - 1) {
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
    contextMessages: parseInt(elements.contextMessages.value) || 4
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
  elements.startBtn.innerHTML = '<svg class="btn-icon w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Starting...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_CONVERSATION',
      initialPrompt: initialPrompt
    });

    if (response.success) {
      showToast('🚀 Conversation started!', 'success');
      // Clear input after starting
      elements.topicInput.value = '';
    } else {
      showToast('❌ ' + (response.error || 'Failed to start'), 'error');
    }
  } catch (error) {
    spError('[Side Panel] Failed to start:', error);
    showToast('❌ Failed to start', 'error');
  }

  // Reset button
  setTimeout(() => {
    elements.startBtn.innerHTML = '<svg class="btn-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Send';
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
    unknown: '❓'
  };

  listContainer.innerHTML = agents.map(agent => {
    const icon = platformIconsMap[agent.platform] || platformIconsMap.unknown;
    const platformName = agent.platform ? agent.platform.charAt(0).toUpperCase() + agent.platform.slice(1) : 'Unknown';
    const title = agent.title || `${platformName} Chat`;

    return `
      <div class="available-agent-item" data-tab-id="${agent.tabId}">
        <div class="agent-info">
          <span class="agent-icon">${icon}</span>
          <div class="agent-details">
            <div class="agent-title">${escapeHtml(title)}</div>
            <div class="agent-platform">${platformName}</div>
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
        // Get current state to find an empty slot
        const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        const participants = state.participants || [];

        let targetPosition = -1;

        // 1. Look for first empty slot (no tabId)
        for (let i = 0; i < participants.length; i++) {
          if (!participants[i].tabId) {
            targetPosition = participants[i].order || (i + 1);
            break;
          }
        }

        // 2. If no empty slot, add a new one
        if (targetPosition === -1) {
          spLog('[Side Panel] No empty slot, creating new one...');
          const newPos = participants.length + 1;
          // Add empty participant first
          await chrome.runtime.sendMessage({
            type: 'ADD_EMPTY_PARTICIPANT',
            position: newPos
          });
          targetPosition = newPos;
          // Wait a tiny bit for state update to propagate internally in background
          await new Promise(r => setTimeout(r, 100));
        }

        // 3. Assign agent to the slot
        spLog('[Side Panel] Assigning agent', tabId, 'to position', targetPosition);
        assignAgentToSlot(tabId, targetPosition);

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

async function assignAgentToSlot(tabId, position) {
  if (isAssigning) return;

  if (!tabId) {
    // If tabId is empty, release the slot
    await releaseAgentFromSlot(position);
    return;
  }

  try {
    isAssigning = true;
    const response = await chrome.runtime.sendMessage({
      type: 'ASSIGN_AGENT_TO_SLOT',
      tabId: parseInt(tabId),
      position: position
    });

    if (response && response.success) {
      showToast(`✅ Agent assigned to position ${position}`, 'success');
      // Reload state and agents
      setTimeout(() => {
        loadStateOnly();
        loadAvailableAgents();
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
      // Reload state and agents
      setTimeout(() => {
        loadStateOnly();
        loadAvailableAgents();
      }, 500);
      // Reload state and agents
      setTimeout(() => {
        loadStateOnly();
        loadAvailableAgents();
      }, 500);
    } else {
      showToast('❌ Failed to release agent', 'error');
    }
  } catch (error) {
    spError('[Side Panel] Release error:', error);
    showToast('❌ Failed to release agent', 'error');
  }
}

