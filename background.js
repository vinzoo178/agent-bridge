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
  // Registered agent URLs for auto-opening (legacy - kept for backward compatibility)
  registeredAgentUrls: [], // Array of { url, platform, title, registeredAt }
  // Selected platform URLs to auto-open on browser startup
  selectedPlatformUrls: [], // Array of URLs selected by user from supported platforms
  autoOpenSettings: {
    openOnBrowserStart: false, // Open selected platform URLs when browser starts
    openInEmptyTabs: false // Open in tabs that currently have no agents
  },
  config: {
    autoReplyDelay: 2000, // Delay before auto-reply (ms)
    maxTurns: 50, // Maximum conversation turns
    contextMessages: 4, // Number of recent messages to include as context
    initialPrompt: '',
    templateType: null, // Template type: 'debate', 'story', 'qa', 'brainstorm', or null
    activateTabs: 'hybrid', // Tab activation mode: 'always' (always activate - recommended), 'never' (never activate - may not work reliably), 'hybrid' (visibility override - makes background tabs appear active)
    hybridActivationTime: 1500, // Brief activation time in ms for hybrid mode (how long to activate agent tab)
    hybridCheckInterval: 30000, // Check interval in ms for hybrid mode (how often to check for responses)
    hybridInitialDelay: 30000 // Initial delay in ms before first check in hybrid mode
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
const CLEANUP_THRESHOLD = 0.9; // Clean logs when reaching 90% of MAX_LOGS (proactive cleanup)
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
        // Trim if too many using cleanup function
        if (debugLogs.length > MAX_LOGS) {
          cleanupLogs('load-merge', MAX_LOGS);
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

// Automatic log cleanup function - cleans logs proactively and on errors
// This function handles both memory limits and storage quota issues
function cleanupLogs(reason = 'auto', targetSize = null) {
  const beforeCount = debugLogs.length;
  const cleanupThreshold = targetSize || Math.floor(MAX_LOGS * CLEANUP_THRESHOLD);
  
  if (debugLogs.length > cleanupThreshold) {
    // Keep the most recent logs (prioritize ERROR/WARN if needed)
    const logsToKeep = Math.max(cleanupThreshold, Math.floor(MAX_LOGS * 0.8));
    const removedCount = debugLogs.length - logsToKeep;
    
    // Keep ERROR/WARN logs and recent logs
    const errorWarnLogs = debugLogs.filter(log => log.level === 'ERROR' || log.level === 'WARN');
    const recentLogs = debugLogs.slice(-logsToKeep);
    
    // Combine: prefer ERROR/WARN, then recent logs
    const combined = [...errorWarnLogs, ...recentLogs];
    const uniqueLogs = Array.from(
      new Map(combined.map(log => [log.timestamp, log])).values()
    );
    
    // Sort by timestamp and keep the target size
    debugLogs.length = 0;
    debugLogs.push(...uniqueLogs
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-logsToKeep)
    );
    
    const afterCount = debugLogs.length;
    if (beforeCount !== afterCount) {
      console.log(`[Background] Cleaned ${removedCount} logs (${beforeCount} → ${afterCount}) - reason: ${reason}`);
    }
  }
  
  return { beforeCount, afterCount: debugLogs.length, removed: beforeCount - debugLogs.length };
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
    // Handle quota errors with automatic cleanup
    if (e.message && e.message.includes('QUOTA_BYTES')) {
      // Storage is full - try to clean up and save only ERROR logs
      try {
        const errorLogs = [errorEntry]; // At least save the current error
        await chrome.storage.local.set({ debugLogs: errorLogs });
        console.warn('[Background] Storage quota exceeded, saved only current ERROR log');
      } catch (e2) {
        console.error('[Background] Failed to save even minimal error log:', e2);
      }
    } else {
      // Only log if it's not a quota error (to avoid spam)
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
      // Proactive cleanup before saving (clean at 90% threshold)
      cleanupLogs('pre-save');
      
      // Trim logs before saving (ensure we don't exceed MAX_LOGS)
      const logsToSave = debugLogs.slice(-MAX_LOGS);

      // Step 1: Save to session storage (primary backup - fast, no quota, auto-cleanup)
      // This is the main backup that persists during the session
      try {
        await chrome.storage.session.set({ debugLogs: logsToSave });
        bgLog(`[Background] ✓ Saved ${logsToSave.length} logs to session storage`);
      } catch (e) {
        bgWarn('[Background] Session storage not available:', e);
        // If session storage fails, clean logs more aggressively
        cleanupLogs('session-storage-error', Math.floor(MAX_LOGS * 0.7));
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
        // If storage is full, automatically clean up and retry
        if (e.message && e.message.includes('QUOTA_BYTES')) {
          bgWarn('[Background] Local storage quota exceeded, cleaning logs and retrying');
          // Clean logs more aggressively (keep only 70% of MAX_LOCAL_LOGS)
          const aggressiveCleanupSize = Math.floor(MAX_LOCAL_LOGS * 0.7);
          const errorLogs = logsToSave
            .filter(log => log.level === 'ERROR')
            .slice(-aggressiveCleanupSize);
          try {
            await chrome.storage.local.set({ debugLogs: errorLogs });
            bgLog(`[Background] Auto-cleaned logs, kept ${errorLogs.length} ERROR logs only`);
            // Also clean memory logs to prevent future issues
            cleanupLogs('quota-error', Math.floor(MAX_LOGS * 0.8));
          } catch (e2) {
            bgError('[Background] Failed to save error logs after cleanup:', e2);
            // Last resort: clear all logs from storage if we can't save anything
            try {
              await chrome.storage.local.set({ debugLogs: errorLogs.slice(-10) }); // Keep only last 10 errors
              cleanupLogs('quota-error-severe', Math.floor(MAX_LOGS * 0.5));
            } catch (e3) {
              bgError('[Background] Critical: Could not save any logs to storage:', e3);
            }
          }
        }
      }
    } catch (e) {
      bgError('[Background] Failed to save logs:', e);
      // On any error, clean logs proactively to prevent future issues
      cleanupLogs('save-error', Math.floor(MAX_LOGS * 0.8));
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

  // Proactive cleanup: clean logs when reaching 90% of MAX_LOGS
  // This prevents hitting the hard limit and improves performance
  if (debugLogs.length >= Math.floor(MAX_LOGS * CLEANUP_THRESHOLD)) {
    cleanupLogs('auto-threshold');
  }
  
  // Hard limit: ensure we never exceed MAX_LOGS (safety net)
  if (debugLogs.length > MAX_LOGS) {
    cleanupLogs('max-limit', MAX_LOGS);
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

// TEMPORARY FLAG: Set to false to disable automatic opening of backend-page.html
const AUTO_OPEN_BACKEND_PAGE = false;

// Initialize backend client by injecting into extension page
async function initBackendClient() {
  // Check if auto-opening is disabled
  if (!AUTO_OPEN_BACKEND_PAGE) {
    bgLog('Auto-opening of backend-page.html is disabled');
    return;
  }

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
      return registerToPool(sender.tab.id, message.platform, message.availability);

    case 'CHECK_AGENT_AVAILABILITY':
      // Check if an agent is available (can receive input and submit)
      if (!sender || !sender.tab || !sender.tab.id) {
        return { success: false, error: 'No tab ID' };
      }
      return await checkAgentAvailability(sender.tab.id);

    case 'UPDATE_AGENT_AVAILABILITY':
      // Update availability status for an agent
      if (!message.tabId) {
        return { success: false, error: 'No tab ID provided' };
      }
      return await updateAgentAvailability(message.tabId, message.availability);

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

    case 'GET_REGISTERED_URLS':
      return { 
        success: true, 
        urls: state.registeredAgentUrls, 
        selectedPlatforms: state.selectedPlatformUrls,
        supportedPlatforms: getSupportedPlatformUrls(),
        settings: state.autoOpenSettings 
      };

    case 'GET_SUPPORTED_PLATFORMS':
      return { success: true, platforms: getSupportedPlatformUrls() };

    case 'UPDATE_SELECTED_PLATFORMS':
      state.selectedPlatformUrls = message.urls || [];
      await chrome.storage.local.set({ selectedPlatformUrls: state.selectedPlatformUrls });
      return { success: true, selectedPlatforms: state.selectedPlatformUrls };

    case 'UPDATE_AUTO_OPEN_SETTINGS':
      state.autoOpenSettings = { ...state.autoOpenSettings, ...message.settings };
      await chrome.storage.local.set({ autoOpenSettings: state.autoOpenSettings });
      return { success: true, settings: state.autoOpenSettings };

    case 'REMOVE_REGISTERED_URL':
      if (message.url) {
        state.registeredAgentUrls = state.registeredAgentUrls.filter(u => u.url !== message.url);
        await chrome.storage.local.set({ registeredAgentUrls: state.registeredAgentUrls });
        return { success: true };
      }
      return { success: false, error: 'No URL provided' };

    case 'OPEN_REGISTERED_URLS':
      return await openRegisteredUrls(message.context || 'manual');

    case 'OPEN_SELECTED_PLATFORMS':
      return await openSelectedPlatforms(message.context || 'manual');

    case 'OPEN_IN_EMPTY_TABS':
      return await openInEmptyTabs();

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
        
        // Proactive cleanup: clean logs when reaching 90% of MAX_LOGS
        if (debugLogs.length >= Math.floor(MAX_LOGS * CLEANUP_THRESHOLD)) {
          cleanupLogs('auto-threshold');
        }
        
        // Hard limit: ensure we never exceed MAX_LOGS (safety net)
        if (debugLogs.length > MAX_LOGS) {
          cleanupLogs('max-limit', MAX_LOGS);
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
  // Filter out empty participants (no tabId) before saving
  // We don't want to persist empty slots
  const validParticipants = state.participants.filter(p => p && p.tabId && p.tabId !== null);
  
  const storageData = {
    participants: validParticipants,
    currentTurn: state.currentTurn
  };
  await chrome.storage.local.set(storageData);
  bgLog('Saved participants to storage:', storageData);
}

// Register tab to available agents pool (new proactive registration)
async function registerToPool(tabId, platform, availability = null) {
  bgLog('====== REGISTER TO POOL ======');
  bgLog('TabId:', tabId, 'Platform:', platform);

  // Get tab info (title and URL)
  let title = 'Chat Tab';
  let url = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    title = tab.title || 'Chat Tab';
    url = tab.url || null;
  } catch (e) {
    bgLog('Could not get tab info:', e.message);
  }

  // If availability not provided, check it
  if (!availability) {
    try {
      const availabilityResponse = await chrome.tabs.sendMessage(tabId, {
        type: 'CHECK_AVAILABILITY'
      });
      if (availabilityResponse && availabilityResponse.available !== undefined) {
        availability = availabilityResponse;
        bgLog('Availability checked:', JSON.stringify(availability));
      }
    } catch (e) {
      bgLog('Could not check availability:', e.message);
      // Default to unknown availability
      availability = { available: true, reason: null, requiresLogin: false };
    }
  }

  // Check if already in pool
  const existingIndex = state.availableAgents.findIndex(agent => agent.tabId === tabId);
  if (existingIndex >= 0) {
    bgLog('Tab already in pool, updating...');
    // Update existing entry
    state.availableAgents[existingIndex].platform = platform;
    state.availableAgents[existingIndex].title = title;
    state.availableAgents[existingIndex].registeredAt = new Date().toISOString();
    state.availableAgents[existingIndex].availability = availability || { available: true, reason: null, requiresLogin: false };
  } else {
    // Add to pool
    state.availableAgents.push({
      tabId: tabId,
      platform: platform,
      title: title,
      registeredAt: new Date().toISOString(),
      availability: availability || { available: true, reason: null, requiresLogin: false }
    });
    bgLog('Added to pool. Total agents:', state.availableAgents.length);
  }

  // Also save URL to registered URLs list (if URL is valid and not already saved)
  if (url && isChatPlatform(url)) {
    const rootUrl = getRootUrlForPlatform(url);
    if (rootUrl) {
      const urlExists = state.registeredAgentUrls.some(u => u.url === rootUrl);
      if (!urlExists) {
        state.registeredAgentUrls.push({
          url: rootUrl,
          platform: platform,
          title: title,
          registeredAt: new Date().toISOString()
        });
        await chrome.storage.local.set({ registeredAgentUrls: state.registeredAgentUrls });
        bgLog('Added URL to registered list:', rootUrl);
        
        // Broadcast update to sidepanel
        chrome.runtime.sendMessage({
          type: 'REGISTERED_URLS_UPDATE',
          urls: state.registeredAgentUrls
        }).catch(() => { });
      }
    }
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

// Check agent availability by querying the content script
async function checkAgentAvailability(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_AVAILABILITY'
    });
    
    if (response && response.available !== undefined) {
      // Update availability in pool if agent is registered
      const agentIndex = state.availableAgents.findIndex(a => a.tabId === tabId);
      if (agentIndex >= 0) {
        state.availableAgents[agentIndex].availability = response;
        await chrome.storage.local.set({ availableAgents: state.availableAgents });
        broadcastAvailableAgentsUpdate();
      }
      
      return { success: true, availability: response };
    }
    
    return { success: false, error: 'Invalid response from content script' };
  } catch (e) {
    bgError('Failed to check agent availability:', e.message);
    return { success: false, error: e.message };
  }
}

// Update agent availability status
async function updateAgentAvailability(tabId, availability) {
  const agentIndex = state.availableAgents.findIndex(a => a.tabId === tabId);
  if (agentIndex >= 0) {
    state.availableAgents[agentIndex].availability = availability;
    await chrome.storage.local.set({ availableAgents: state.availableAgents });
    broadcastAvailableAgentsUpdate();
    return { success: true };
  }
  
  // Also check participants
  const participantIndex = state.participants.findIndex(p => p && p.tabId === tabId);
  if (participantIndex >= 0) {
    if (!state.participants[participantIndex].availability) {
      state.participants[participantIndex].availability = {};
    }
    state.participants[participantIndex].availability = availability;
    await saveParticipantsToStorage();
    broadcastStateUpdate();
    return { success: true };
  }
  
  return { success: false, error: 'Agent not found' };
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
  const participantIndex = position - 1; // Convert to 0-based index
  const participant = state.participants[participantIndex];
  if (!participant) {
    return { success: false, error: 'Participant not found' };
  }

  const { tabId, platform } = participant;

  // Clean up pending response and restore original tab if exists
  await restoreOriginalActiveTab(participantIndex);

  // Remove from participants array
  state.participants.splice(participantIndex, 1);

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

// Track pending responses to restore original active tabs
const pendingResponses = new Map(); // participantIndex -> { originalActiveTabId, activationTimer, activatedAt, restoredAt, checkInterval, checkCount, lastResponseText }

// Per-platform timeout optimization (self-learning)
// Structure: platformName -> { activationTime, checkInterval, initialDelay, successCount, totalCount, lastOptimized }
const platformOptimizedTimeouts = new Map();

// Load optimized timeouts from storage
async function loadOptimizedTimeouts() {
  try {
    const result = await chrome.storage.local.get(['platformOptimizedTimeouts']);
    if (result.platformOptimizedTimeouts) {
      for (const [platform, data] of Object.entries(result.platformOptimizedTimeouts)) {
        platformOptimizedTimeouts.set(platform, data);
      }
      bgLog(`Loaded optimized timeouts for ${platformOptimizedTimeouts.size} platforms`);
    }
  } catch (error) {
    bgWarn('Failed to load optimized timeouts:', error.message);
  }
}

// Save optimized timeouts to storage
async function saveOptimizedTimeouts() {
  try {
    const data = Object.fromEntries(platformOptimizedTimeouts);
    await chrome.storage.local.set({ platformOptimizedTimeouts: data });
    bgLog('Saved optimized timeouts');
  } catch (error) {
    bgWarn('Failed to save optimized timeouts:', error.message);
  }
}

// Get optimized timeout for a platform, or return defaults
function getOptimizedTimeout(platformName) {
  const optimized = platformOptimizedTimeouts.get(platformName);
  if (optimized && optimized.activationTime && optimized.checkInterval && optimized.initialDelay) {
    return {
      activationTime: optimized.activationTime,
      checkInterval: optimized.checkInterval,
      initialDelay: optimized.initialDelay
    };
  }
  // Return defaults
  return {
    activationTime: state.config.hybridActivationTime || 1500,
    checkInterval: state.config.hybridCheckInterval || 30000,
    initialDelay: state.config.hybridInitialDelay || 30000
  };
}

// Record timeout performance and adjust if needed (adaptive learning)
async function recordTimeoutPerformance(platformName, timeoutUsed, responseTime, success, wasCutoff) {
  if (!platformName) return;
  
  const optimized = platformOptimizedTimeouts.get(platformName) || {
    activationTime: state.config.hybridActivationTime || 1500,
    checkInterval: state.config.hybridCheckInterval || 30000,
    initialDelay: state.config.hybridInitialDelay || 30000,
    successCount: 0,
    totalCount: 0,
    lastOptimized: Date.now()
  };
  
  optimized.totalCount = (optimized.totalCount || 0) + 1;
  if (success) {
    optimized.successCount = (optimized.successCount || 0) + 1;
  }
  
  // Adaptive adjustment logic
  const successRate = optimized.successCount / optimized.totalCount;
  const needsOptimization = optimized.totalCount >= 5; // Optimize after 5 attempts
  
  if (needsOptimization && Date.now() - (optimized.lastOptimized || 0) > 60000) { // Re-optimize every minute
    const defaultInterval = state.config.hybridCheckInterval || 30000;
    const defaultDelay = state.config.hybridInitialDelay || 30000;
    
    // Adjust based on response time and success rate
    if (wasCutoff && responseTime < timeoutUsed) {
      // Response was cut off - increase timeout
      optimized.checkInterval = Math.min(optimized.checkInterval * 1.2, defaultInterval * 2);
      optimized.initialDelay = Math.min(optimized.initialDelay * 1.2, defaultDelay * 2);
      bgLog(`[Optimization] ${platformName}: Increasing timeout (cutoff detected)`);
    } else if (success && responseTime < timeoutUsed * 0.5 && successRate > 0.8) {
      // Responses are fast and reliable - can decrease timeout
      optimized.checkInterval = Math.max(optimized.checkInterval * 0.9, defaultInterval * 0.5);
      optimized.initialDelay = Math.max(optimized.initialDelay * 0.9, defaultDelay * 0.5);
      bgLog(`[Optimization] ${platformName}: Decreasing timeout (fast responses)`);
    }
    
    optimized.lastOptimized = Date.now();
    platformOptimizedTimeouts.set(platformName, optimized);
    await saveOptimizedTimeouts();
  } else {
    platformOptimizedTimeouts.set(platformName, optimized);
  }
}

async function handleAIResponse(response, sessionNum, requestId) {
  bgLog('handleAIResponse from session:', sessionNum, 'requestId:', requestId);
  bgLog('Response length:', response.length);
  bgLog('Is active:', state.isActive);

  // If this is a backend request, forward to backend client
  if (requestId) {
    bgLog('Backend request detected, forwarding to backend client');
    
    // Get platform info for this session
    const participantIndex = state.participants.findIndex(p =>
      p && ((p.order === sessionNum) || (state.participants.indexOf(p) + 1 === sessionNum))
    );
    const platform = participantIndex >= 0 ? state.participants[participantIndex]?.platform : null;
    
    // Restore original active tab if we used delayed activation (for backend requests)
    if (participantIndex >= 0) {
      await restoreOriginalActiveTab(participantIndex);
    }
    
    pendingBackendRequests.set(requestId, { sessionNum, timestamp: Date.now(), platform });

    // Forward to backend client (will be handled by backend-client.js)
    chrome.runtime.sendMessage({
      type: 'AI_RESPONSE_FOR_BACKEND',
      requestId: requestId,
      response: response.trim(),
      platform: platform
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

  // Restore original active tab if we used delayed activation
  await restoreOriginalActiveTab(participantIndex);

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

  // Clean up any pending responses and restore original tabs
  for (const [participantIndex, pending] of pendingResponses.entries()) {
    if (pending.checkInterval) {
      clearInterval(pending.checkInterval);
    }
    if (pending.activationTimer) {
      clearTimeout(pending.activationTimer);
    }
    try {
      if (pending.originalActiveTabId) {
        const tab = await chrome.tabs.get(pending.originalActiveTabId);
        if (tab) {
          await chrome.tabs.update(pending.originalActiveTabId, { active: true });
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
  pendingResponses.clear();

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

// Try to send message to a tab (may be inactive)
async function trySendMessageToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Make a tab appear active to websites by overriding visibility APIs
// This allows background tabs to remain interactive
async function makeTabAppearActive(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Override document.hidden
        Object.defineProperty(document, 'hidden', {
          get: () => false,
          configurable: true
        });
        
        // Override document.visibilityState
        Object.defineProperty(document, 'visibilityState', {
          get: () => 'visible',
          configurable: true
        });
        
        // Override document.visibilitychange event
        // Prevent visibility change events from firing
        const originalAddEventListener = document.addEventListener;
        document.addEventListener = function(type, listener, options) {
          if (type === 'visibilitychange') {
            // Don't add visibilitychange listeners - they won't fire
            return;
          }
          return originalAddEventListener.call(this, type, listener, options);
        };
        
        // Override Page Visibility API methods
        if (document.webkitHidden !== undefined) {
          Object.defineProperty(document, 'webkitHidden', {
            get: () => false,
            configurable: true
          });
        }
        
        if (document.webkitVisibilityState !== undefined) {
          Object.defineProperty(document, 'webkitVisibilityState', {
            get: () => 'visible',
            configurable: true
          });
        }
        
        // Override window focus/blur events
        const originalWindowFocus = window.focus;
        window.focus = function() {
          // Always appear focused
          return originalWindowFocus.call(this);
        };
        
        // Override document.hasFocus
        if (document.hasFocus) {
          document.hasFocus = () => true;
        }
        
        console.log('[AI Bridge] Tab visibility overrides applied - tab will appear active to websites');
      }
    });
    
    bgLog(`Applied visibility overrides to tab ${tabId} - it will appear active to websites`);
    return { success: true };
  } catch (error) {
    bgWarn(`Failed to apply visibility overrides to tab ${tabId}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Get the currently active tab in the window
async function getCurrentActiveTab(windowId = null) {
  try {
    const query = windowId ? { active: true, windowId: windowId } : { active: true, currentWindow: true };
    const tabs = await chrome.tabs.query(query);
    return tabs.length > 0 ? tabs[0].id : null;
  } catch (error) {
    bgWarn('Failed to get current active tab:', error.message);
    return null;
  }
}

// Start periodic checking for response (for hybrid mode)
// Strategy: Briefly activate agent tab (configurable), check for response, restore original tab, wait (configurable), repeat
function startPeriodicChecking(participantIndex, agentTabId, originalActiveTabId, requestId) {
  const participant = state.participants[participantIndex];
  const platformName = participant?.platform || 'unknown';
  
  // Get optimized timeout for this platform
  const optimizedTimeout = getOptimizedTimeout(platformName);
  const checkInterval = optimizedTimeout.checkInterval;
  const briefActivationTime = optimizedTimeout.activationTime;
  
  let checkCount = 0;
  const maxChecks = Math.floor(360000 / checkInterval); // 6 minutes max
  let lastResponseLength = 0;
  let stableResponseCount = 0;
  const STABLE_THRESHOLD = 2; // Response must be stable for 2 checks
  const startTime = Date.now();
  
  bgLog(`Starting periodic checking for participant ${participantIndex + 1} (checks every 30s with 1.5s activation)`);
  
  const intervalId = setInterval(async () => {
    checkCount++;
    bgLog(`Periodic check #${checkCount} for participant ${participantIndex + 1}`);
    
    try {
      // Briefly activate agent tab to check for response (1.5 seconds)
      const agentTab = await chrome.tabs.get(agentTabId);
      const wasActive = agentTab.active;
      if (!wasActive) {
        bgLog(`Briefly activating agent tab ${agentTabId} for check #${checkCount} (1.5s)`);
        await chrome.tabs.update(agentTabId, { active: true });
        await new Promise(resolve => setTimeout(resolve, briefActivationTime)); // Wait 1.5s for activation and check
      } else {
        // Tab is already active, just wait a bit
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Check for response
      const checkResult = await chrome.tabs.sendMessage(agentTabId, { type: 'CHECK_RESPONSE' });
      
      // Restore original tab immediately after checking (unless response is complete)
      if (originalActiveTabId) {
        try {
          const originalTab = await chrome.tabs.get(originalActiveTabId);
          if (originalTab && !originalTab.active) {
            await chrome.tabs.update(originalActiveTabId, { active: true });
            bgLog(`Restored original tab after check #${checkCount}`);
          }
        } catch (restoreError) {
          // Ignore errors
        }
      }
      
      if (checkResult) {
        const currentResponseLength = checkResult.responseLength || 0;
        const isGenerating = checkResult.isGenerating || false;
        
        // Check if response is complete (not generating and response is stable)
        if (checkResult.hasResponse && checkResult.responseText && !isGenerating) {
          // Response length is stable (not changing)
          if (currentResponseLength === lastResponseLength) {
            stableResponseCount++;
            bgLog(`Response stable count: ${stableResponseCount}/${STABLE_THRESHOLD}, length: ${currentResponseLength}`);
            
            if (stableResponseCount >= STABLE_THRESHOLD) {
              // Response is complete and stable! Report it and restore original tab
              const responseTime = Date.now() - startTime;
              bgLog(`Response complete after ${checkCount} checks (${responseTime}ms), length: ${checkResult.responseText.length}`);
              
              // Stop checking
              clearInterval(intervalId);
              const pending = pendingResponses.get(participantIndex);
              if (pending) {
                pending.checkInterval = null;
              }
              
              // Restore original tab
              await restoreOriginalActiveTab(participantIndex);
              
              // Record successful response for optimization
              const totalTimeoutUsed = checkCount * checkInterval;
              await recordTimeoutPerformance(platformName, totalTimeoutUsed, responseTime, true, false);
              
              // Report the response (same as if content script reported it)
              const participant = state.participants[participantIndex];
              const sessionNum = participantIndex + 1; // 1-based
              await handleAIResponse(checkResult.responseText, sessionNum, requestId);
              
              return;
            }
          } else {
            // Response is still changing, reset stability counter
            stableResponseCount = 0;
            lastResponseLength = currentResponseLength;
            bgLog(`Response still changing, length: ${currentResponseLength}`);
          }
        } else if (isGenerating) {
          // Still generating, reset stability counter
          stableResponseCount = 0;
          bgLog(`Still generating response...`);
        } else {
          // No response yet
          stableResponseCount = 0;
          bgLog(`No response yet (check #${checkCount})`);
        }
      }
      
      // Update pending info
      const pending = pendingResponses.get(participantIndex);
      if (pending) {
        pending.checkCount = checkCount;
      }
      
      // Check timeout
      if (checkCount >= maxChecks) {
        const responseTime = Date.now() - startTime;
        bgWarn(`Periodic checking timeout after ${checkCount} checks (${responseTime}ms) for participant ${participantIndex + 1}`);
        clearInterval(intervalId);
        const pending = pendingResponses.get(participantIndex);
        if (pending) {
          pending.checkInterval = null;
        }
        
        // Record timeout failure for optimization (may need to increase timeout)
        const totalTimeoutUsed = checkCount * checkInterval;
        await recordTimeoutPerformance(platformName, totalTimeoutUsed, responseTime, false, true);
        
        await restoreOriginalActiveTab(participantIndex);
      }
    } catch (error) {
      bgError(`Error in periodic check for participant ${participantIndex + 1}:`, error.message);
      // Continue checking
    }
  }, checkInterval);
  
  // Store interval ID
  const pending = pendingResponses.get(participantIndex);
  if (pending) {
    pending.checkInterval = intervalId;
    pending.checkCount = 0;
  }
}

// Restore original active tab after response is received (cleanup function)
async function restoreOriginalActiveTab(participantIndex) {
  const pending = pendingResponses.get(participantIndex);
  if (!pending || !pending.originalActiveTabId) {
    return;
  }

  // Stop any active checking interval
  if (pending.checkInterval) {
    clearInterval(pending.checkInterval);
    pending.checkInterval = null;
  }

  // Restore original tab
  try {
    const tab = await chrome.tabs.get(pending.originalActiveTabId);
    if (tab) {
      bgLog(`Restoring original active tab ${pending.originalActiveTabId} for participant ${participantIndex + 1}`);
      await chrome.tabs.update(pending.originalActiveTabId, { active: true });
    }
  } catch (error) {
    bgLog(`Original tab ${pending.originalActiveTabId} no longer exists or can't be restored:`, error.message);
  }

  // Clean up timers
  if (pending.activationTimer) {
    clearTimeout(pending.activationTimer);
  }

  // Remove from map
  pendingResponses.delete(participantIndex);
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

    // Handle tab activation based on config mode
    const activateMode = state.config.activateTabs || 'hybrid'; // Default to 'hybrid' for backward compatibility
    
    if (activateMode === 'always') {
      // Always activate tabs before sending (recommended for reliability)
      await activateTabIfNeeded(participant.tabId);
      await chrome.tabs.sendMessage(participant.tabId, message);
      bgLog(`Message sent successfully to participant ${participantIndex + 1} (tab activated)`);
      return { success: true };
    } else if (activateMode === 'never') {
      // Never activate tabs - WARNING: This may not work reliably for response polling
      // Chrome throttles timers in inactive tabs, so polling may fail or be very slow
      bgWarn(`Sending to inactive tab ${participant.tabId} (polling may not work reliably)`);
      const result = await trySendMessageToTab(participant.tabId, message);
      if (result.success) {
        bgLog(`Message sent successfully to participant ${participantIndex + 1} (tab not activated - response polling may be unreliable)`);
        return { success: true };
      } else {
        bgError(`Failed to send to inactive tab ${participant.tabId}:`, result.error);
        return { success: false, error: `Failed to send to inactive tab: ${result.error}` };
      }
    } else {
      // 'hybrid' mode: Activate tab to send message and generate response, then periodically check
      // Strategy: Activate tab, send message, keep it active for generation, then restore when done
      
      bgLog(`Hybrid mode: Activating tab to send message to participant ${participantIndex + 1}...`);
      
      // Get current active tab to restore later
      const originalActiveTabId = await getCurrentActiveTab();
      
      // Get platform name for optimized timeouts
      const platformName = participant.platform || 'unknown';
      
      // Get optimized timeout for this platform, or use configured defaults
      const optimizedTimeout = getOptimizedTimeout(platformName);
      const activationTime = optimizedTimeout.activationTime;
      const initialDelay = optimizedTimeout.initialDelay;
      
      bgLog(`Using timeout for ${platformName}: activation=${activationTime}ms, initialDelay=${initialDelay}ms`);
      
      // Activate agent tab briefly (configurable time) to send message
      await activateTabIfNeeded(participant.tabId);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for tab to activate
      
      // Send message (tab is now active)
      try {
        await chrome.tabs.sendMessage(participant.tabId, message);
        bgLog(`Message sent successfully to participant ${participantIndex + 1} (tab activated)`);
      } catch (sendError) {
        bgError(`Failed to send message to participant ${participantIndex + 1}:`, sendError.message);
        // Restore original tab if we had one
        if (originalActiveTabId && originalActiveTabId !== participant.tabId) {
          try {
            await chrome.tabs.update(originalActiveTabId, { active: true });
          } catch (e) {
            // Ignore
          }
        }
        return { success: false, error: sendError.message };
      }
      
      // Wait remaining time to complete activation time
      const remainingTime = Math.max(0, activationTime - 500);
      await new Promise(resolve => setTimeout(resolve, remainingTime));
      
      // Restore original tab after brief activation
      if (originalActiveTabId && originalActiveTabId !== participant.tabId) {
        bgLog(`Restoring original active tab ${originalActiveTabId} after ${activationTime}ms activation`);
        try {
          await chrome.tabs.update(originalActiveTabId, { active: true });
          bgLog(`Original tab ${originalActiveTabId} restored`);
        } catch (restoreError) {
          bgWarn(`Failed to restore original tab:`, restoreError.message);
        }
        
        // Clean up any existing pending response for this participant
        const existingPending = pendingResponses.get(participantIndex);
        if (existingPending) {
          if (existingPending.activationTimer) clearTimeout(existingPending.activationTimer);
          if (existingPending.checkInterval) clearInterval(existingPending.checkInterval);
        }
        
        // Start periodic checking after configured initial delay
        const delayTimer = setTimeout(() => {
          startPeriodicChecking(participantIndex, participant.tabId, originalActiveTabId, requestId);
        }, initialDelay);
        
        // Store pending response info
        pendingResponses.set(participantIndex, {
          originalActiveTabId: originalActiveTabId,
          activationTimer: delayTimer,
          activatedAt: null,
          restoredAt: null,
          checkInterval: null,
          checkCount: 0,
          lastResponseText: ''
        });
      }
      
      bgLog(`Message sent successfully to participant ${participantIndex + 1} (hybrid mode - original tab restored, periodic checking will start)`);
      return { success: true };
    }
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
  // Filter out empty participants (no tabId) for consistency with storage
  const validParticipants = state.participants.filter(p => p && p.tabId && p.tabId !== null);
  
  return {
    isActive: state.isActive,
    participants: validParticipants.map(p => ({
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
  // Handle backward compatibility: convert boolean activateTabs to string mode
  if (typeof newConfig.activateTabs === 'boolean') {
    newConfig.activateTabs = newConfig.activateTabs ? 'always' : 'never';
    bgLog('Converting boolean activateTabs to mode:', newConfig.activateTabs);
  }
  
  state.config = { ...state.config, ...newConfig };
  
  // Ensure activateTabs has a valid value
  if (!state.config.activateTabs || !['always', 'never', 'hybrid'].includes(state.config.activateTabs)) {
    state.config.activateTabs = 'hybrid';
  }
  
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
  const stateUpdate = getStateWithTabIds();

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
      'participants',
      'registeredAgentUrls',
      'selectedPlatformUrls',
      'autoOpenSettings'
    ]);

    if (result.conversationHistory) {
      state.conversationHistory = result.conversationHistory;
    }
    if (result.config) {
      state.config = { ...state.config, ...result.config };
      
      // Handle backward compatibility: convert boolean activateTabs to string mode
      if (typeof state.config.activateTabs === 'boolean') {
        state.config.activateTabs = state.config.activateTabs ? 'always' : 'never';
        bgLog('Converting boolean activateTabs to mode during restore:', state.config.activateTabs);
        await chrome.storage.local.set({ config: state.config }); // Save converted value
      }
      
      // Ensure activateTabs has a valid value
      if (!state.config.activateTabs || !['always', 'never', 'hybrid'].includes(state.config.activateTabs)) {
        state.config.activateTabs = 'hybrid';
      }
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

    // Restore registered agent URLs (legacy)
    if (result.registeredAgentUrls && Array.isArray(result.registeredAgentUrls)) {
      state.registeredAgentUrls = result.registeredAgentUrls;
      bgLog('Restored registered URLs from storage:', state.registeredAgentUrls.length);
    }

    // Restore selected platform URLs
    if (result.selectedPlatformUrls && Array.isArray(result.selectedPlatformUrls)) {
      state.selectedPlatformUrls = result.selectedPlatformUrls;
      bgLog('Restored selected platform URLs from storage:', state.selectedPlatformUrls.length);
    }

    // Restore auto-open settings
    if (result.autoOpenSettings) {
      state.autoOpenSettings = { ...state.autoOpenSettings, ...result.autoOpenSettings };
      bgLog('Restored auto-open settings:', state.autoOpenSettings);
    }

    // Restore participants (new system)
    if (result.participants && Array.isArray(result.participants)) {
      // Verify tabs still exist and filter out invalid ones
      // Also filter out empty participants (no tabId) - we don't want to restore empty slots
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
          // Empty slot (no tabId) - skip it, we don't want to restore empty slots
          bgLog('Skipping empty participant slot during restore');
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
  'kimi.com',
  'you.com',
  'chat.qwen.ai'
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
    if (hostname.includes('you.com')) return 'youcom';
    if (hostname.includes('qwen.ai') || hostname.includes('chat.qwen.ai')) return 'qwen';
    return null;
  } catch {
    return null;
  }
}

// Get list of all supported platform URLs (from host_permissions)
function getSupportedPlatformUrls() {
  return [
    { url: 'https://gemini.google.com/', name: 'Google Gemini', platform: 'gemini', icon: '✨' },
    { url: 'https://chatgpt.com/', name: 'ChatGPT', platform: 'chatgpt', icon: '🤖' },
    { url: 'https://chat.openai.com/', name: 'ChatGPT (OpenAI)', platform: 'chatgpt', icon: '🤖' },
    { url: 'https://chat.deepseek.com/', name: 'DeepSeek', platform: 'deepseek', icon: '🔍' },
    { url: 'https://duck.ai/', name: 'DuckDuckGo AI', platform: 'duckduckgo', icon: '🦆' },
    { url: 'https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1', name: 'DuckDuckGo AI (Full)', platform: 'duckduckgo', icon: '🦆' },
    { url: 'https://chat.z.ai/', name: 'Z.ai', platform: 'zai', icon: '⚡' },
    { url: 'https://www.kimi.com/', name: 'Kimi', platform: 'kimi', icon: '🌟' },
    { url: 'https://you.com/?chatMode=default', name: 'You.com', platform: 'youcom', icon: '💬' },
    { url: 'https://chat.qwen.ai/', name: 'Qwen', platform: 'qwen', icon: '🔮' }
  ];
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
    
    // You.com: https://you.com/?chatMode=default
    if (hostname.includes('you.com')) {
      return 'https://you.com/?chatMode=default';
    }
    
    // Qwen: https://chat.qwen.ai/
    if (hostname.includes('qwen.ai') || hostname.includes('chat.qwen.ai')) {
      return 'https://chat.qwen.ai/';
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

// Load optimized timeouts on startup
loadOptimizedTimeouts();

// ============================================
// AUTO-OPEN REGISTERED URLS
// ============================================

// Open selected platform URLs (for browser startup or manual trigger)
async function openSelectedPlatforms(context = 'manual') {
  bgLog('Opening selected platform URLs, context:', context);

  if (state.selectedPlatformUrls.length === 0) {
    bgLog('No selected platform URLs to open');
    return { success: true, opened: 0 };
  }

  let opened = 0;
  for (const url of state.selectedPlatformUrls) {
    try {
      // Check if URL is already open by checking all tabs
      const allTabs = await chrome.tabs.query({});
      const urlAlreadyOpen = allTabs.some(tab => {
        if (!tab.url) return false;
        try {
          const tabUrl = new URL(tab.url);
          const selectedUrl = new URL(url);
          // Compare hostname to see if same platform
          return tabUrl.hostname === selectedUrl.hostname && isChatPlatform(tab.url);
        } catch {
          return false;
        }
      });

      if (urlAlreadyOpen) {
        bgLog('URL already open:', url);
        continue;
      }

      // Open the URL
      await chrome.tabs.create({
        url: url,
        active: false
      });
      opened++;
      bgLog('Opened URL:', url);
    } catch (e) {
      bgError('Failed to open URL:', url, e.message);
    }
  }

  bgLog('Opened', opened, 'selected platform URLs');
  return { success: true, opened: opened };
}

// Open registered URLs (for browser startup or manual trigger) - legacy function
async function openRegisteredUrls(context = 'manual') {
  bgLog('Opening registered URLs, context:', context);

  if (state.registeredAgentUrls.length === 0) {
    bgLog('No registered URLs to open');
    return { success: true, opened: 0 };
  }

  let opened = 0;
  for (const urlInfo of state.registeredAgentUrls) {
    try {
      // Check if URL is already open by checking all tabs
      const allTabs = await chrome.tabs.query({});
      const urlAlreadyOpen = allTabs.some(tab => {
        if (!tab.url) return false;
        try {
          const tabUrl = new URL(tab.url);
          const registeredUrl = new URL(urlInfo.url);
          // Compare hostname to see if same platform
          return tabUrl.hostname === registeredUrl.hostname && isChatPlatform(tab.url);
        } catch {
          return false;
        }
      });

      if (urlAlreadyOpen) {
        bgLog('URL already open:', urlInfo.url);
        continue;
      }

      // Open the URL
      await chrome.tabs.create({
        url: urlInfo.url,
        active: false
      });
      opened++;
      bgLog('Opened URL:', urlInfo.url);
    } catch (e) {
      bgError('Failed to open URL:', urlInfo.url, e.message);
    }
  }

  bgLog('Opened', opened, 'URLs');
  return { success: true, opened: opened };
}

// Open selected platform URLs in tabs that currently have no agents
async function openInEmptyTabs() {
  bgLog('Opening selected platform URLs in empty tabs...');

  if (state.selectedPlatformUrls.length === 0) {
    bgLog('No selected platform URLs to open');
    return { success: true, opened: 0, message: 'No platforms selected. Please select platforms first.' };
  }

  // Get all tabs
  const allTabs = await chrome.tabs.query({});
  
  // Find tabs that are not chat platforms (empty tabs)
  const emptyTabs = allTabs.filter(tab => {
    if (!tab.url) return false;
    if (tab.url.startsWith('chrome://')) return false;
    if (tab.url.startsWith('chrome-extension://')) return false;
    if (tab.url.startsWith('about:')) return false;
    // Check if it's already a chat platform
    return !isChatPlatform(tab.url);
  });

  bgLog('Found empty tabs:', emptyTabs.length);

  if (emptyTabs.length === 0) {
    bgLog('No empty tabs found');
    return { success: true, opened: 0, message: 'No empty tabs available' };
  }

  let opened = 0;
  const urlsToOpen = state.selectedPlatformUrls.slice(0, emptyTabs.length); // Limit to available empty tabs

  for (let i = 0; i < urlsToOpen.length && i < emptyTabs.length; i++) {
    try {
      const url = urlsToOpen[i];
      const emptyTab = emptyTabs[i];

      // Check if URL is already open in another tab
      const urlAlreadyOpen = allTabs.some(tab => {
        if (!tab.url || tab.id === emptyTab.id) return false;
        try {
          const tabUrl = new URL(tab.url);
          const selectedUrl = new URL(url);
          // Compare hostname to see if same platform
          return tabUrl.hostname === selectedUrl.hostname && isChatPlatform(tab.url);
        } catch {
          return false;
        }
      });

      if (urlAlreadyOpen) {
        bgLog('URL already open, skipping:', url);
        continue;
      }

      // Update the empty tab with the selected platform URL
      await chrome.tabs.update(emptyTab.id, {
        url: url
      });
      opened++;
      bgLog('Opened URL in empty tab:', url, 'tab:', emptyTab.id);
    } catch (e) {
      bgError('Failed to open URL in empty tab:', e.message);
    }
  }

  bgLog('Opened', opened, 'URLs in empty tabs');
  return { success: true, opened: opened };
}

// Listen for browser startup
chrome.runtime.onStartup.addListener(async () => {
  bgLog('Browser startup detected');
  
  // Restore state first
  await restoreStateFromStorage();
  
  // Check if auto-open on startup is enabled
  if (state.autoOpenSettings.openOnBrowserStart) {
    bgLog('Auto-open on startup enabled, opening selected platform URLs...');
    setTimeout(() => {
      openSelectedPlatforms('startup');
    }, 2000); // Wait 2 seconds for browser to fully start
  }
});

// Also check on extension startup (not just browser startup)
chrome.runtime.onInstalled.addListener(async () => {
  // Restore state
  await restoreStateFromStorage();
  
  // Check if we should auto-open (for cases where extension is reloaded)
  // Only do this if there are no existing chat tabs
  const allTabs = await chrome.tabs.query({});
  const chatTabs = allTabs.filter(tab => tab.url && isChatPlatform(tab.url));
  
  if (chatTabs.length === 0 && state.autoOpenSettings.openOnBrowserStart) {
    bgLog('No chat tabs found, auto-opening selected platform URLs...');
    setTimeout(() => {
      openSelectedPlatforms('install');
    }, 2000);
  }
});
