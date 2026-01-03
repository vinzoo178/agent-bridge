// AI Chat Bridge - Popup Script
// Control panel for managing AI chat sessions

// DOM Elements
const elements = {
  globalStatus: document.getElementById('global-status'),
  session1Card: document.getElementById('session1-card'),
  session1Status: document.getElementById('session1-status'),
  session1Platform: document.getElementById('session1-platform'),
  session2Card: document.getElementById('session2-card'),
  session2Status: document.getElementById('session2-status'),
  session2Platform: document.getElementById('session2-platform'),
  maxLength: document.getElementById('max-length'),
  replyDelay: document.getElementById('reply-delay'),
  maxTurns: document.getElementById('max-turns'),
  saveConfig: document.getElementById('save-config'),
  initialPrompt: document.getElementById('initial-prompt'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  conversationHistory: document.getElementById('conversation-history'),
  messageCount: document.getElementById('message-count'),
  clearHistory: document.getElementById('clear-history')
};

// Templates for initial prompts
const promptTemplates = {
  debate: `You are participating in a philosophical debate with another AI. The topic is: "Is consciousness unique to biological beings, or can artificial intelligence truly be conscious?"

Start by stating your position clearly in 2-3 sentences. Then provide one strong argument supporting your view. Keep your response concise (under 300 characters).

Remember: You're having a conversation, so respond to what the other participant says while adding new points.`,
  
  story: `Let's create a collaborative story together! You are a storyteller working with another AI to write an exciting adventure.

The setting: A mysterious floating city in the clouds, year 3025.

Add 2-3 sentences to continue the story, building on what came before. Be creative but keep your contribution short so the other storyteller can continue.

Start with: "The first thing Maya noticed when she woke up was..."`,
  
  qa: `You are a curious AI interviewing another AI about its perspective on technology and the future.

Ask one thoughtful, open-ended question about AI capabilities, ethics, or the future of human-AI collaboration.

Keep your question concise and thought-provoking. After receiving an answer, provide a brief comment and ask a follow-up question.`,
  
  brainstorm: `Let's brainstorm innovative solutions together! The challenge is:

"How might we make education more accessible and engaging for students in remote areas with limited internet connectivity?"

Share ONE creative idea in 2-3 sentences, explaining how it would work. Build on or combine ideas from the previous response. Keep it concise and practical.`
};

// Platform icons
const platformIcons = {
  gemini: '✨',
  chatgpt: '🤖',
  unknown: '❓'
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeUI();
  loadState();
  setupEventListeners();
});

function initializeUI() {
  // Set initial values
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = true;
}

async function loadState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    updateUI(response);
    
    // Load conversation history
    const historyResponse = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATION_HISTORY' });
    if (historyResponse.history) {
      renderConversationHistory(historyResponse.history);
    }
    
    // Load saved config
    const configData = await chrome.storage.local.get(['config']);
    if (configData.config) {
      elements.maxLength.value = configData.config.maxMessageLength || 500;
      elements.replyDelay.value = configData.config.autoReplyDelay || 2000;
      elements.maxTurns.value = configData.config.maxTurns || 50;
      
      if (configData.config.initialPrompt) {
        elements.initialPrompt.value = configData.config.initialPrompt;
      }
    }
  } catch (error) {
    console.error('Failed to load state:', error);
  }
}

function setupEventListeners() {
  // Template buttons
  document.querySelectorAll('.template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = btn.dataset.template;
      if (promptTemplates[template]) {
        elements.initialPrompt.value = promptTemplates[template];
        showToast('Template loaded!', 'success');
      }
    });
  });
  
  // Save config
  elements.saveConfig.addEventListener('click', saveConfiguration);
  
  // Start/Stop buttons
  elements.startBtn.addEventListener('click', startConversation);
  elements.stopBtn.addEventListener('click', stopConversation);
  
  // Clear history
  elements.clearHistory.addEventListener('click', clearHistory);
  
  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'STATE_UPDATE':
        updateUI(message.state);
        break;
      case 'NEW_MESSAGE':
        renderConversationHistory(message.history);
        break;
      case 'CONVERSATION_CLEARED':
        renderConversationHistory([]);
        break;
    }
    sendResponse({ received: true });
  });
}

function updateUI(state) {
  if (!state) return;
  
  // Update global status
  const isActive = state.isActive;
  elements.globalStatus.className = `status-badge ${isActive ? 'active' : ''}`;
  elements.globalStatus.querySelector('.status-label').textContent = isActive ? 'Active' : 'Inactive';
  
  // Update session 1
  updateSessionCard(
    elements.session1Card,
    elements.session1Status,
    elements.session1Platform,
    state.session1.connected,
    state.session1.platform
  );
  
  // Update session 2
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
    maxMessageLength: parseInt(elements.maxLength.value) || 500,
    autoReplyDelay: parseInt(elements.replyDelay.value) || 2000,
    maxTurns: parseInt(elements.maxTurns.value) || 50
  };
  
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: config
    });
    
    showToast('Configuration saved!', 'success');
  } catch (error) {
    console.error('Failed to save config:', error);
    showToast('Failed to save configuration', 'error');
  }
}

async function startConversation() {
  const initialPrompt = elements.initialPrompt.value.trim();
  
  if (!initialPrompt) {
    showToast('Please enter an initial prompt', 'error');
    return;
  }
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_CONVERSATION',
      initialPrompt: initialPrompt
    });
    
    if (response.success) {
      showToast('Conversation started!', 'success');
    } else {
      showToast(response.error || 'Failed to start conversation', 'error');
    }
  } catch (error) {
    console.error('Failed to start conversation:', error);
    showToast('Failed to start conversation', 'error');
  }
}

async function stopConversation() {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_CONVERSATION' });
    showToast('Conversation stopped', 'success');
  } catch (error) {
    console.error('Failed to stop conversation:', error);
    showToast('Failed to stop conversation', 'error');
  }
}

async function clearHistory() {
  if (!confirm('Are you sure you want to clear the conversation history?')) {
    return;
  }
  
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    showToast('History cleared', 'success');
  } catch (error) {
    console.error('Failed to clear history:', error);
    showToast('Failed to clear history', 'error');
  }
}

function renderConversationHistory(history) {
  if (!history || history.length === 0) {
    elements.conversationHistory.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💭</span>
        <p>No messages yet. Start a conversation!</p>
      </div>
    `;
    elements.messageCount.textContent = '0';
    return;
  }
  
  elements.messageCount.textContent = history.length;
  
  elements.conversationHistory.innerHTML = history.map(msg => {
    const agentClass = msg.sessionNum === 1 ? 'agent-a' : 'agent-b';
    return `
      <div class="message-item ${agentClass}">
        <div class="message-meta">
          <span class="message-role">${escapeHtml(msg.role)}</span>
          <span class="message-platform">${escapeHtml(msg.platform || 'unknown')}</span>
        </div>
        <div class="message-text">${escapeHtml(msg.content)}</div>
      </div>
    `;
  }).join('');
  
  // Scroll to bottom
  elements.conversationHistory.scrollTop = elements.conversationHistory.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  // Remove existing toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // Create new toast
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Auto remove
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

