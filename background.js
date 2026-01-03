// AI Chat Bridge - Background Service Worker
// Manages communication between two AI chat sessions

// Template word limits configuration
const TEMPLATE_WORD_LIMITS = {
  debate: 200,
  story: 100,
  qa: 100, // Default for Q&A (answers), questions are typically shorter
  brainstorm: 100,
  default: 200 // Fallback for unknown templates or when no template is specified
};

const state = {
  isActive: false,
  // Participants array - supports multiple agents (n agents)
  // Each participant: { tabId, platform, title, order, role }
  participants: [], // Array of participants in conversation order
  currentTurn: 0, // Index in participants array (0-based)
  conversationHistory: [],
  // Available agents pool - tabs that have registered but not assigned to slots
  availableAgents: [], // Array of { tabId, platform, title, registeredAt }
  config: {
    autoReplyDelay: 2000, // Delay before auto-reply (ms)
    maxTurns: 50, // Maximum conversation turns
    contextMessages: 4, // Number of recent messages to include as context
    initialPrompt: '',
    templateType: null, // Template type: 'debate', 'story', 'qa', 'brainstorm', or null
    activateTabs: true // Automatically activate tabs before sending messages (helps with inactive tabs)
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
        bgLog(`[Background] Loaded ${loadedCount} logs from session storage`);
      }
    } catch (e) {
      bgWarn('[Background] Session storage not available:', e);
    }

    // Step 2: If no session logs, try local storage (fallback - important logs only)
    // Local storage only has ERROR/WARN + last 50 logs, so it's a fallback
    if (loadedCount === 0) {
      try {
        const localResult = await chrome.storage.local.get(['debugLogs']);
        if (localResult.debugLogs && Array.isArray(localResult.debugLogs)) {
          loadedLogs = localResult.debugLogs;
          loadedCount = loadedLogs.length;
          bgLog(`[Background] Loaded ${loadedCount} logs from local storage (fallback - important logs only)`);
        }
      } catch (e) {
        bgWarn('[Background] Failed to load from local storage:', e);
      }
    }

    // Only replace logs if we actually loaded something from storage
    // Don't clear memory logs if storage is empty - preserve what's in memory
    if (loadedCount > 0) {
      // Merge storage logs with memory logs (avoid duplicates by timestamp)
      const existingTimestamps = new Set(debugLogs.map(log => log.timestamp));
      const newLogs = loadedLogs.filter(log => !existingTimestamps.has(log.timestamp));

      if (newLogs.length > 0) {
        // Add new logs from storage to memory
        debugLogs.push(...newLogs);
        // Sort by timestamp
        debugLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        // Trim if too many
        if (debugLogs.length > MAX_LOGS) {
          debugLogs.splice(0, debugLogs.length - MAX_LOGS);
        }
        bgLog(`[Background] Merged ${newLogs.length} logs from storage, total: ${debugLogs.length}`);
      } else if (!logsLoaded) {
        // First load and storage has logs - replace memory (normal startup)
        debugLogs.length = 0;
        debugLogs.push(...loadedLogs);
        bgLog(`[Background] Loaded ${loadedCount} logs from storage (first load)`);
      }
      logsLoaded = true;
    } else if (!logsLoaded) {
      // First load but no logs in storage - just mark as loaded, keep memory as is
      bgLog(`[Background] No logs in storage, keeping memory logs (${debugLogs.length} logs)`);
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
          bgWarn('[Background] Session storage not available:', e);
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
          bgLog(`[Background] Added startup log, total logs: ${debugLogs.length}`);
        } catch (e) {
          bgError('[Background] Failed to save startup log to local storage:', e);
        }
      } catch (e) {
        bgError('[Background] Failed to save startup log:', e);
      }
    }

  } catch (e) {
    bgError('[Background] Failed to load logs from storage:', e);
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
      bgError('[Background] Failed to add error log:', e2);
    }
  }
}

// Save ERROR log immediately to local storage (for critical errors)
// This ensures ERROR logs are persisted even if service worker terminates before debounced save
async function saveErrorLogImmediately(errorEntry) {
  try {
    // Load existing logs from local storage
    const result = await chrome.storage.local.get(['debugLogs']);
    let existingLogs = [];
    if (result.debugLogs && Array.isArray(result.debugLogs)) {
      existingLogs = result.debugLogs;
    }

    // Add the new ERROR log
    existingLogs.push(errorEntry);

    // Keep only ERROR/WARN logs + last 50 logs (as per logging strategy)
    const importantLogs = existingLogs.filter(log => log.level === 'ERROR' || log.level === 'WARN');
    const recentLogs = existingLogs.slice(-MAX_RECENT_LOGS);

    // Combine and deduplicate by timestamp
    const allLogsForLocal = [...importantLogs, ...recentLogs];
    const uniqueLogs = Array.from(
      new Map(allLogsForLocal.map(log => [log.timestamp, log])).values()
    );

    // Sort by timestamp and keep last MAX_LOCAL_LOGS
    const logsForLocal = uniqueLogs
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-MAX_LOCAL_LOGS);

    // Save to local storage
    await chrome.storage.local.set({ debugLogs: logsForLocal });
    // Don't log this save operation to avoid infinite loop (this is called from addLog)
  } catch (e) {
    // Silently fail - the debounced save will retry anyway
    // Only log if it's not a quota error (to avoid spam)
    if (!e.message || !e.message.includes('QUOTA_BYTES')) {
      console.error('[Background] Failed to save ERROR log immediately:', e);
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
        bgLog(`[Background] ✓ Saved ${logsToSave.length} logs to session storage`);
      } catch (e) {
        bgWarn('[Background] Session storage not available:', e);
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
        bgLog(`[Background] ✓ Saved ${logsForLocal.length} important logs to local storage (${importantLogs.length} ERROR/WARN + ${recentLogs.length} recent)`);
      } catch (e) {
        bgError('[Background] Failed to save to local storage:', e);
        // If storage is full, try to keep only ERROR logs
        if (e.message && e.message.includes('QUOTA_BYTES')) {
          bgWarn('[Background] Local storage quota exceeded, keeping only ERROR logs');
          const errorLogs = logsToSave
            .filter(log => log.level === 'ERROR')
            .slice(-MAX_RECENT_LOGS);
          try {
            await chrome.storage.local.set({ debugLogs: errorLogs });
            bgLog(`[Background] Kept ${errorLogs.length} ERROR logs only`);
          } catch (e2) {
            bgError('[Background] Failed to save error logs:', e2);
          }
        }
      }
    } catch (e) {
      bgError('[Background] Failed to save logs:', e);
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

    bgLog(`[Background] Storage usage - Local: ${localUsage} bytes / ${localQuota} bytes (${localUsagePercent}%), Session: ${sessionUsage} bytes`);
    return {
      local: { usage: localUsage, quota: localQuota, usagePercent: localUsagePercent },
      session: { usage: sessionUsage },
      usage: localUsage,
      quota: localQuota,
      usagePercent: localUsagePercent
    };
  } catch (e) {
    bgError('[Background] Failed to check storage usage:', e);
    return null;
  }
}

// Initialize: load logs on startup (will be called in listeners too)
// This runs immediately when service worker starts
loadLogsFromStorage(true).then(() => {
  bgLog('[Background] Logs initialized on service worker startup');
}).catch(e => {
  bgError('[Background] Failed to initialize logs:', e);
});

// Always restore state from storage on startup to clean up stale tabs
restoreStateFromStorage().then(() => {
  console.log('[Background] State restored and validated on startup');
}).catch(e => {
  console.error('[Background] Failed to restore state:', e);
});

// Add log entry - Memory-first approach
// Logs are immediately available in memory, then saved to storage (debounced)
// ERROR logs are saved immediately to local storage to ensure persistence
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

  // Save to storage
  // For ERROR logs: save immediately to local storage to ensure persistence
  // For other logs: use debounced save for performance
  if (level === 'ERROR') {
    // Save ERROR logs immediately to ensure they're persisted
    // This is important because service worker might terminate before debounced save
    saveErrorLogImmediately(entry);
  }
  
  // Always trigger debounced save (for session storage and batch local storage updates)
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

function bgWarn(...args) {
  addLog('Background', 'WARN', args.join(' '));
}

// ============================================
// BACKEND CLIENT INITIALIZATION
// ============================================

// Initialize backend client by injecting into extension page
async function initBackendClient() {
  try {
    // Create or get extension page for backend client
    const url = chrome.runtime.getURL('backend-page.html');

    // Check if page already exists (use pattern matching for more reliable detection)
    const allTabs = await chrome.tabs.query({});
    const existingTab = allTabs.find(tab => tab.url && tab.url.includes('backend-page.html'));
    
    if (existingTab) {
      bgLog('Backend client page already exists, tab ID:', existingTab.id, 'URL:', existingTab.url);
      // Ensure it's not closed and verify it's accessible
      try {
        const tab = await chrome.tabs.get(existingTab.id);
        if (tab.status === 'complete') {
          bgLog('Existing backend client page is ready');
          return;
        } else {
          // Tab exists but not loaded yet, wait for it
          bgLog('Existing backend client page is loading, waiting...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          const updatedTab = await chrome.tabs.get(existingTab.id);
          if (updatedTab.status === 'complete') {
            bgLog('Existing backend client page is now ready');
            return;
          }
        }
      } catch (e) {
        bgLog('Existing tab was closed or inaccessible, creating new one:', e.message);
        // Fall through to create new tab
      }
    }

    // Create new page
    bgLog('Creating new backend client page...');
    const tab = await chrome.tabs.create({
      url: url,
      active: false
    });

    bgLog('Backend client page created, tab ID:', tab.id);

    // Wait for page to load, then verify by tab ID (more reliable than URL query)
    // Use multiple attempts with increasing delays
    let attempts = 0;
    const maxAttempts = 5;
    const checkInterval = 500; // Start with 500ms, then increase

    const verifyTab = async () => {
      try {
        // Verify by tab ID (more reliable)
        const verifyTab = await chrome.tabs.get(tab.id);
        
        if (verifyTab && verifyTab.url && verifyTab.url.includes('backend-page.html')) {
          if (verifyTab.status === 'complete') {
            bgLog('Backend client page verified successfully, tab ID:', verifyTab.id, 'status:', verifyTab.status);
            return true;
          } else {
            bgLog('Backend client page is loading, status:', verifyTab.status, 'attempt:', attempts + 1);
          }
        } else {
          bgWarn('Backend client page tab found but URL mismatch:', verifyTab?.url);
        }
      } catch (e) {
        if (e.message && e.message.includes('No tab with id')) {
          bgError('Backend client page tab was closed before verification, tab ID:', tab.id);
          return false;
        } else {
          bgWarn('Error checking tab (attempt ' + (attempts + 1) + '):', e.message);
        }
      }
      
      attempts++;
      if (attempts < maxAttempts) {
        // Retry with exponential backoff
        setTimeout(verifyTab, checkInterval * attempts);
      } else {
        // Final check - try URL query as fallback
        try {
          const urlTabs = await chrome.tabs.query({ url: url });
          if (urlTabs.length > 0) {
            bgLog('Backend client page found via URL query (fallback), tab ID:', urlTabs[0].id);
          } else {
            // Also try pattern matching
            const allTabsCheck = await chrome.tabs.query({});
            const foundTab = allTabsCheck.find(t => t.url && t.url.includes('backend-page.html'));
            if (foundTab) {
              bgLog('Backend client page found via pattern match (fallback), tab ID:', foundTab.id);
            } else {
              bgError('Backend client page was not created properly - tab not found after', maxAttempts, 'attempts. Created tab ID was:', tab.id);
            }
          }
        } catch (e) {
          bgError('Backend client page verification failed completely:', e.message, 'Created tab ID was:', tab.id);
        }
      }
      return false;
    };

    // Start verification after initial delay
    setTimeout(verifyTab, 1000);

  } catch (error) {
    bgError('Failed to initialize backend client:', error.message || error);
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
    bgLog('Side panel opened');
  } catch (error) {
    bgError('Failed to open side panel:', error);
  }
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });

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
  // Handle ping for extension availability check
  if (message.type === 'PING') {
    return { success: true, pong: true };
  }

  switch (message.type) {
    case 'REGISTER_SESSION':
      // Legacy: Direct assignment to session slot (for backward compatibility)
      bgLog('[Background] REGISTER_SESSION request, sender.tab:', sender.tab);
      if (!sender.tab || !sender.tab.id) {
        bgError('[Background] ERROR: No tab ID in sender!');
        return { success: false, error: 'No tab ID' };
      }
      return registerSession(message.sessionNum, sender.tab.id, message.platform);

    case 'REGISTER_TO_POOL':
      // New: Register tab to available agents pool
      if (!sender || !sender.tab || !sender.tab.id) {
        bgError('REGISTER_TO_POOL: No sender or tab ID', JSON.stringify({ sender: sender ? 'exists' : 'null', tab: sender?.tab ? 'exists' : 'null' }));
        return { success: false, error: 'No tab ID' };
      }
      return registerToPool(sender.tab.id, message.platform);

    case 'GET_AVAILABLE_AGENTS':
      return getAvailableAgents();

    case 'GET_ALL_AGENTS':
      // Get all agents including assigned ones (for selector dropdowns)
      const allAgents = [];
      // Add assigned participants
      for (const participant of state.participants) {
        if (participant.tabId) {
          try {
            const tab = await chrome.tabs.get(participant.tabId);
            allAgents.push({
              tabId: participant.tabId,
              platform: participant.platform,
              title: tab.title || participant.title || 'Chat Tab',
              assigned: true,
              position: participant.order,
              role: participant.role
            });
          } catch (e) {
            // Tab closed
          }
        }
      }
      // Add available agents
      allAgents.push(...state.availableAgents.map(a => ({ ...a, assigned: false })));
      return { success: true, agents: allAgents };

    case 'ASSIGN_AGENT_TO_SLOT':
      if (!message || !message.tabId) {
        bgError('ASSIGN_AGENT_TO_SLOT: Missing tabId in message');
        return { success: false, error: 'Missing tabId' };
      }
      return assignAgentToSlot(message.tabId, message.position || message.sessionNum);

    case 'REMOVE_PARTICIPANT':
      return removeParticipant(message.position);

    case 'ADD_EMPTY_PARTICIPANT':
      return addEmptyParticipant(message.position);

    case 'REMOVE_AGENT_FROM_POOL':
      if (!message || !message.tabId) {
        bgError('REMOVE_AGENT_FROM_POOL: Missing tabId in message');
        return { success: false, error: 'Missing tabId' };
      }
      return removeAgentFromPool(message.tabId);

    case 'UNREGISTER_SESSION':
      return unregisterSession(message.sessionNum);

    case 'AI_RESPONSE_RECEIVED':
      return handleAIResponse(message.response, message.sessionNum, message.requestId);

    case 'START_CONVERSATION':
      return startConversation(message.initialPrompt, message.templateType);

    case 'STOP_CONVERSATION':
      return stopConversation();

    case 'GET_STATE':
      // Ensure state is loaded
      if (state.participants.length === 0 && !state.isActive) {
        await restoreStateFromStorage();
      }
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
          session1: state.participants.length > 0 && state.participants[0] ? state.participants[0] : null,
          session2: state.participants.length > 1 && state.participants[1] ? state.participants[1] : null,
          participants: state.participants
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
      // Legacy: sessionNum is 1-based, convert to 0-based participant index
      const participantIndex = message.sessionNum - 1;
      if (participantIndex >= 0 && participantIndex < state.participants.length) {
        return sendMessageToParticipant(participantIndex, message.text, message.requestId);
      }
      return { success: false, error: 'Invalid session number' };

    case 'CONTINUE_CONVERSATION':
      // Continue conversation by sending message to a specific participant
      return continueConversation(message.participantIndex, message.message);

    case 'GET_CURRENT_TAB_ID':
      // Ensure we always return a response, even if tab ID is not available
      const tabId = sender?.tab?.id || null;
      bgLog('GET_CURRENT_TAB_ID request from sender:', sender?.tab?.id, 'returning:', tabId);
      return { tabId: tabId };

    case 'CHECK_TAB_REGISTRATION':
      bgLog('CHECK_TAB_REGISTRATION from tab:', sender?.tab?.id);
      const checkTabId = sender?.tab?.id;
      if (!checkTabId) {
        bgError('CHECK_TAB_REGISTRATION: No tab ID', JSON.stringify({ sender: sender ? 'exists' : 'null', tab: sender?.tab ? 'exists' : 'null' }));
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
        // Only load if not already loaded to avoid overwriting memory logs
        if (!logsLoaded) {
          try {
            await loadLogsFromStorage(false);
          } catch (e) {
            bgWarn('[Background] Failed to load logs before ADD_LOG:', e);
            logsLoaded = true; // Mark as loaded to avoid retrying
          }
        }

        // Add new log entry to memory
        debugLogs.push(message.entry);
        if (debugLogs.length > MAX_LOGS) {
          debugLogs.splice(0, debugLogs.length - MAX_LOGS);
        }

        // Save to storage (debounced)
        saveLogsToStorage();
        bgLog(`[Background] ADD_LOG: Added log entry, total logs: ${debugLogs.length}`);
      } else {
        bgWarn('[Background] ADD_LOG: No entry provided in message');
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
      // Only load from storage if logs haven't been loaded yet (first time)
      // After that, memory is the source of truth until service worker restarts
      if (!logsLoaded) {
        try {
          await loadLogsFromStorage(false);
        } catch (e) {
          bgError('[Background] Error loading logs in GET_LOGS:', e);
          // Continue anyway with whatever logs we have in memory
          logsLoaded = true; // Mark as loaded to avoid retrying
        }
      }

      // Don't add a log entry for GET_LOGS - it would create noise
      // Just return what we have
      bgLog(`[Background] GET_LOGS: Returning ${debugLogs.length} logs from memory`);

      // Return a copy to avoid issues
      return { logs: [...debugLogs] };

    case 'CLEAR_LOGS':
      debugLogs.length = 0;
      // Clear from all storage types
      chrome.storage.session.set({ debugLogs: [] }).catch(e => {
        bgWarn('[Background] Failed to clear session storage:', e);
      });
      chrome.storage.local.set({ debugLogs: [] }).catch(e => {
        bgError('[Background] Failed to clear local storage:', e);
      });
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// Add participant to conversation (supports multiple agents)
async function addParticipant(tabId, platform, order = null) {
  bgLog('====== ADD PARTICIPANT ======');
  bgLog('TabId:', tabId, 'Platform:', platform, 'Order:', order);

  // Remove from pool if it's there
  state.availableAgents = state.availableAgents.filter(a => a.tabId !== tabId);
  await chrome.storage.local.set({ availableAgents: state.availableAgents });

  // Get tab title
  let title = 'Chat Tab';
  try {
    const tab = await chrome.tabs.get(tabId);
    title = tab.title || 'Chat Tab';
  } catch (e) {
    bgLog('Could not get tab title:', e.message);
  }

  // If order not specified, add to end
  if (order === null) {
    order = state.participants.length;
  }

  // Check if already a participant
  const existingIndex = state.participants.findIndex(p => p && p.tabId === tabId);
  if (existingIndex >= 0) {
    // Update existing participant
    state.participants[existingIndex].platform = platform;
    state.participants[existingIndex].title = title;
    // Reorder if needed
    if (order !== existingIndex) {
      const participant = state.participants.splice(existingIndex, 1)[0];
      state.participants.splice(order, 0, participant);
      // Update order numbers
      state.participants.forEach((p, idx) => {
        p.order = idx + 1;
        p.role = `Participant ${idx + 1}`;
      });
    }
  } else {
    // Add new participant
    const participant = {
      tabId: tabId,
      platform: platform,
      title: title,
      order: order + 1,
      role: `Participant ${order + 1}`
    };
    state.participants.splice(order, 0, participant);
    // Update order numbers for all participants
    state.participants.forEach((p, idx) => {
      p.order = idx + 1;
      p.role = `Participant ${idx + 1}`;
    });
  }

  // Save to storage
  await saveParticipantsToStorage();

  bgLog('Participants after add:', JSON.stringify(state.participants));

  // Notify popup about state change
  broadcastStateUpdate();
  broadcastAvailableAgentsUpdate();

  // Notify the specific tab to update its UI
  let retries = 3;
  while (retries > 0) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'REGISTRATION_CONFIRMED',
        sessionNum: state.participants.findIndex(p => p && p.tabId === tabId) + 1,
        platform: platform,
        order: state.participants.findIndex(p => p && p.tabId === tabId) + 1
      });
      bgLog('REGISTRATION_CONFIRMED sent successfully to tab:', tabId);
      break;
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

  return { success: true, participant: state.participants.find(p => p && p.tabId === tabId) };
}

// Legacy function for backward compatibility
async function registerSession(sessionNum, tabId, platform) {
  // Convert to new system: sessionNum becomes order (0-based)
  return await addParticipant(tabId, platform, sessionNum - 1);
}

// Save participants to storage
async function saveParticipantsToStorage() {
  const storageData = {
    participants: state.participants,
    currentTurn: state.currentTurn
  };
  await chrome.storage.local.set(storageData);
  bgLog('Saved participants to storage:', storageData);
}

// Register tab to available agents pool (new proactive registration)
async function registerToPool(tabId, platform) {
  bgLog('====== REGISTER TO POOL ======');
  bgLog('TabId:', tabId, 'Platform:', platform);

  // Check if already in pool
  const existingIndex = state.availableAgents.findIndex(agent => agent.tabId === tabId);
  if (existingIndex >= 0) {
    bgLog('Tab already in pool, updating...');
    // Update existing entry
    state.availableAgents[existingIndex].platform = platform;
    state.availableAgents[existingIndex].registeredAt = new Date().toISOString();
  } else {
    // Get tab title
    let title = 'Chat Tab';
    try {
      const tab = await chrome.tabs.get(tabId);
      title = tab.title || 'Chat Tab';
    } catch (e) {
      bgLog('Could not get tab title:', e.message);
    }

    // Add to pool
    state.availableAgents.push({
      tabId: tabId,
      platform: platform,
      title: title,
      registeredAt: new Date().toISOString()
    });
    bgLog('Added to pool. Total agents:', state.availableAgents.length);
  }

  // Save to storage
  await chrome.storage.local.set({ availableAgents: state.availableAgents });

  // Notify tab that it's registered to pool
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'REGISTERED_TO_POOL',
      platform: platform
    });
  } catch (e) {
    bgLog('Could not notify tab:', e.message);
  }

  // Broadcast update
  broadcastStateUpdate();
  broadcastAvailableAgentsUpdate();

  return { success: true, agent: state.availableAgents.find(a => a.tabId === tabId) };
}

// Get list of available agents
function getAvailableAgents() {
  // Filter out agents that are already assigned to participants
  const assignedTabIds = state.participants.filter(p => p).map(p => p.tabId).filter(Boolean);
  const available = state.availableAgents.filter(agent => !assignedTabIds.includes(agent.tabId));

  return {
    success: true,
    agents: available,
    total: state.availableAgents.length
  };
}

// Assign agent from pool to a position in conversation
async function assignAgentToSlot(tabId, position) {
  bgLog('====== ASSIGN AGENT TO POSITION ======');
  bgLog('TabId:', tabId, 'Position:', position);

  // Find agent in pool
  const agent = state.availableAgents.find(a => a.tabId === tabId);
  if (!agent) {
    // Check if already assigned (idempotent)
    const existing = state.participants.find(p => p && p.tabId === tabId);
    if (existing) {
      bgLog('Agent already assigned to participant:', existing.role);
      return { success: true, participant: existing, alreadyAssigned: true };
    }
    return { success: false, error: 'Agent not found in pool' };
  }

  // Check if position already has a participant
  const positionIndex = position - 1; // Convert to 0-based
  if (positionIndex < state.participants.length) {
    // Position exists - check if it has an agent assigned
    const existingParticipant = state.participants[positionIndex];
    if (existingParticipant.tabId && existingParticipant.tabId !== tabId) {
      // Release existing agent back to pool
      try {
        await chrome.tabs.get(existingParticipant.tabId);
        await registerToPool(existingParticipant.tabId, existingParticipant.platform);
      } catch (e) {
        bgLog('Could not return existing agent to pool:', e.message);
      }
    }
  }

  // Remove from pool and add/update as participant
  // Position is 1-based from UI, convert to 0-based for array
  const result = await addParticipant(tabId, agent.platform, position - 1);

  // Broadcast updates
  broadcastStateUpdate();
  broadcastAvailableAgentsUpdate();

  return result;
}

// Remove agent from pool
async function removeAgentFromPool(tabId) {
  bgLog('====== REMOVE AGENT FROM POOL ======');
  bgLog('TabId:', tabId);

  state.availableAgents = state.availableAgents.filter(a => a.tabId !== tabId);
  await chrome.storage.local.set({ availableAgents: state.availableAgents });

  // Notify tab
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'REMOVED_FROM_POOL'
    });
  } catch (e) {
    bgLog('Could not notify tab:', e.message);
  }

  // Broadcast update
  broadcastAvailableAgentsUpdate();

  return { success: true };
}

// Broadcast available agents update
function broadcastAvailableAgentsUpdate() {
  const available = getAvailableAgents();
  chrome.runtime.sendMessage({
    type: 'AVAILABLE_AGENTS_UPDATE',
    agents: available.agents
  }).catch(() => { });
}

// Add empty participant slot (no agent assigned yet)
async function addEmptyParticipant(position = null) {
  bgLog('====== ADD EMPTY PARTICIPANT ======');
  bgLog('Position:', position);

  // If position not specified, add to end
  if (position === null) {
    position = state.participants.length + 1;
  }

  // Convert to 0-based index
  const index = position - 1;

  // Create empty participant (no tabId)
  const participant = {
    tabId: null,
    platform: null,
    title: null,
    order: position,
    role: `Participant ${position}`
  };

  // Insert at specified position
  state.participants.splice(index, 0, participant);

  // Update order numbers for all participants
  state.participants.forEach((p, idx) => {
    p.order = idx + 1;
    p.role = `Participant ${idx + 1}`;
  });

  // Save to storage
  await saveParticipantsToStorage();

  bgLog('Added empty participant at position', position);
  bgLog('Total participants:', state.participants.length);

  // Broadcast updates
  broadcastStateUpdate();
  broadcastAvailableAgentsUpdate();

  return { success: true, participant: participant };
}

// Remove participant from conversation
async function removeParticipant(position) {
  bgLog('====== REMOVE PARTICIPANT ======');
  bgLog('Position:', position);

  if (position < 1 || position > state.participants.length) {
    return { success: false, error: 'Invalid position' };
  }

  // Get participant info before removing
  const participant = state.participants[position - 1];
  if (!participant) {
    return { success: false, error: 'Participant not found' };
  }

  const { tabId, platform } = participant;

  // Remove from participants array
  state.participants.splice(position - 1, 1);

  // Update order numbers for remaining participants
  state.participants.forEach((p, idx) => {
    p.order = idx + 1;
    p.role = `Participant ${idx + 1}`;
  });

  // Save to storage
  await saveParticipantsToStorage();

  // If tab still exists, add it back to the pool
  if (tabId && platform) {
    try {
      await chrome.tabs.get(tabId);
      await registerToPool(tabId, platform);
      bgLog('Removed participant at position', position, '- added tab back to pool');
    } catch (e) {
      bgLog('Tab no longer exists, not adding to pool');
    }
  }

  // Stop conversation if participant removed during active conversation
  if (state.isActive) {
    stopConversation();
  }

  // Notify the tab
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'REMOVED_FROM_CONVERSATION'
    });
  } catch (e) {
    bgLog('Could not notify tab:', e.message);
  }

  broadcastStateUpdate();
  broadcastAvailableAgentsUpdate();
  return { success: true };
}

// Legacy function for backward compatibility
async function unregisterSession(sessionNum) {
  return await removeParticipant(sessionNum);
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
    chrome.runtime.sendMessage({
      type: 'AI_RESPONSE_FOR_BACKEND',
      requestId: requestId,
      response: response.trim()
    }).catch(err => {
      bgError('Failed to forward to backend client:', err);
    });

    return { success: true, forwarded: true, requestId };
  }

  // Normal conversation flow (multi-agent)
  if (!state.isActive) {
    bgLog('Conversation not active, ignoring response');
    return { success: false, reason: 'Conversation not active' };
  }

  // Find which participant this is (sessionNum is 1-based from legacy, or order from new system)
  const participantIndex = state.participants.findIndex(p =>
    p && ((p.order === sessionNum) || (state.participants.indexOf(p) + 1 === sessionNum))
  );

  if (participantIndex === -1) {
    bgError('Participant not found for sessionNum:', sessionNum);
    return { success: false, error: 'Participant not found' };
  }

  const participant = state.participants[participantIndex];

  // Use response as-is, let the prompt control response length
  const finalResponse = response.trim();

  // Add to conversation history
  const historyEntry = {
    id: Date.now(),
    sessionNum: participantIndex + 1, // 1-based for compatibility
    participantIndex: participantIndex, // 0-based index
    order: participant.order,
    role: participant.role,
    content: finalResponse,
    timestamp: new Date().toISOString(),
    platform: participant.platform,
    title: participant.title
  };

  state.conversationHistory.push(historyEntry);
  bgLog('[Background] Added to history, total messages:', state.conversationHistory.length);

  // Save to storage
  await chrome.storage.local.set({
    conversationHistory: state.conversationHistory
  });

  // Broadcast update to popup and content scripts
  broadcastConversationUpdate(historyEntry);
  broadcastStateUpdate();

  // Check if max turns reached
  if (state.conversationHistory.length >= state.config.maxTurns) {
    bgLog('[Background] Max turns reached, stopping');
    await stopConversation();
    return { success: true, stopped: true, reason: 'Max turns reached' };
  }

  // Cycle to next participant (circular: 0 → 1 → ... → n-1 → 0)
  // Skip empty slots (participants without tabId)
  let nextParticipantIndex = (participantIndex + 1) % state.participants.length;
  let attempts = 0;
  const maxAttempts = state.participants.length;

  // Find next participant with a tabId
  while (attempts < maxAttempts && (!state.participants[nextParticipantIndex] || !state.participants[nextParticipantIndex].tabId)) {
    nextParticipantIndex = (nextParticipantIndex + 1) % state.participants.length;
    attempts++;
  }

  // If no valid participant found, stop conversation
  if (attempts >= maxAttempts || !state.participants[nextParticipantIndex] || !state.participants[nextParticipantIndex].tabId) {
    bgError('No valid participants found for next turn, stopping conversation');
    await stopConversation();
    return { success: true, stopped: true, reason: 'No valid participants' };
  }

  state.currentTurn = nextParticipantIndex;

  const nextParticipant = state.participants[nextParticipantIndex];
  bgLog('[Background] Will send to participant', nextParticipantIndex + 1, '(', nextParticipant.platform, ') after', state.config.autoReplyDelay, 'ms');

  // Delay before sending to next participant
  setTimeout(async () => {
    if (state.isActive && state.participants.length > 0) {
      bgLog('[Background] Sending message to participant', nextParticipantIndex + 1);

      // Build message with context from recent conversation
      const messageWithContext = buildMessageWithContext(finalResponse, participantIndex);

      const result = await sendMessageToParticipant(nextParticipantIndex, messageWithContext);
      bgLog('[Background] Send result:', result);
    } else {
      bgLog('[Background] Conversation no longer active or no participants, not sending');
    }
  }, state.config.autoReplyDelay);

  return { success: true };
}

// Get word limit for current template type
function getWordLimitForTemplate() {
  const templateType = state.config.templateType;
  if (templateType && TEMPLATE_WORD_LIMITS[templateType]) {
    return TEMPLATE_WORD_LIMITS[templateType];
  }
  return TEMPLATE_WORD_LIMITS.default;
}

// Build message with context from recent messages
function buildMessageWithContext(latestResponse, fromParticipantIndex) {
  const history = state.conversationHistory;
  const contextCount = state.config.contextMessages || 4;
  const wordLimit = getWordLimitForTemplate();

  // If this is early in conversation (< 3 messages), add length limit reminder
  if (history.length <= 2) {
    // Add initial prompt if available
    let message = latestResponse;
    if (state.config.initialPrompt && state.config.initialPrompt.trim()) {
      message = '📌 **CHỦ ĐỀ CHÍNH:**\n' + state.config.initialPrompt + '\n\n─'.repeat(40) + '\n\n' + message;
    }
    // Add length limit instruction even for early messages
    return message + `\n\n⚠️ **LƯU Ý:** Giữ câu trả lời NGẮN GỌN (2-4 câu, dưới ${wordLimit} từ). KHÔNG viết dài dòng.`;
  }

  // Get recent messages for context (excluding the latest one we just added)
  const recentMessages = history.slice(-(contextCount + 1), -1);

  if (recentMessages.length === 0) {
    return latestResponse;
  }

  // Build context string
  let contextStr = '';
  
  // Add original topic/prompt at the beginning if available
  if (state.config.initialPrompt && state.config.initialPrompt.trim()) {
    contextStr += '📌 **CHỦ ĐỀ / CÂU HỎI GỐC:**\n';
    contextStr += state.config.initialPrompt + '\n\n';
    contextStr += '─'.repeat(40) + '\n\n';
  }
  
  contextStr += '📋 **CONTEXT - Cuộc hội thoại gần đây:**\n';
  contextStr += '─'.repeat(40) + '\n';

  recentMessages.forEach((msg, index) => {
    // Truncate each context message to keep it brief (use word limit for truncation)
    const truncateLength = Math.min(wordLimit * 5, 200); // Rough estimate: 5 chars per word, max 200 chars
    const shortContent = msg.content.length > truncateLength
      ? msg.content.substring(0, truncateLength) + '...'
      : msg.content;
    contextStr += `**${msg.role}**: ${shortContent}\n\n`;
  });

  contextStr += '─'.repeat(40) + '\n';
  contextStr += '💬 **TIN NHẮN MỚI NHẤT:**\n\n';
  contextStr += latestResponse;
  contextStr += '\n\n─'.repeat(40) + '\n';
  contextStr += '👉 **QUAN TRỌNG - QUY TẮC BẮT BUỘC:**\n';
  contextStr += `⚠️ Trả lời NGẮN GỌN - CHỈ 2-4 CÂU (tối đa ${wordLimit} TỪ)\n`;
  contextStr += '⚠️ KHÔNG viết dài dòng, KHÔNG liệt kê nhiều ý\n';
  contextStr += '⚠️ Giữ câu trả lời SÚC TÍCH và ĐIỂM QUAN TRỌNG NHẤT\n';
  contextStr += '⚠️ TẬP TRUNG vào chủ đề gốc đã nêu ở trên\n';
  contextStr += `👉 Hãy tiếp tục cuộc thảo luận dựa trên context ở trên, TẬP TRUNG vào chủ đề gốc, với câu trả lời NGẮN GỌN (2-4 câu, dưới ${wordLimit} từ).`;

  bgLog('[Background] Built message with', recentMessages.length, 'context messages, word limit:', wordLimit);

  return contextStr;
}

async function startConversation(initialPrompt, templateType = null) {
  // Count participants with tabId (actual agents assigned)
  const validParticipants = state.participants.filter(p => p && p.tabId);

  if (validParticipants.length < 2) {
    return { success: false, error: 'At least 2 participants with agents must be assigned' };
  }

  // Find first participant with tabId
  let firstParticipantIndex = state.participants.findIndex(p => p && p.tabId);
  if (firstParticipantIndex === -1) {
    return { success: false, error: 'No participants with agents assigned' };
  }

  state.isActive = true;
  state.currentTurn = firstParticipantIndex; // Start with first valid participant (0-based index)
  state.config.initialPrompt = initialPrompt;
  state.config.templateType = templateType; // Store template type for word limit configuration

  await chrome.storage.local.set({ 
    isActive: true,
    config: state.config 
  });

  broadcastStateUpdate();

  // Send initial prompt to first valid participant
  if (initialPrompt) {
    await sendMessageToParticipant(firstParticipantIndex, initialPrompt);
  }

  return { success: true };
}

async function stopConversation() {
  state.isActive = false;
  await chrome.storage.local.set({ isActive: false });

  broadcastStateUpdate();

  // Notify all participants to stop
  state.participants.forEach(participant => {
    if (participant.tabId) {
      chrome.tabs.sendMessage(participant.tabId, { type: 'CONVERSATION_STOPPED' }).catch(() => { });
    }
  });

  return { success: true };
}

// Activate a tab before sending messages (helps with inactive tabs that can't receive messages)
// Chrome can activate tabs, which will also bring the window to front
async function activateTabIfNeeded(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    
    // Only activate if tab is not already active
    if (!tab.active) {
      bgLog(`Activating tab ${tabId} (currently inactive)`);
      try {
        // Activate the tab - this will also bring the window to front
        await chrome.tabs.update(tabId, { active: true });
        // Wait a bit for the tab to become active
        await new Promise(resolve => setTimeout(resolve, 100));
        bgLog(`Tab ${tabId} activated successfully`);
      } catch (activateError) {
        // Some tabs might not be activatable (e.g., in certain contexts)
        // Log but don't fail - we'll still try to send the message
        bgWarn(`Could not activate tab ${tabId}:`, activateError.message);
      }
    } else {
      bgLog(`Tab ${tabId} is already active`);
    }
  } catch (error) {
    // Tab might not exist or be accessible
    bgWarn(`Could not check/activate tab ${tabId}:`, error.message);
    // Don't throw - we'll still try to send the message
  }
}

// Send message to a participant by index (0-based)
async function sendMessageToParticipant(participantIndex, text, requestId = null) {
  if (participantIndex < 0 || participantIndex >= state.participants.length) {
    bgError(`Invalid participant index: ${participantIndex}`);
    return { success: false, error: `Invalid participant index: ${participantIndex}` };
  }

  const participant = state.participants[participantIndex];
  
  // Check if participant exists
  if (!participant) {
    bgError(`Participant at index ${participantIndex} is null/undefined`);
    return { success: false, error: `Participant ${participantIndex + 1} not found` };
  }

  if (!participant.tabId) {
    bgError(`Participant ${participantIndex + 1} not registered (no tabId)`);
    return { success: false, error: `Participant ${participantIndex + 1} not registered` };
  }

  try {
    // Verify tab still exists
    try {
      const tab = await chrome.tabs.get(participant.tabId);
      if (!tab) {
        bgError(`Participant ${participantIndex + 1} tab not found`);
        // Remove invalid participant
        state.participants.splice(participantIndex, 1);
        await saveParticipantsToStorage();
        return { success: false, error: `Participant ${participantIndex + 1} tab was closed` };
      }
      bgLog(`Participant ${participantIndex + 1} tab verified:`, tab.url, 'active:', tab.active);
      
      // Activate tab if needed (helps with inactive tabs that can't receive messages)
      if (state.config.activateTabs !== false) {
        await activateTabIfNeeded(participant.tabId);
      }
    } catch (tabError) {
      bgError(`Participant ${participantIndex + 1} tab error:`, tabError.message);
      // Tab was closed or doesn't exist
      state.participants.splice(participantIndex, 1);
      await saveParticipantsToStorage();
      return { success: false, error: `Participant ${participantIndex + 1} tab was closed` };
    }

    const message = {
      type: 'SEND_MESSAGE',
      text: text
    };

    // Include requestId if provided (from backend)
    if (requestId) {
      message.requestId = requestId;
      bgLog('Forwarding message with requestId:', requestId, 'to participant', participantIndex + 1);
    }

    await chrome.tabs.sendMessage(participant.tabId, message);
    bgLog(`Message sent successfully to participant ${participantIndex + 1}`);
    return { success: true };
  } catch (error) {
    bgError(`Error sending to participant ${participantIndex + 1}:`, error.message);

    // If tab was closed, remove the participant
    if (error.message.includes('tab') || error.message.includes('No tab')) {
      state.participants.splice(participantIndex, 1);
      await saveParticipantsToStorage();
    }

    return { success: false, error: error.message };
  }
}

// Continue conversation by sending a message to a specific participant
async function continueConversation(participantIndex, message) {
  bgLog('[Background] Continue conversation requested, participantIndex:', participantIndex);
  
  if (participantIndex < 0 || participantIndex >= state.participants.length) {
    bgError('[Background] Invalid participant index:', participantIndex);
    return { success: false, error: 'Invalid participant index' };
  }

  const participant = state.participants[participantIndex];
  if (!participant || !participant.tabId) {
    bgError('[Background] Participant not found or not registered:', participantIndex);
    return { success: false, error: 'Participant not found or not registered' };
  }

  // If conversation is not active, reactivate it
  if (!state.isActive) {
    bgLog('[Background] Conversation not active, reactivating...');
    state.isActive = true;
    state.currentTurn = participantIndex;
    await chrome.storage.local.set({ isActive: true });
    broadcastStateUpdate();
  } else {
    // Update current turn to the participant we're sending to
    state.currentTurn = participantIndex;
  }

  // Send the continuation message
  const result = await sendMessageToParticipant(participantIndex, message);
  
  if (result.success) {
    bgLog('[Background] Continuation message sent successfully');
  } else {
    bgError('[Background] Failed to send continuation message:', result.error);
  }

  return result;
}

function getState() {
  return {
    isActive: state.isActive,
    session1: state.participants.length > 0 && state.participants[0] ? {
      connected: !!state.participants[0].tabId,
      platform: state.participants[0].platform,
      role: state.participants[0].role
    } : { connected: false, platform: null, role: null },
    session2: state.participants.length > 1 && state.participants[1] ? {
      connected: !!state.participants[1].tabId,
      platform: state.participants[1].platform,
      role: state.participants[1].role
    } : { connected: false, platform: null, role: null },
    currentTurn: state.currentTurn,
    config: state.config,
    messageCount: state.conversationHistory.length
  };
}

// Get state with actual tabIds for content script to check registration
function getStateWithTabIds() {
  return {
    isActive: state.isActive,
    participants: state.participants.filter(p => p != null).map(p => ({
      connected: !!p.tabId,
      tabId: p.tabId,
      platform: p.platform,
      role: p.role,
      order: p.order,
      title: p.title
    })),
    currentTurn: state.currentTurn,
    config: state.config,
    messageCount: state.conversationHistory.length,
    // Legacy compatibility
    session1: state.participants.length > 0 && state.participants[0] ? {
      connected: !!state.participants[0].tabId,
      tabId: state.participants[0].tabId,
      platform: state.participants[0].platform,
      role: state.participants[0].role
    } : { connected: false, tabId: null, platform: null, role: null },
    session2: state.participants.length > 1 && state.participants[1] ? {
      connected: !!state.participants[1].tabId,
      tabId: state.participants[1].tabId,
      platform: state.participants[1].platform,
      role: state.participants[1].role
    } : { connected: false, tabId: null, platform: null, role: null }
  };
}

// Reorder participants (swap positions)
async function reorderParticipants(fromPosition, toPosition) {
  bgLog('Reordering participants from', fromPosition, 'to', toPosition);

  if (fromPosition < 1 || fromPosition > state.participants.length ||
    toPosition < 1 || toPosition > state.participants.length) {
    return { success: false, error: 'Invalid positions' };
  }

  // Convert to 0-based indices
  const fromIdx = fromPosition - 1;
  const toIdx = toPosition - 1;

  // Move participant
  const participant = state.participants.splice(fromIdx, 1)[0];
  state.participants.splice(toIdx, 0, participant);

  // Update order numbers
  state.participants.forEach((p, idx) => {
    p.order = idx + 1;
    p.role = `Participant ${idx + 1}`;
  });

  // Save to storage
  await saveParticipantsToStorage();

  // Notify tabs
  state.participants.forEach((p, idx) => {
    if (p.tabId) {
      chrome.tabs.sendMessage(p.tabId, {
        type: 'REGISTRATION_CONFIRMED',
        sessionNum: idx + 1,
        platform: p.platform,
        order: idx + 1
      }).catch(() => { });
    }
  });

  broadcastStateUpdate();
  bgLog('Participants reordered successfully');

  return { success: true, participants: state.participants };
}

// Get first available session for backend client
async function getAvailableSession() {
  // Always restore from storage first to ensure we have latest state
  bgLog('getAvailableSession called, current participants:', state.participants.length);

  await restoreStateFromStorage();

  bgLog('After restore, participants:', state.participants.length);

  // Return first available participant
  // Verify tab still exists before returning

  for (let i = 0; i < state.participants.length; i++) {
    const participant = state.participants[i];
    // Check if participant exists and has a tabId
    if (participant && participant.tabId) {
      try {
        // Verify tab exists
        const tab = await chrome.tabs.get(participant.tabId);
        if (tab) {
          bgLog('Available participant:', i + 1, '(tabId:', participant.tabId, ', url:', tab.url, ')');
          return {
            available: true,
            sessionNum: i + 1, // 1-based for compatibility
            participantIndex: i, // 0-based
            tabId: participant.tabId,
            platform: participant.platform,
            role: participant.role,
            order: participant.order
          };
        }
      } catch (error) {
        bgLog('Participant', i + 1, 'tab no longer exists:', error.message);
        // Tab was closed, remove participant
        state.participants.splice(i, 1);
        await saveParticipantsToStorage();
      }
    }
  }

  bgLog('No available participant');
  bgLog('Current participants:', state.participants.length);

  // Try to get from storage one more time
  try {
    const storage = await chrome.storage.local.get(['participants']);
    if (storage.participants && storage.participants.length > 0) {
      bgLog('Found participants in storage, restoring...');
      await restoreStateFromStorage();
      // Try again after restore
      for (let i = 0; i < state.participants.length; i++) {
        const participant = state.participants[i];
        // Check if participant exists and has a tabId
        if (participant && participant.tabId) {
          try {
            const tab = await chrome.tabs.get(participant.tabId);
            if (tab) {
              return {
                available: true,
                sessionNum: i + 1,
                participantIndex: i,
                tabId: participant.tabId,
                platform: participant.platform,
                role: participant.role,
                order: participant.order
              };
            }
          } catch (e) {
            // Continue to next
          }
        }
      }
    }
  } catch (e) {
    bgError('Error checking storage:', e);
  }

  return {
    available: false,
    session1: state.participants.length > 0 && state.participants[0] ? {
      hasTabId: !!state.participants[0].tabId,
      tabId: state.participants[0].tabId,
      platform: state.participants[0].platform
    } : { hasTabId: false, tabId: null, platform: null },
    session2: state.participants.length > 1 && state.participants[1] ? {
      hasTabId: !!state.participants[1].tabId,
      tabId: state.participants[1].tabId,
      platform: state.participants[1].platform
    } : { hasTabId: false, tabId: null, platform: null }
  };
}

// Smart truncate - cut at sentence boundary
function smartTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  bgLog('[Background] Smart truncating from', text.length, 'to max', maxLength);

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

  bgLog('[Background] Last sentence end at:', lastSentenceEnd);

  // If found a sentence boundary at reasonable position (at least 30% of content)
  if (lastSentenceEnd > maxLength * 0.3) {
    const result = text.substring(0, lastSentenceEnd).trim();
    bgLog('[Background] Truncated at sentence boundary, new length:', result.length);
    return result;
  }

  // Fallback: try to cut at paragraph/line break
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > maxLength * 0.5) {
    const result = text.substring(0, lastNewline).trim();
    bgLog('[Background] Truncated at newline, new length:', result.length);
    return result;
  }

  // Fallback: try to cut at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) {
    const result = text.substring(0, lastSpace).trim();
    bgLog('[Background] Truncated at word boundary, new length:', result.length);
    return result + '...';
  }

  // Last resort: hard cut (shouldn't happen with maxLength=2000)
  bgLog('[Background] Hard truncate (fallback)');
  return truncated.trim() + '...';
}

// Check if a specific tab is registered
async function checkTabRegistration(tabId) {
  bgLog('[Background] ====== CHECK TAB REGISTRATION ======');
  bgLog('[Background] Checking for tabId:', tabId, 'type:', typeof tabId);

  // Only restore from storage if we don't have participants yet
  if (state.participants.length === 0) {
    await restoreStateFromStorage();
  }

  bgLog('[Background] After restore - Participants:', state.participants.length);

  if (!tabId) {
    bgLog('[Background] ERROR: tabId is null/undefined');
    return { isRegistered: false, error: 'No tabId provided' };
  }

  // Compare as numbers to be safe
  const checkTabId = Number(tabId);

  // Check if in participants array
  const participantIndex = state.participants.findIndex(p => p && p.tabId && Number(p.tabId) === checkTabId);
  if (participantIndex >= 0) {
    const participant = state.participants[participantIndex];
    // Additional safety check
    if (!participant) {
      bgLog('Participant at index', participantIndex, 'is null/undefined');
      return { isRegistered: false };
    }
    bgLog('MATCH: Tab is Participant', participantIndex + 1, '(', participant.role, ')');
    const result = {
      isRegistered: true,
      sessionNum: participantIndex + 1, // 1-based for compatibility
      participantIndex: participantIndex, // 0-based
      platform: participant.platform,
      role: participant.role,
      order: participant.order
    };
    bgLog('Returning result:', JSON.stringify(result));
    return result;
  }

  // Check if in available agents pool
  const agentInPool = state.availableAgents.find(a => Number(a.tabId) === checkTabId);
  if (agentInPool) {
    bgLog('MATCH: Tab is in available agents pool');
    return {
      isRegistered: true,
      inPool: true,
      platform: agentInPool.platform,
      tabId: agentInPool.tabId
    };
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

  // Reload and redirect participant tabs to root URLs
  for (const participant of state.participants) {
    if (participant && participant.tabId) {
      try {
        const tab = await chrome.tabs.get(participant.tabId);
        if (tab && tab.url) {
          const rootUrl = getRootUrlForPlatform(tab.url);
          if (rootUrl) {
            bgLog('Redirecting tab', participant.tabId, 'from', tab.url, 'to', rootUrl);
            await chrome.tabs.update(participant.tabId, { url: rootUrl });
          } else {
            // If we can't determine root URL, just reload
            bgLog('Reloading tab', participant.tabId, '(could not determine root URL)');
            await chrome.tabs.reload(participant.tabId);
          }
        }
      } catch (error) {
        bgLog('Error reloading/redirecting tab', participant.tabId, ':', error.message);
        // Tab might be closed, continue with other tabs
      }
    }
  }

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
  }).catch(() => { });
}

function broadcastStateUpdate() {
  const stateUpdate = getState();

  // Send to popup
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    state: stateUpdate
  }).catch(() => { });

  // Send to content scripts
  state.participants.forEach((p, idx) => {
    if (p && p.tabId) {
      chrome.tabs.sendMessage(p.tabId, {
        type: 'STATE_UPDATE',
        state: stateUpdate
      }).catch(() => { });
    }
  });
}

function broadcastConversationUpdate(entry, cleared = false) {
  const message = cleared
    ? { type: 'CONVERSATION_CLEARED' }
    : { type: 'NEW_MESSAGE', message: entry, history: state.conversationHistory };

  // Send to popup
  chrome.runtime.sendMessage(message).catch(() => { });

  // Send to all participants
  state.participants.forEach(participant => {
    if (participant.tabId) {
      chrome.tabs.sendMessage(participant.tabId, message).catch(() => { });
    }
  });
}

// Handle tab close - remove participant and remove from pool
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Check if in participants
  const participantIndex = state.participants.findIndex(p => p && p.tabId === tabId);
  if (participantIndex >= 0) {
    await removeParticipant(participantIndex + 1); // 1-based position
  }

  // Also remove from available agents pool
  const wasInPool = state.availableAgents.some(a => a.tabId === tabId);
  if (wasInPool) {
    state.availableAgents = state.availableAgents.filter(a => a.tabId !== tabId);
    chrome.storage.local.set({ availableAgents: state.availableAgents });
    broadcastAvailableAgentsUpdate();
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
      'session2_platform',
      'availableAgents',
      'participants'
    ]);

    if (result.conversationHistory) {
      state.conversationHistory = result.conversationHistory;
    }
    if (result.config) {
      state.config = { ...state.config, ...result.config };
    }

    // Restore available agents pool
    if (result.availableAgents && Array.isArray(result.availableAgents)) {
      // Verify tabs still exist and filter out invalid ones
      const validAgents = [];
      for (const agent of result.availableAgents) {
        try {
          if (agent.tabId) {
            await chrome.tabs.get(agent.tabId);
            validAgents.push(agent);
          }
        } catch (e) {
          bgLog('Agent tab no longer exists, removing from pool:', agent.tabId);
        }
      }
      state.availableAgents = validAgents;
      await chrome.storage.local.set({ availableAgents: state.availableAgents });
      bgLog('Restored available agents from storage:', validAgents.length);
    }

    // Restore participants (new system)
    if (result.participants && Array.isArray(result.participants)) {
      // Verify tabs still exist and filter out invalid ones
      const validParticipants = [];
      for (const participant of result.participants) {
        if (!participant) continue; // Skip nulls if any

        if (participant.tabId) {
          try {
            await chrome.tabs.get(participant.tabId);
            validParticipants.push(participant);
          } catch (e) {
            bgLog('Participant tab no longer exists, removing:', participant.tabId);
            // Don't add back to array, effectively removing it
          }
        } else {
          // Empty slot (no tabId) - keep it
          validParticipants.push(participant);
        }
      }
      state.participants = validParticipants;
      // Update order numbers
      state.participants.forEach((p, idx) => {
        p.order = idx + 1;
        p.role = `Participant ${idx + 1}`;
      });
      state.currentTurn = result.currentTurn || 0;
      await saveParticipantsToStorage();
      bgLog('Restored participants from storage:', validParticipants.length);
    } else {
      // Legacy: restore from session1/session2 format
      const legacyParticipants = [];
      if (result.session1_tabId) {
        try {
          await chrome.tabs.get(result.session1_tabId);
          legacyParticipants.push({
            tabId: result.session1_tabId,
            platform: result.session1_platform || null,
            title: 'Chat Tab',
            order: 1,
            role: 'Participant 1'
          });
        } catch (e) {
          bgLog('Session 1 tab no longer exists');
        }
      }
      if (result.session2_tabId) {
        try {
          await chrome.tabs.get(result.session2_tabId);
          legacyParticipants.push({
            tabId: result.session2_tabId,
            platform: result.session2_platform || null,
            title: 'Chat Tab',
            order: 2,
            role: 'Participant 2'
          });
        } catch (e) {
          bgLog('Session 2 tab no longer exists');
        }
      }
      if (legacyParticipants.length > 0) {
        state.participants = legacyParticipants;
        state.currentTurn = 0;
        await saveParticipantsToStorage();
        bgLog('Migrated legacy sessions to participants:', legacyParticipants.length);
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
  'duckduckgo.com',
  'chat.z.ai',
  'z.ai',
  'kimi.com'
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
    if (hostname.includes('z.ai') || hostname.includes('chat.z.ai')) return 'zai';
    if (hostname.includes('kimi.com')) return 'kimi';
    return null;
  } catch {
    return null;
  }
}

// Get root URL for a platform based on current URL
function getRootUrlForPlatform(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Gemini: https://gemini.google.com/
    if (hostname.includes('gemini')) {
      return 'https://gemini.google.com/';
    }
    
    // ChatGPT: https://chatgpt.com/ or https://chat.openai.com/
    if (hostname.includes('chatgpt.com')) {
      return 'https://chatgpt.com/';
    }
    if (hostname.includes('openai.com')) {
      return 'https://chat.openai.com/';
    }
    
    // DeepSeek: https://chat.deepseek.com/
    if (hostname.includes('deepseek')) {
      return 'https://chat.deepseek.com/';
    }
    
    // DuckDuckGo: https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1 or https://duck.ai/
    if (hostname.includes('duck.ai')) {
      return 'https://duck.ai/';
    }
    if (hostname.includes('duckduckgo.com')) {
      return 'https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1';
    }
    
    // Z.ai: https://chat.z.ai/
    if (hostname.includes('z.ai') || hostname.includes('chat.z.ai')) {
      return 'https://chat.z.ai/';
    }
    
    // Kimi: https://www.kimi.com/
    if (hostname.includes('kimi.com')) {
      return 'https://www.kimi.com/';
    }
    
    return null;
  } catch {
    return null;
  }
}

// Auto-register available chat tabs to pool (new proactive registration)
async function autoRegisterChatTabs() {
  bgLog('Auto-registering chat tabs to pool...');

  try {
    // Get all tabs
    const tabs = await chrome.tabs.query({});

    // Filter to supported chat platforms
    const chatTabs = tabs.filter(tab => {
      // Must have a valid URL
      if (!tab.url) return false;

      // Exclude extension pages
      if (tab.url.startsWith('chrome-extension://')) return false;

      // Must be a supported chat platform
      return isChatPlatform(tab.url);
    });

    bgLog('Found chat tabs:', chatTabs.length, chatTabs.map(t => ({ id: t.id, url: t.url })));

    if (chatTabs.length === 0) {
      bgLog('No chat tabs found');
      return;
    }

    // Register all chat tabs to pool (if not already registered or assigned)
    const assignedTabIds = state.participants.filter(p => p).map(p => p.tabId).filter(Boolean);
    const poolTabIds = state.availableAgents.map(a => a.tabId);

    for (const tab of chatTabs) {
      // Skip if already assigned to a slot or already in pool
      if (assignedTabIds.includes(tab.id) || poolTabIds.includes(tab.id)) {
        continue;
      }

      const platform = detectPlatformFromUrl(tab.url);
      if (platform) {
        bgLog('Auto-registering tab', tab.id, 'to pool (', platform, ')');
        await registerToPool(tab.id, platform);
      }
    }

    bgLog('Auto-registration to pool complete');

  } catch (error) {
    bgError('Error in auto-register:', error);
  }
}

// Listen for tab updates to auto-register to pool
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when tab is fully loaded
  if (changeInfo.status !== 'complete') return;

  // Check if this is a chat platform
  if (!isChatPlatform(tab.url)) return;

  // Check if already assigned to participants
  if (state.participants.some(p => p.tabId === tabId)) {
    return; // Already assigned
  }

  // Check if already in pool
  if (state.availableAgents.some(a => a.tabId === tabId)) {
    return; // Already in pool
  }

  // Register to pool
  const platform = detectPlatformFromUrl(tab.url);
  if (platform) {
    bgLog('Auto-registering new tab', tabId, 'to pool');
    await registerToPool(tabId, platform);
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
