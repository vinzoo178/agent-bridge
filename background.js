// AI Chat Bridge - Background Service Worker
// Manages communication between two AI chat sessions

const state = {
  isActive: false,
  session1: { tabId: null, role: 'Agent A', platform: null },
  session2: { tabId: null, role: 'Agent B', platform: null },
  currentTurn: 1, // Which session should respond next
  conversationHistory: [],
  config: {
    autoReplyDelay: 2000, // Delay before auto-reply (ms)
    maxTurns: 50, // Maximum conversation turns
    contextMessages: 4, // Number of recent messages to include as context
    initialPrompt: ''
  }
};

// ============================================
// CENTRALIZED LOGGING
// ============================================
const debugLogs = [];
const MAX_LOGS = 1000;

function addLog(source, level, message) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level,
    source: source,
    message: message
  };
  
  debugLogs.push(entry);
  
  // Trim if too many
  if (debugLogs.length > MAX_LOGS) {
    debugLogs.splice(0, debugLogs.length - MAX_LOGS);
  }
  
  // Also console log
  const prefix = `[${source}]`;
  if (level === 'ERROR') {
    console.error(prefix, message);
  } else if (level === 'WARN') {
    console.warn(prefix, message);
  } else {
    console.log(prefix, message);
  }
}

function bgLog(...args) {
  addLog('Background', 'INFO', args.join(' '));
}

function bgError(...args) {
  addLog('Background', 'ERROR', args.join(' '));
}

// Initialize storage and side panel
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    conversationHistory: [],
    config: state.config,
    isActive: false
  });
  console.log('AI Chat Bridge installed');
});

// Open side panel when clicking extension icon
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    console.log('Side panel opened');
  } catch (error) {
    console.error('Failed to open side panel:', error);
  }
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'REGISTER_SESSION':
      console.log('[Background] REGISTER_SESSION request, sender.tab:', sender.tab);
      if (!sender.tab || !sender.tab.id) {
        console.error('[Background] ERROR: No tab ID in sender!');
        return { success: false, error: 'No tab ID' };
      }
      return registerSession(message.sessionNum, sender.tab.id, message.platform);
    
    case 'UNREGISTER_SESSION':
      return unregisterSession(message.sessionNum);
    
    case 'AI_RESPONSE_RECEIVED':
      return handleAIResponse(message.response, message.sessionNum);
    
    case 'START_CONVERSATION':
      return startConversation(message.initialPrompt);
    
    case 'STOP_CONVERSATION':
      return stopConversation();
    
    case 'GET_STATE':
      return getStateWithTabIds();
    
    case 'UPDATE_CONFIG':
      return updateConfig(message.config);
    
    case 'GET_CONVERSATION_HISTORY':
      return getConversationHistory();
    
    case 'CLEAR_HISTORY':
      return clearHistory();
    
    case 'SEND_TO_SESSION':
      return sendMessageToSession(message.sessionNum, message.text);
    
    case 'GET_CURRENT_TAB_ID':
      return { tabId: sender.tab?.id || null };
    
    case 'CHECK_TAB_REGISTRATION':
      bgLog('CHECK_TAB_REGISTRATION from tab:', sender.tab?.id);
      return checkTabRegistration(sender.tab?.id);
    
    // ============================================
    // LOGGING MESSAGES
    // ============================================
    case 'ADD_LOG':
      if (message.entry) {
        debugLogs.push(message.entry);
        if (debugLogs.length > MAX_LOGS) {
          debugLogs.splice(0, debugLogs.length - MAX_LOGS);
        }
      }
      return { success: true };
    
    case 'GET_LOGS':
      return { logs: debugLogs };
    
    case 'CLEAR_LOGS':
      debugLogs.length = 0;
      return { success: true };
    
    default:
      return { error: 'Unknown message type' };
  }
}

async function registerSession(sessionNum, tabId, platform) {
  bgLog('====== REGISTER SESSION ======');
  bgLog('Session:', sessionNum, 'TabId:', tabId, 'Platform:', platform);
  
  const sessionKey = sessionNum === 1 ? 'session1' : 'session2';
  state[sessionKey].tabId = tabId;
  state[sessionKey].platform = platform;
  
  // Save to storage for persistence
  const registrationData = {};
  registrationData[`session${sessionNum}_tabId`] = tabId;
  registrationData[`session${sessionNum}_platform`] = platform;
  await chrome.storage.local.set(registrationData);
  
  bgLog('State after registration:');
  bgLog('Session 1:', JSON.stringify(state.session1));
  bgLog('Session 2:', JSON.stringify(state.session2));
  
  // Notify popup about state change
  broadcastStateUpdate();
  
  // Also notify the specific tab to update its UI
  // Retry a few times in case content script isn't ready yet
  let retries = 3;
  while (retries > 0) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'REGISTRATION_CONFIRMED',
        sessionNum: sessionNum,
        platform: platform
      });
      bgLog('REGISTRATION_CONFIRMED sent successfully to tab:', tabId);
      break; // Success, exit loop
    } catch (e) {
      retries--;
      if (retries > 0) {
        bgLog('Could not notify tab, retrying... (', retries, 'left)');
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        bgLog('Could not notify tab after retries:', e.message);
      }
    }
  }
  
  return { success: true, session: state[sessionKey] };
}

async function unregisterSession(sessionNum) {
  const sessionKey = sessionNum === 1 ? 'session1' : 'session2';
  state[sessionKey].tabId = null;
  state[sessionKey].platform = null;
  
  // Remove from storage
  await chrome.storage.local.remove([
    `session${sessionNum}_tabId`,
    `session${sessionNum}_platform`
  ]);
  
  // Stop conversation if a session is unregistered
  if (state.isActive) {
    stopConversation();
  }
  
  broadcastStateUpdate();
  return { success: true };
}

async function handleAIResponse(response, sessionNum) {
  console.log('[Background] handleAIResponse from session:', sessionNum);
  console.log('[Background] Response length:', response.length);
  console.log('[Background] Is active:', state.isActive);
  
  if (!state.isActive) {
    console.log('[Background] Conversation not active, ignoring response');
    return { success: false, reason: 'Conversation not active' };
  }
  
  // Use response as-is, let the prompt control response length
  // No truncation to keep conversation natural
  const finalResponse = response.trim();
  
  // Add to conversation history
  const historyEntry = {
    id: Date.now(),
    sessionNum,
    role: sessionNum === 1 ? state.session1.role : state.session2.role,
    content: finalResponse,
    timestamp: new Date().toISOString(),
    platform: sessionNum === 1 ? state.session1.platform : state.session2.platform
  };
  
  state.conversationHistory.push(historyEntry);
  console.log('[Background] Added to history, total messages:', state.conversationHistory.length);
  
  // Save to storage
  await chrome.storage.local.set({
    conversationHistory: state.conversationHistory
  });
  
  // Broadcast update to popup and content scripts
  broadcastConversationUpdate(historyEntry);
  broadcastStateUpdate();
  
  // Check if max turns reached
  if (state.conversationHistory.length >= state.config.maxTurns) {
    console.log('[Background] Max turns reached, stopping');
    await stopConversation();
    return { success: true, stopped: true, reason: 'Max turns reached' };
  }
  
  // Send to the other session
  const nextSession = sessionNum === 1 ? 2 : 1;
  state.currentTurn = nextSession;
  
  console.log('[Background] Will send to session', nextSession, 'after', state.config.autoReplyDelay, 'ms');
  
  // Delay before sending to next session
  setTimeout(async () => {
    if (state.isActive) {
      console.log('[Background] Sending message to session', nextSession);
      
      // Build message with context from recent conversation
      const messageWithContext = buildMessageWithContext(finalResponse, sessionNum);
      
      const result = await sendMessageToSession(nextSession, messageWithContext);
      console.log('[Background] Send result:', result);
    } else {
      console.log('[Background] Conversation no longer active, not sending');
    }
  }, state.config.autoReplyDelay);
  
  return { success: true };
}

// Build message with context from recent messages
function buildMessageWithContext(latestResponse, fromSessionNum) {
  const history = state.conversationHistory;
  const contextCount = state.config.contextMessages || 4;
  
  // If this is early in conversation (< 3 messages), just send the response
  if (history.length <= 2) {
    return latestResponse;
  }
  
  // Get recent messages for context (excluding the latest one we just added)
  const recentMessages = history.slice(-(contextCount + 1), -1);
  
  if (recentMessages.length === 0) {
    return latestResponse;
  }
  
  // Build context string
  let contextStr = '📋 **CONTEXT - Cuộc hội thoại gần đây:**\n';
  contextStr += '─'.repeat(40) + '\n';
  
  recentMessages.forEach((msg, index) => {
    // Truncate each context message to keep it brief
    const shortContent = msg.content.length > 200 
      ? msg.content.substring(0, 200) + '...' 
      : msg.content;
    contextStr += `**${msg.role}**: ${shortContent}\n\n`;
  });
  
  contextStr += '─'.repeat(40) + '\n';
  contextStr += '💬 **TIN NHẮN MỚI NHẤT:**\n\n';
  contextStr += latestResponse;
  contextStr += '\n\n─'.repeat(40) + '\n';
  contextStr += '👉 Hãy tiếp tục cuộc thảo luận dựa trên context ở trên. Trả lời NGẮN GỌN (2-4 câu).';
  
  console.log('[Background] Built message with', recentMessages.length, 'context messages');
  
  return contextStr;
}

async function startConversation(initialPrompt) {
  if (!state.session1.tabId || !state.session2.tabId) {
    return { success: false, error: 'Both sessions must be registered' };
  }
  
  state.isActive = true;
  state.currentTurn = 1;
  state.config.initialPrompt = initialPrompt;
  
  await chrome.storage.local.set({ isActive: true });
  
  broadcastStateUpdate();
  
  // Send initial prompt to session 1
  if (initialPrompt) {
    await sendMessageToSession(1, initialPrompt);
  }
  
  return { success: true };
}

async function stopConversation() {
  state.isActive = false;
  await chrome.storage.local.set({ isActive: false });
  
  broadcastStateUpdate();
  
  // Notify both sessions to stop
  if (state.session1.tabId) {
    chrome.tabs.sendMessage(state.session1.tabId, { type: 'CONVERSATION_STOPPED' }).catch(() => {});
  }
  if (state.session2.tabId) {
    chrome.tabs.sendMessage(state.session2.tabId, { type: 'CONVERSATION_STOPPED' }).catch(() => {});
  }
  
  return { success: true };
}

async function sendMessageToSession(sessionNum, text) {
  const session = sessionNum === 1 ? state.session1 : state.session2;
  
  if (!session.tabId) {
    return { success: false, error: `Session ${sessionNum} not registered` };
  }
  
  try {
    await chrome.tabs.sendMessage(session.tabId, {
      type: 'SEND_MESSAGE',
      text: text
    });
    return { success: true };
  } catch (error) {
    console.error(`Error sending to session ${sessionNum}:`, error);
    return { success: false, error: error.message };
  }
}

function getState() {
  return {
    isActive: state.isActive,
    session1: {
      connected: !!state.session1.tabId,
      platform: state.session1.platform,
      role: state.session1.role
    },
    session2: {
      connected: !!state.session2.tabId,
      platform: state.session2.platform,
      role: state.session2.role
    },
    currentTurn: state.currentTurn,
    config: state.config,
    messageCount: state.conversationHistory.length
  };
}

// Get state with actual tabIds for content script to check registration
function getStateWithTabIds() {
  return {
    isActive: state.isActive,
    session1: {
      connected: !!state.session1.tabId,
      tabId: state.session1.tabId,
      platform: state.session1.platform,
      role: state.session1.role
    },
    session2: {
      connected: !!state.session2.tabId,
      tabId: state.session2.tabId,
      platform: state.session2.platform,
      role: state.session2.role
    },
    currentTurn: state.currentTurn,
    config: state.config,
    messageCount: state.conversationHistory.length
  };
}

// Smart truncate - cut at sentence boundary
function smartTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  
  console.log('[Background] Smart truncating from', text.length, 'to max', maxLength);
  
  // Find the last complete sentence within maxLength
  const truncated = text.substring(0, maxLength);
  
  // Look for Vietnamese and English sentence endings
  // Vietnamese often uses: . ! ? and sometimes ends with quotes like "
  const sentenceEndRegex = /[.!?]["']?\s/g;
  let lastSentenceEnd = -1;
  let match;
  
  while ((match = sentenceEndRegex.exec(truncated)) !== null) {
    // Include the punctuation but not the space
    lastSentenceEnd = match.index + match[0].length - 1;
  }
  
  // Also check for sentence ending at the very end (no trailing space)
  const endMatch = truncated.match(/[.!?]["']?$/);
  if (endMatch) {
    lastSentenceEnd = truncated.length;
  }
  
  console.log('[Background] Last sentence end at:', lastSentenceEnd);
  
  // If found a sentence boundary at reasonable position (at least 30% of content)
  if (lastSentenceEnd > maxLength * 0.3) {
    const result = text.substring(0, lastSentenceEnd).trim();
    console.log('[Background] Truncated at sentence boundary, new length:', result.length);
    return result;
  }
  
  // Fallback: try to cut at paragraph/line break
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > maxLength * 0.5) {
    const result = text.substring(0, lastNewline).trim();
    console.log('[Background] Truncated at newline, new length:', result.length);
    return result;
  }
  
  // Fallback: try to cut at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) {
    const result = text.substring(0, lastSpace).trim();
    console.log('[Background] Truncated at word boundary, new length:', result.length);
    return result + '...';
  }
  
  // Last resort: hard cut (shouldn't happen with maxLength=2000)
  console.log('[Background] Hard truncate (fallback)');
  return truncated.trim() + '...';
}

// Check if a specific tab is registered
function checkTabRegistration(tabId) {
  console.log('[Background] ====== CHECK TAB REGISTRATION ======');
  console.log('[Background] Checking for tabId:', tabId, 'type:', typeof tabId);
  console.log('[Background] Session 1 tabId:', state.session1.tabId, 'type:', typeof state.session1.tabId);
  console.log('[Background] Session 2 tabId:', state.session2.tabId, 'type:', typeof state.session2.tabId);
  
  if (!tabId) {
    console.log('[Background] ERROR: tabId is null/undefined');
    return { isRegistered: false, error: 'No tabId provided' };
  }
  
  // Compare as numbers to be safe
  const checkTabId = Number(tabId);
  const session1TabId = state.session1.tabId ? Number(state.session1.tabId) : null;
  const session2TabId = state.session2.tabId ? Number(state.session2.tabId) : null;
  
  console.log('[Background] Comparing:', checkTabId, 'vs', session1TabId, 'and', session2TabId);
  
  if (session1TabId && checkTabId === session1TabId) {
    console.log('[Background] MATCH: Tab is Session 1 (Agent A)');
    return {
      isRegistered: true,
      sessionNum: 1,
      platform: state.session1.platform,
      role: state.session1.role
    };
  }
  
  if (session2TabId && checkTabId === session2TabId) {
    console.log('[Background] MATCH: Tab is Session 2 (Agent B)');
    return {
      isRegistered: true,
      sessionNum: 2,
      platform: state.session2.platform,
      role: state.session2.role
    };
  }
  
  console.log('[Background] NO MATCH: Tab is not registered');
  return { isRegistered: false };
}

async function updateConfig(newConfig) {
  state.config = { ...state.config, ...newConfig };
  await chrome.storage.local.set({ config: state.config });
  
  broadcastStateUpdate();
  return { success: true, config: state.config };
}

async function getConversationHistory() {
  return { history: state.conversationHistory };
}

async function clearHistory() {
  state.conversationHistory = [];
  await chrome.storage.local.set({ conversationHistory: [] });
  
  broadcastConversationUpdate(null, true);
  return { success: true };
}

function broadcastStateUpdate() {
  const stateUpdate = getState();
  
  // Send to popup
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    state: stateUpdate
  }).catch(() => {});
  
  // Send to content scripts
  if (state.session1.tabId) {
    chrome.tabs.sendMessage(state.session1.tabId, {
      type: 'STATE_UPDATE',
      state: stateUpdate
    }).catch(() => {});
  }
  if (state.session2.tabId) {
    chrome.tabs.sendMessage(state.session2.tabId, {
      type: 'STATE_UPDATE',
      state: stateUpdate
    }).catch(() => {});
  }
}

function broadcastConversationUpdate(entry, cleared = false) {
  const message = cleared 
    ? { type: 'CONVERSATION_CLEARED' }
    : { type: 'NEW_MESSAGE', message: entry, history: state.conversationHistory };
  
  // Send to popup
  chrome.runtime.sendMessage(message).catch(() => {});
  
  // Send to content scripts
  if (state.session1.tabId) {
    chrome.tabs.sendMessage(state.session1.tabId, message).catch(() => {});
  }
  if (state.session2.tabId) {
    chrome.tabs.sendMessage(state.session2.tabId, message).catch(() => {});
  }
}

// Handle tab close - unregister session
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.session1.tabId === tabId) {
    unregisterSession(1);
  } else if (state.session2.tabId === tabId) {
    unregisterSession(2);
  }
});

// Restore state from storage on startup
chrome.storage.local.get(['conversationHistory', 'config', 'isActive'], (result) => {
  if (result.conversationHistory) {
    state.conversationHistory = result.conversationHistory;
  }
  if (result.config) {
    state.config = { ...state.config, ...result.config };
  }
  // Don't restore isActive - require manual start
});

