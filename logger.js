// Centralized Logger for AI Chat Bridge
// Collects logs from all components for easy debugging

(function () {
  'use strict';

  const MAX_LOGS = 500; // Keep last 500 logs
  const CLEANUP_THRESHOLD = 0.9; // Clean logs when reaching 90% of MAX_LOGS (proactive cleanup)

  // Logger instance
  const Logger = {
    logs: [],
    source: 'unknown',

    // Initialize with source name
    init(sourceName) {
      this.source = sourceName;
      this.log('Logger initialized');

      // Load existing logs from storage (for sidepanel)
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['debugLogs'], (result) => {
          if (result.debugLogs) {
            this.logs = result.debugLogs;
          }
        });
      }
    },

    // Add log entry
    log(...args) {
      const entry = this._createEntry('INFO', args);
      this._addLog(entry);
      // console.log(`[${this.source}]`, ...args);
    },

    // Add warning
    warn(...args) {
      const entry = this._createEntry('WARN', args);
      this._addLog(entry);
      // console.warn(`[${this.source}]`, ...args);
    },

    // Add error
    error(...args) {
      const entry = this._createEntry('ERROR', args);
      this._addLog(entry);
      // console.error(`[${this.source}]`, ...args);
    },

    // Add debug (verbose)
    debug(...args) {
      const entry = this._createEntry('DEBUG', args);
      this._addLog(entry);
      // Don't console.log debug to avoid spam
    },

    // Create log entry
    _createEntry(level, args) {
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');

      return {
        timestamp: new Date().toISOString(),
        level: level,
        source: this.source,
        message: message
      };
    },

    // Automatic log cleanup function - cleans logs proactively and on errors
    _cleanupLogs(reason = 'auto', targetSize = null) {
      const beforeCount = this.logs.length;
      const cleanupThreshold = targetSize || Math.floor(MAX_LOGS * CLEANUP_THRESHOLD);
      
      if (this.logs.length > cleanupThreshold) {
        // Keep the most recent logs (prioritize ERROR/WARN if needed)
        const logsToKeep = Math.max(cleanupThreshold, Math.floor(MAX_LOGS * 0.8));
        const removedCount = this.logs.length - logsToKeep;
        
        // Keep ERROR/WARN logs and recent logs
        const errorWarnLogs = this.logs.filter(log => log.level === 'ERROR' || log.level === 'WARN');
        const recentLogs = this.logs.slice(-logsToKeep);
        
        // Combine: prefer ERROR/WARN, then recent logs
        const combined = [...errorWarnLogs, ...recentLogs];
        const uniqueLogs = Array.from(
          new Map(combined.map(log => [log.timestamp, log])).values()
        );
        
        // Sort by timestamp and keep the target size
        this.logs = uniqueLogs
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
          .slice(-logsToKeep);
        
        const afterCount = this.logs.length;
        if (beforeCount !== afterCount) {
          console.log(`[Logger] Cleaned ${removedCount} logs (${beforeCount} → ${afterCount}) - reason: ${reason}`);
        }
      }
      
      return { beforeCount, afterCount: this.logs.length, removed: beforeCount - this.logs.length };
    },

    // Add log to array and save
    _addLog(entry) {
      this.logs.push(entry);

      // Proactive cleanup: clean logs when reaching 90% of MAX_LOGS
      // This prevents hitting the hard limit and improves performance
      if (this.logs.length >= Math.floor(MAX_LOGS * CLEANUP_THRESHOLD)) {
        this._cleanupLogs('auto-threshold');
      }
      
      // Hard limit: ensure we never exceed MAX_LOGS (safety net)
      if (this.logs.length > MAX_LOGS) {
        this._cleanupLogs('max-limit', MAX_LOGS);
      }

      // Save to storage (debounced)
      this._saveToStorage();
    },

    // Save logs to storage (debounced)
    _saveTimeout: null,
    _saveToStorage() {
      if (this._saveTimeout) clearTimeout(this._saveTimeout);

      this._saveTimeout = setTimeout(() => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // Proactive cleanup before saving
          this._cleanupLogs('pre-save');
          
          // Save with error handling for quota issues
          chrome.storage.local.set({ debugLogs: this.logs }).catch((e) => {
            // Handle quota errors with automatic cleanup
            if (e.message && e.message.includes('QUOTA_BYTES')) {
              console.warn('[Logger] Storage quota exceeded, cleaning logs and retrying');
              // Clean logs more aggressively (keep only 70% of MAX_LOGS)
              const aggressiveCleanupSize = Math.floor(MAX_LOGS * 0.7);
              this._cleanupLogs('quota-error', aggressiveCleanupSize);
              
              // Retry with cleaned logs
              chrome.storage.local.set({ debugLogs: this.logs }).catch((e2) => {
                console.error('[Logger] Failed to save logs even after cleanup:', e2);
                // Last resort: keep only ERROR logs
                const errorLogs = this.logs.filter(log => log.level === 'ERROR').slice(-Math.floor(MAX_LOGS * 0.5));
                chrome.storage.local.set({ debugLogs: errorLogs }).catch((e3) => {
                  console.error('[Logger] Critical: Could not save any logs to storage:', e3);
                });
              });
            } else {
              console.error('[Logger] Failed to save logs:', e);
            }
          });
        }
      }, 1000);
    },

    // Get all logs
    getLogs() {
      return this.logs;
    },

    // Clear all logs
    clearLogs() {
      this.logs = [];
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ debugLogs: [] });
      }
    },

    // Export logs as text
    exportAsText() {
      const lines = this.logs.map(log =>
        `[${log.timestamp}] [${log.level}] [${log.source}] ${log.message}`
      );
      return lines.join('\n');
    },

    // Export logs as JSON
    exportAsJSON() {
      return JSON.stringify(this.logs, null, 2);
    },

    // Download logs
    download(format = 'text') {
      const content = format === 'json' ? this.exportAsJSON() : this.exportAsText();
      const filename = `ai-bridge-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${format === 'json' ? 'json' : 'log'}`;

      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return filename;
    }
  };

  // Export globally
  window.AIBridgeLogger = Logger;

  // Also provide static method to add logs from anywhere
  window.logAIBridge = function (source, level, ...args) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level,
      source: source,
      message: args.map(arg => {
        if (typeof arg === 'object') {
          try { return JSON.stringify(arg); } catch (e) { return String(arg); }
        }
        return String(arg);
      }).join(' ')
    };

    // Send to background for central storage
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'ADD_LOG',
        entry: entry
      }).catch(() => { });
    }
  };

})();

