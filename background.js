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
// CENTRALIZED LOGGING - Hybrid Approach
// ============================================
// Strategy (as per docs/LOGGING_ANALYSIS.md):
// 1. Memory: Primary storage (fast, always available, no quota)
// 2. Session Storage: Primary backup (auto-cleanup on reload, no quota worries)
// 3. Local Storage: Only ERROR/WARN logs + last 50 logs (persist across reload, limited quota)
//
// Benefits:
// - Logs available immediately from memory
// - No storage quota issues (session storage has no limit)
// - Important logs persist across extension reload
// - Fast performance (memory-first)
const debugLogs = [];
const MAX_LOGS = 1000; // Max logs in memory and session storage
const MAX_LOCAL_LOGS = 50; // Only keep last 50 logs in local storage (as recommended)
const MAX_RECENT_LOGS = 50; // Keep last N logs regardless of level in local storage
let logSaveTimer = null;

// Track if logs have been loaded in this session
let logsLoaded = false;

// Load logs from storage on startup
async function loadLogsFromStorage(addStartupLog = false) {
  try {
    // Try to load from session storage first (faster, more recent)
    let loadedCount = 0;
    let loadedLogs = [];
    
    // Load from session storage (if available)
    try {
      const sessionResult = await chrome.storage.session.get(['debugLogs']);
      if (sessionResult.debugLogs && Array.isArray(sessionResult.debugLogs)) {
        loadedLogs = sessionResult.debugLogs;
        loadedCount = loadedLogs.length;
        console.log(`[Background] Loaded ${loadedCount} logs from session storage`);
      }
    } catch (e) {
      console.warn('[Background] Session storage not available:', e);
    }
    
    // Step 2: If no session logs, try local storage (fallback - important logs only)
    // Local storage only has ERROR/WARN + last 50 logs, so it's a fallback
    if (loadedCount === 0) {
      try {
        const localResult = await chrome.storage.local.get(['debugLogs']);
        if (localResult.debugLogs && Array.isArray(localResult.debugLogs)) {
          loadedLogs = localResult.debugLogs;
          loadedCount = loadedLogs.length;
          console.log(`[Background] Loaded ${loadedCount} logs from local storage (fallback - important logs only)`);
        }
      } catch (e) {
        console.warn('[Background] Failed to load from local storage:', e);
      }
    }
    
    // Only replace logs if we actually loaded something, or if this is the first load
    if (loadedCount > 0 || !logsLoaded) {
      debugLogs.length = 0;
      if (loadedCount > 0) {
        debugLogs.push(...loadedLogs);
      }
      console.log(`[Background] Total logs loaded: ${debugLogs.length}`);
      logsLoaded = true;
    }
    
    // Only add startup log if explicitly requested (on actual startup)
    if (addStartupLog) {
      // Check storage usage
      const storageInfo = await checkStorageUsage();
      
      const storageMsg = storageInfo 
        ? `Storage: ${storageInfo.usagePercent}% used`
        : 'Storage check failed';
      const startupEntry = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        source: 'Background',
        message: `Service worker started - ${loadedCount > 0 ? `loaded ${loadedCount} logs from storage` : 'no logs in storage, initializing'} - ${storageMsg}`
      };
      debugLogs.push(startupEntry);
      
      // Save immediately (with error handling)
      try {
        const logsToSave = debugLogs.slice(-MAX_LOGS);
        
        // Save to session storage
        try {
          await chrome.storage.session.set({ debugLogs: logsToSave });
        } catch (e) {
          console.warn('[Background] Session storage not available:', e);
        }
        
        // Save to local storage: ERROR/WARN logs + last 50 logs (as per recommendation)
        const importantLogs = logsToSave
          .filter(log => log.level === 'ERROR' || log.level === 'WARN');
        const recentLogs = logsToSave.slice(-MAX_RECENT_LOGS);
        
        // Combine and deduplicate by timestamp
        const allLogsForLocal = [...importantLogs, ...recentLogs];
        const uniqueLogs = Array.from(
          new Map(allLogsForLocal.map(log => [log.timestamp, log])).values()
        );
        
        // Sort by timestamp and keep last MAX_LOCAL_LOGS
        const logsForLocal = uniqueLogs
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
          .slice(-MAX_LOCAL_LOGS);
        
        try {
          await chrome.storage.local.set({ debugLogs: logsForLocal });
          console.log(`[Background] Added startup log, total logs: ${debugLogs.length}`);
        } catch (e) {
          console.error('[Background] Failed to save startup log to local storage:', e);
        }
      } catch (e) {
        console.error('[Background] Failed to save startup log:', e);
      }
    }
    
  } catch (e) {
    console.error('[Background] Failed to load logs from storage:', e);
    // Try to add error log even if storage failed
    try {
      const errorEntry = {
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        source: 'Background',
        message: 'Failed to load logs from storage: ' + e.message
      };
      debugLogs.push(errorEntry);
      logsLoaded = true; // Mark as loaded even if failed, to avoid retrying
    } catch (e2) {
      console.error('[Background] Failed to add error log:', e2);
    }
  }
}

// Save logs to storage (debounced)
// Strategy: Session storage first (primary backup), then local storage (important only)
async function saveLogsToStorage() {
  if (logSaveTimer) {
    clearTimeout(logSaveTimer);
  }
  logSaveTimer = setTimeout(async () => {
    try {
      // Trim logs before saving
      const logsToSave = debugLogs.slice(-MAX_LOGS);
      
      // Step 1: Save to session storage (primary backup - fast, no quota, auto-cleanup)
      // This is the main backup that persists during the session
      try {
        await chrome.storage.session.set({ debugLogs: logsToSave });
        console.log(`[Background] ✓ Saved ${logsToSave.length} logs to session storage`);
      } catch (e) {
        console.warn('[Background] Session storage not available:', e);
      }
      
      // Step 2: Save to local storage (important logs only - persist across reload)
      // Strategy: ERROR/WARN logs + last 50 logs (as per docs/LOGGING_ANALYSIS.md)
      const importantLogs = logsToSave
        .filter(log => log.level === 'ERROR' || log.level === 'WARN');
      const recentLogs = logsToSave.slice(-MAX_RECENT_LOGS);
      
      // Combine and deduplicate by timestamp
      const allLogsForLocal = [...importantLogs, ...recentLogs];
      const uniqueLogs = Array.from(
        new Map(allLogsForLocal.map(log => [log.timestamp, log])).values()
      );
      
      // Sort by timestamp and keep last MAX_LOCAL_LOGS
      const logsForLocal = uniqueLogs
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(-MAX_LOCAL_LOGS);
      
      try {
        await chrome.storage.local.set({ debugLogs: logsForLocal });
        console.log(`[Background] ✓ Saved ${logsForLocal.length} important logs to local storage (${importantLogs.length} ERROR/WARN + ${recentLogs.length} recent)`);
      } catch (e) {
        console.error('[Background] Failed to save to local storage:', e);
        // If storage is full, try to keep only ERROR logs
        if (e.message && e.message.includes('QUOTA_BYTES')) {
          console.warn('[Background] Local storage quota exceeded, keeping only ERROR logs');
          const errorLogs = logsToSave
            .filter(log => log.level === 'ERROR')
            .slice(-MAX_RECENT_LOGS);
          try {
            await chrome.storage.local.set({ debugLogs: errorLogs });
            console.log(`[Background] Kept ${errorLogs.length} ERROR logs only`);
          } catch (e2) {
            console.error('[Background] Failed to save error logs:', e2);
          }
        }
      }
    } catch (e) {
      console.error('[Background] Failed to save logs:', e);
    }
  }, 300); // 300ms debounce for faster saves while avoiding excessive writes
}

// Check storage usage
async function checkStorageUsage() {
  try {
    // Check local storage (has quota)
    const localUsage = await chrome.storage.local.getBytesInUse();
    const localQuota = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB default
    const localUsagePercent = (localUsage / localQuota * 100).toFixed(2);
    
    // Check session storage (no quota, but check size anyway)
    let sessionUsage = 0;
    try {
      sessionUsage = await chrome.storage.session.getBytesInUse();
    } catch (e) {
      // Session storage might not be available
    }
    
    console.log(`[Background] Storage usage - Local: ${localUsage} bytes / ${localQuota} bytes (${localUsagePercent}%), Session: ${sessionUsage} bytes`);
    return { 
      local: { usage: localUsage, quota: localQuota, usagePercent: localUsagePercent },
      session: { usage: sessionUsage },
      usage: localUsage,
      quota: localQuota,
      usagePercent: localUsagePercent
    };
  } catch (e) {
    console.error('[Background] Failed to check storage usage:', e);
    return null;
  }
}

// Initialize: load logs on startup (will be called in listeners too)
// This runs immediately when service worker starts
loadLogsFromStorage(true).then(() => {
  console.log('[Background] Logs initialized on service worker startup');
}).catch(e => {
  console.error('[Background] Failed to initialize logs:', e);
});

// Add log entry - Memory-first approach
// Logs are immediately available in memory, then saved to storage (debounced)
function addLog(source, level, message) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level,
    source: source,
    message: message
  };
  
  // Add to memory (primary storage - always available)
  debugLogs.push(entry);
  
  // Trim if too many (keep last MAX_LOGS)
  if (debugLogs.length > MAX_LOGS) {
    debugLogs.splice(0, debugLogs.length - MAX_LOGS);
  }
  
  // Save to storage (debounced - session storage + local storage for important logs)
  saveLogsToStorage();
  
  // Also console log for immediate visibility
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

// ============================================
// BACKEND CLIENT INITIALIZATION
// ============================================

// Initialize backend client by injecting into extension page
async function initBackendClient() {
  try {
    // Create or get extension page for backend client
    const url = chrome.runtime.getURL('backend-page.html');
    
    // Check if page already exists
    const tabs = await chrome.tabs.query({ url: url });
    if (tabs.length > 0) {
      bgLog('Backend client page already exists, tab ID:', tabs[0].id);
      // Ensure it's not closed
      try {
        await chrome.tabs.reload(tabs[0].id);
        bgLog('Reloaded existing backend client page');
      } catch (e) {
        bgLog('Tab was closed, creating new one');
        await chrome.tabs.create({
          url: url,
          active: false
        });
      }
      return;
    }
    
    // Create new page
    const tab = await chrome.tabs.create({
      url: url,
      active: false
    });
    
    bgLog('Backend client page created, tab ID:', tab.id);
    
    // Wait a bit for page to load, then verify
    setTimeout(async () => {
      try {
        const updatedTabs = await chrome.tabs.query({ url: url });
        if (updatedTabs.length > 0) {
          bgLog('Backend client page verified');
        } else {
          bgError('Backend client page was not created properly');
        }
      } catch (e) {
        bgError('Error verifying backend client page:', e);
      }
    }, 2000);
    
  } catch (error) {
    bgError('Failed to initialize backend client:', error);
    // Retry after delay
    setTimeout(initBackendClient, 5000);
  }
}

// Initialize storage and side panel
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    conversationHistory: [],
    config: state.config,
    isActive: false
  });
  
  // Load logs from storage
  await loadLogsFromStorage(true);
  
  bgLog('AI Chat Bridge installed');
  
  // Initialize backend client
  setTimeout(initBackendClient, 1000);
});

// Also initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  // Load logs from storage
  await loadLogsFromStorage(true);
  
  setTimeout(initBackendClient, 1000);
});

// Initialize backend client immediately when service worker starts
// (Service worker may wake up for various reasons)
setTimeout(initBackendClient, 2000);

// Also listen for manual connect command
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BACKEND_CONNECT') {
    initBackendClient();
    sendResponse({ success: true });
    return true;
  }
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
  handleMessage(message, sender)
    .then(result => {
      bgLog('Message handled, sending response:', message.type, JSON.stringify(result).substring(0, 100));
      sendResponse(result);
    })
    .catch(err => {
      bgError('Message handler error:', err);
      sendResponse({ success: false, error: err.message });
    });
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
      return handleAIResponse(message.response, message.sessionNum, message.requestId);
    
    case 'START_CONVERSATION':
      return startConversation(message.initialPrompt);
    
    case 'STOP_CONVERSATION':
      return stopConversation();
    
    case 'GET_STATE':
      return getStateWithTabIds();
    
    case 'GET_AVAILABLE_SESSION':
      // Get first available session for backend client
      return await getAvailableSession();
    
    case 'SWAP_AGENTS':
      // Swap Agent A and Agent B
      return await swapAgents();
    
    case 'AUTO_REGISTER_TABS':
      // Manually trigger auto-registration
      await autoRegisterChatTabs();
      return { success: true };
    
    case 'DEBUG_STATE':
      // Debug endpoint to check current state
      const storageCheck = await chrome.storage.local.get([
        'session1_tabId', 'session1_platform',
        'session2_tabId', 'session2_platform'
      ]);
      return {
        memory: {
          session1: state.session1,
          session2: state.session2
        },
        storage: storageCheck
      };
    
    case 'UPDATE_CONFIG':
      return updateConfig(message.config);
    
    case 'GET_CONVERSATION_HISTORY':
      return getConversationHistory();
    
    case 'CLEAR_HISTORY':
      return clearHistory();
    
    case 'SEND_TO_SESSION':
      return sendMessageToSession(message.sessionNum, message.text, message.requestId);
    
    case 'GET_CURRENT_TAB_ID':
      // Ensure we always return a response, even if tab ID is not available
      const tabId = sender?.tab?.id || null;
      bgLog('GET_CURRENT_TAB_ID request from sender:', sender?.tab?.id, 'returning:', tabId);
      return { tabId: tabId };
    
    case 'CHECK_TAB_REGISTRATION':
      bgLog('CHECK_TAB_REGISTRATION from tab:', sender.tab?.id);
      const checkTabId = sender.tab?.id;
      if (!checkTabId) {
        bgError('CHECK_TAB_REGISTRATION: No tab ID');
        return { isRegistered: false, error: 'No tab ID' };
      }
      return checkTabRegistration(checkTabId).then(result => {
        bgLog('CHECK_TAB_REGISTRATION result:', JSON.stringify(result));
        return result;
      }).catch(err => {
        bgError('CHECK_TAB_REGISTRATION error:', err);
        return { isRegistered: false, error: err.message };
      });
    
    // ============================================
    // BACKEND STATUS
    // ============================================
    case 'GET_BACKEND_STATUS':
      return getBackendStatus();
    
    case 'BACKEND_CONNECTED':
      broadcastBackendStatus({ connected: true, status: 'connected', extensionId: message.extensionId });
      return { success: true };
    
    case 'BACKEND_DISCONNECTED':
      broadcastBackendStatus({ connected: false, status: 'disconnected' });
      return { success: true };
    
    case 'BACKEND_STATUS_UPDATE':
      if (message.status) {
        broadcastBackendStatus(message.status);
      }
      return { success: true };
    
    // ============================================
    // LOGGING MESSAGES
    // ============================================
    case 'ADD_LOG':
      if (message.entry) {
        // Ensure logs are loaded first (in case service worker restarted)
        if (!logsLoaded) {
          try {
            await loadLogsFromStorage(false);
          } catch (e) {
            console.warn('[Background] Failed to load logs before ADD_LOG:', e);
          }
        }
        
        debugLogs.push(message.entry);
        if (debugLogs.length > MAX_LOGS) {
          debugLogs.splice(0, debugLogs.length - MAX_LOGS);
        }
        // Save to storage
        saveLogsToStorage();
        console.log(`[Background] ADD_LOG: Added log entry, total logs: ${debugLogs.length}`);
      } else {
        console.warn('[Background] ADD_LOG: No entry provided in message');
      }
      return { success: true, logCount: debugLogs.length };
    
    case 'PING':
      // Simple ping to check if service worker is alive
      return { pong: true, timestamp: new Date().toISOString() };
    
    case 'GET_STORAGE_USAGE':
      // Return storage usage info
      const storageInfo = await checkStorageUsage();
      return storageInfo || { error: 'Failed to check storage' };
    
    case 'GET_LOGS':
      // Always try to load logs from storage first (in case service worker was restarted)
      // This ensures we have the latest logs even if service worker just started
      // Don't add startup log here, just load existing logs
      try {
        await loadLogsFromStorage(false);
      } catch (e) {
        console.error('[Background] Error loading logs in GET_LOGS:', e);
        // Continue anyway with whatever logs we have in memory
      }
      
      // Add a log entry to confirm GET_LOGS was called (but don't save it to avoid recursion)
      const getLogsEntry = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        source: 'Background',
        message: `GET_LOGS request - returning ${debugLogs.length} logs`
      };
      // Add to array but don't save (to avoid infinite loop)
      debugLogs.push(getLogsEntry);
      if (debugLogs.length > MAX_LOGS) {
        debugLogs.splice(0, debugLogs.length - MAX_LOGS);
      }
      
      // Return a copy to avoid issues
      return { logs: [...debugLogs] };
    
    case 'CLEAR_LOGS':
      debugLogs.length = 0;
      // Clear from all storage types
      chrome.storage.session.set({ debugLogs: [] }).catch(e => {
        console.warn('[Background] Failed to clear session storage:', e);
      });
      chrome.storage.local.set({ debugLogs: [] }).catch(e => {
        console.error('[Background] Failed to clear local storage:', e);
      });
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
  
  bgLog('Saved to storage:', registrationData);
  
  // Verify it was saved
  const verify = await chrome.storage.local.get([`session${sessionNum}_tabId`, `session${sessionNum}_platform`]);
  bgLog('Verification from storage:', verify);
  
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

// Store pending backend requests
const pendingBackendRequests = new Map(); // requestId -> { sessionNum, timestamp }

async function handleAIResponse(response, sessionNum, requestId) {
  bgLog('handleAIResponse from session:', sessionNum, 'requestId:', requestId);
  bgLog('Response length:', response.length);
  bgLog('Is active:', state.isActive);
  
  // If this is a backend request, forward to backend client
  if (requestId) {
    bgLog('Backend request detected, forwarding to backend client');
    pendingBackendRequests.set(requestId, { sessionNum, timestamp: Date.now() });
    
    // Forward to backend client (will be handled by backend-client.js)
    // We'll send a message that backend-client.js will pick up
    chrome.runtime.sendMessage({
      type: 'AI_RESPONSE_FOR_BACKEND',
      requestId: requestId,
      response: response.trim()
    }).catch(err => {
      bgError('Failed to forward to backend client:', err);
    });
    
    return { success: true, forwarded: true, requestId };
  }
  
  // Normal conversation flow (agent-to-agent)
  if (!state.isActive) {
    bgLog('Conversation not active, ignoring response');
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

async function sendMessageToSession(sessionNum, text, requestId = null) {
  const session = sessionNum === 1 ? state.session1 : state.session2;
  
  if (!session.tabId) {
    bgError(`Session ${sessionNum} not registered (no tabId)`);
    return { success: false, error: `Session ${sessionNum} not registered` };
  }
  
  try {
    // Verify tab still exists
    try {
      const tab = await chrome.tabs.get(session.tabId);
      if (!tab) {
        bgError(`Session ${sessionNum} tab not found`);
        // Clear invalid session
        session.tabId = null;
        session.platform = null;
        return { success: false, error: `Session ${sessionNum} tab was closed` };
      }
      bgLog(`Session ${sessionNum} tab verified:`, tab.url);
    } catch (tabError) {
      bgError(`Session ${sessionNum} tab error:`, tabError.message);
      // Tab was closed or doesn't exist
      session.tabId = null;
      session.platform = null;
      return { success: false, error: `Session ${sessionNum} tab was closed` };
    }
    
    const message = {
      type: 'SEND_MESSAGE',
      text: text
    };
    
    // Include requestId if provided (from backend)
    if (requestId) {
      message.requestId = requestId;
      bgLog('Forwarding message with requestId:', requestId, 'to session', sessionNum);
    }
    
    await chrome.tabs.sendMessage(session.tabId, message);
    bgLog(`Message sent successfully to session ${sessionNum}`);
    return { success: true };
  } catch (error) {
    bgError(`Error sending to session ${sessionNum}:`, error.message);
    
    // If tab was closed, clear the session
    if (error.message.includes('tab') || error.message.includes('No tab')) {
      session.tabId = null;
      session.platform = null;
    }
    
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

// Swap Agent A and Agent B
async function swapAgents() {
  bgLog('Swapping Agent A and Agent B...');
  
  // Swap in memory
  const temp = { ...state.session1 };
  state.session1 = { ...state.session2 };
  state.session2 = temp;
  
  // Update storage
  await chrome.storage.local.set({
    session1_tabId: state.session1.tabId,
    session1_platform: state.session1.platform,
    session2_tabId: state.session2.tabId,
    session2_platform: state.session2.platform
  });
  
  // Notify tabs
  if (state.session1.tabId) {
    chrome.tabs.sendMessage(state.session1.tabId, {
      type: 'REGISTRATION_CONFIRMED',
      sessionNum: 1,
      platform: state.session1.platform
    }).catch(() => {});
  }
  
  if (state.session2.tabId) {
    chrome.tabs.sendMessage(state.session2.tabId, {
      type: 'REGISTRATION_CONFIRMED',
      sessionNum: 2,
      platform: state.session2.platform
    }).catch(() => {});
  }
  
  broadcastStateUpdate();
  bgLog('Agents swapped successfully');
  
  return { success: true, session1: state.session1, session2: state.session2 };
}

// Get first available session for backend client
async function getAvailableSession() {
  // Always restore from storage first to ensure we have latest state
  bgLog('getAvailableSession called, current state:', {
    session1_tabId: state.session1.tabId,
    session2_tabId: state.session2.tabId
  });
  
  await restoreStateFromStorage();
  
  bgLog('After restore, state:', {
    session1_tabId: state.session1.tabId,
    session2_tabId: state.session2.tabId
  });
  
  // Prefer session 1, then session 2
  // Verify tab still exists before returning
  
  if (state.session1.tabId) {
    try {
      // Verify tab exists
      const tab = await chrome.tabs.get(state.session1.tabId);
      if (tab) {
        bgLog('Available session: 1 (tabId:', state.session1.tabId, ', url:', tab.url, ')');
        return { 
          available: true, 
          sessionNum: 1,
          tabId: state.session1.tabId,
          platform: state.session1.platform,
          role: state.session1.role
        };
      }
    } catch (error) {
      bgLog('Session 1 tab no longer exists:', error.message);
      // Tab was closed, clear it
      state.session1.tabId = null;
      state.session1.platform = null;
      await chrome.storage.local.remove(['session1_tabId', 'session1_platform']);
    }
  }
  
  if (state.session2.tabId) {
    try {
      // Verify tab exists
      const tab = await chrome.tabs.get(state.session2.tabId);
      if (tab) {
        bgLog('Available session: 2 (tabId:', state.session2.tabId, ', url:', tab.url, ')');
        return { 
          available: true, 
          sessionNum: 2,
          tabId: state.session2.tabId,
          platform: state.session2.platform,
          role: state.session2.role
        };
      }
    } catch (error) {
      bgLog('Session 2 tab no longer exists:', error.message);
      // Tab was closed, clear it
      state.session2.tabId = null;
      state.session2.platform = null;
      await chrome.storage.local.remove(['session2_tabId', 'session2_platform']);
    }
  }
  
  bgLog('No available session');
  bgLog('Current state:', {
    session1: {
      tabId: state.session1.tabId,
      platform: state.session1.platform,
      role: state.session1.role
    },
    session2: {
      tabId: state.session2.tabId,
      platform: state.session2.platform,
      role: state.session2.role
    }
  });
  
  // Try to get from storage one more time
  try {
    const storage = await chrome.storage.local.get(['session1_tabId', 'session2_tabId']);
    bgLog('Storage check:', {
      session1_tabId: storage.session1_tabId,
      session2_tabId: storage.session2_tabId
    });
  } catch (e) {
    bgError('Error checking storage:', e);
  }
  
  return { 
    available: false,
    session1: {
      hasTabId: !!state.session1.tabId,
      tabId: state.session1.tabId,
      platform: state.session1.platform
    },
    session2: {
      hasTabId: !!state.session2.tabId,
      tabId: state.session2.tabId,
      platform: state.session2.platform
    }
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
async function checkTabRegistration(tabId) {
  console.log('[Background] ====== CHECK TAB REGISTRATION ======');
  console.log('[Background] Checking for tabId:', tabId, 'type:', typeof tabId);
  
  // Always restore from storage first to ensure we have latest state
  await restoreStateFromStorage();
  
  console.log('[Background] After restore - Session 1 tabId:', state.session1.tabId, 'type:', typeof state.session1.tabId);
  console.log('[Background] After restore - Session 2 tabId:', state.session2.tabId, 'type:', typeof state.session2.tabId);
  
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
    bgLog('MATCH: Tab is Session 1 (Agent A)');
    const result = {
      isRegistered: true,
      sessionNum: 1,
      platform: state.session1.platform,
      role: state.session1.role
    };
    bgLog('Returning result:', JSON.stringify(result));
    return result;
  }
  
  if (session2TabId && checkTabId === session2TabId) {
    bgLog('MATCH: Tab is Session 2 (Agent B)');
    const result = {
      isRegistered: true,
      sessionNum: 2,
      platform: state.session2.platform,
      role: state.session2.role
    };
    bgLog('Returning result:', JSON.stringify(result));
    return result;
  }
  
  bgLog('NO MATCH: Tab is not registered');
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

// ============================================
// BACKEND STATUS FUNCTIONS
// ============================================

// Store backend connection status
let backendStatus = {
  connected: false,
  status: 'disconnected',
  extensionId: null,
  lastUpdate: null
};

function getBackendStatus() {
  return { status: backendStatus };
}

function broadcastBackendStatus(status) {
  backendStatus = {
    ...status,
    lastUpdate: new Date().toISOString()
  };
  
  bgLog('Backend status updated:', JSON.stringify(backendStatus));
  
  // Broadcast to side panel
  chrome.runtime.sendMessage({
    type: 'BACKEND_STATUS_UPDATE',
    status: backendStatus
  }).catch(() => {});
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
async function restoreStateFromStorage() {
  try {
    const result = await chrome.storage.local.get([
      'conversationHistory', 
      'config', 
      'isActive',
      'session1_tabId',
      'session1_platform',
      'session2_tabId',
      'session2_platform'
    ]);
    
    if (result.conversationHistory) {
      state.conversationHistory = result.conversationHistory;
    }
    if (result.config) {
      state.config = { ...state.config, ...result.config };
    }
    
    // Restore session registrations
    if (result.session1_tabId) {
      state.session1.tabId = result.session1_tabId;
      state.session1.platform = result.session1_platform || null;
      bgLog('Restored session 1 from storage:', result.session1_tabId, result.session1_platform);
      
      // Verify tab still exists
      try {
        await chrome.tabs.get(result.session1_tabId);
      } catch (e) {
        bgLog('Session 1 tab no longer exists, clearing');
        state.session1.tabId = null;
        state.session1.platform = null;
        await chrome.storage.local.remove(['session1_tabId', 'session1_platform']);
      }
    }
    
    if (result.session2_tabId) {
      state.session2.tabId = result.session2_tabId;
      state.session2.platform = result.session2_platform || null;
      bgLog('Restored session 2 from storage:', result.session2_tabId, result.session2_platform);
      
      // Verify tab still exists
      try {
        await chrome.tabs.get(result.session2_tabId);
      } catch (e) {
        bgLog('Session 2 tab no longer exists, clearing');
        state.session2.tabId = null;
        state.session2.platform = null;
        await chrome.storage.local.remove(['session2_tabId', 'session2_platform']);
      }
    }
    
    bgLog('State restored from storage');
  } catch (error) {
    bgError('Error restoring state from storage:', error);
  }
}

// Restore on startup
restoreStateFromStorage();

// ============================================
// AUTO-REGISTRATION
// ============================================

// Supported chat platforms
const SUPPORTED_PLATFORMS = [
  'gemini.google.com',
  'chatgpt.com',
  'chat.openai.com',
  'chat.deepseek.com',
  'duckduckgo.com'
];

// Check if URL is a supported chat platform
function isChatPlatform(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return SUPPORTED_PLATFORMS.some(platform => hostname.includes(platform));
  } catch {
    return false;
  }
}

// Detect platform from URL
function detectPlatformFromUrl(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes('gemini')) return 'gemini';
    if (hostname.includes('chatgpt') || hostname.includes('openai')) return 'chatgpt';
    if (hostname.includes('deepseek')) return 'deepseek';
    if (hostname.includes('duckduckgo')) return 'duckduckgo';
    return null;
  } catch {
    return null;
  }
}

// Auto-register available chat tabs
async function autoRegisterChatTabs() {
  bgLog('Auto-registering chat tabs...');
  
  try {
    // Get all tabs
    const tabs = await chrome.tabs.query({});
    
    // Filter to supported chat platforms
    const chatTabs = tabs
      .filter(tab => {
        // Must have a valid URL
        if (!tab.url) return false;
        
        // Exclude extension pages (but allow if it's a chat platform in extension context - shouldn't happen)
        if (tab.url.startsWith('chrome-extension://')) return false;
        
        // Must be a supported chat platform
        return isChatPlatform(tab.url);
      })
      .slice(0, 2); // Only take first 2
    
    bgLog('Found chat tabs:', chatTabs.length, chatTabs.map(t => ({ id: t.id, url: t.url })));
    
    if (chatTabs.length === 0) {
      bgLog('No chat tabs found');
      return;
    }
    
    // Register first tab as Agent A if not already registered
    if (chatTabs.length >= 1 && !state.session1.tabId) {
      const tab1 = chatTabs[0];
      const platform1 = detectPlatformFromUrl(tab1.url);
      if (platform1) {
        bgLog('Auto-registering tab', tab1.id, 'as Agent A (', platform1, ')');
        await registerSession(1, tab1.id, platform1);
      }
    }
    
    // Register second tab as Agent B if not already registered
    if (chatTabs.length >= 2 && !state.session2.tabId) {
      const tab2 = chatTabs[1];
      const platform2 = detectPlatformFromUrl(tab2.url);
      if (platform2) {
        bgLog('Auto-registering tab', tab2.id, 'as Agent B (', platform2, ')');
        await registerSession(2, tab2.id, platform2);
      }
    }
    
    // If only one tab and session2 is empty, try to use it for session2
    if (chatTabs.length === 1 && !state.session2.tabId && state.session1.tabId !== chatTabs[0].id) {
      const tab = chatTabs[0];
      const platform = detectPlatformFromUrl(tab.url);
      if (platform) {
        bgLog('Auto-registering tab', tab.id, 'as Agent B (', platform, ')');
        await registerSession(2, tab.id, platform);
      }
    }
    
    bgLog('Auto-registration complete');
    broadcastStateUpdate();
    
  } catch (error) {
    bgError('Error in auto-register:', error);
  }
}

// Listen for tab updates to auto-register
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when tab is fully loaded
  if (changeInfo.status !== 'complete') return;
  
  // Check if this is a chat platform
  if (!isChatPlatform(tab.url)) return;
  
  // Check if already registered
  if (state.session1.tabId === tabId || state.session2.tabId === tabId) {
    return; // Already registered
  }
  
  // Auto-register if we have space
  if (!state.session1.tabId) {
    const platform = detectPlatformFromUrl(tab.url);
    if (platform) {
      bgLog('Auto-registering new tab', tabId, 'as Agent A');
      await registerSession(1, tabId, platform);
    }
  } else if (!state.session2.tabId) {
    const platform = detectPlatformFromUrl(tab.url);
    if (platform) {
      bgLog('Auto-registering new tab', tabId, 'as Agent B');
      await registerSession(2, tabId, platform);
    }
  }
});

// Listen for new tabs
chrome.tabs.onCreated.addListener(async (tab) => {
  // Wait a bit for tab to load
  setTimeout(async () => {
    try {
      const updatedTab = await chrome.tabs.get(tab.id);
      if (isChatPlatform(updatedTab.url)) {
        await autoRegisterChatTabs();
      }
    } catch (e) {
      // Tab might be closed
    }
  }, 2000);
});

// Auto-register on startup
setTimeout(autoRegisterChatTabs, 3000);

