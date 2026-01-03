// Centralized Logger for AI Chat Bridge
// Collects logs from all components for easy debugging

(function() {
  'use strict';
  
  const MAX_LOGS = 500; // Keep last 500 logs
  
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
      console.log(`[${this.source}]`, ...args);
    },
    
    // Add warning
    warn(...args) {
      const entry = this._createEntry('WARN', args);
      this._addLog(entry);
      console.warn(`[${this.source}]`, ...args);
    },
    
    // Add error
    error(...args) {
      const entry = this._createEntry('ERROR', args);
      this._addLog(entry);
      console.error(`[${this.source}]`, ...args);
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
    
    // Add log to array and save
    _addLog(entry) {
      this.logs.push(entry);
      
      // Trim if too many
      if (this.logs.length > MAX_LOGS) {
        this.logs = this.logs.slice(-MAX_LOGS);
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
          chrome.storage.local.set({ debugLogs: this.logs });
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
      const filename = `ai-bridge-logs-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.${format === 'json' ? 'json' : 'log'}`;
      
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
  window.logAIBridge = function(source, level, ...args) {
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
      }).catch(() => {});
    }
  };
  
})();

