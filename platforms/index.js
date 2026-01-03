// Platform Registry
// Manages all platform adapters and auto-detection

const PlatformRegistry = {
  adapters: [],

  // Register a new adapter
  register(AdapterClass) {
    try {
      const adapter = new AdapterClass();
      this.adapters.push(adapter);
      // console.log(`[AI Bridge] Registered platform: ${adapter.name}`);
      if (window.logAIBridge) window.logAIBridge('PlatformRegistry', 'INFO', `Registered platform: ${adapter.name}`);
    } catch (error) {
      // console.error(`[AI Bridge] Failed to register adapter:`, error);
      if (window.logAIBridge) window.logAIBridge('PlatformRegistry', 'ERROR', `Failed to register adapter: ${error.message}`);
    }
  },

  // Detect platform from current hostname
  detect() {
    const hostname = window.location.hostname;
    const url = window.location.href;
    // console.log(`[AI Bridge] Detecting platform for: ${hostname}`);
    if (window.logAIBridge) window.logAIBridge('PlatformRegistry', 'INFO', `Detecting platform for: ${hostname}`);

    for (const adapter of this.adapters) {
      if (adapter.matches(hostname)) {
        // Special check for DuckDuckGo - only match on AI chat pages
        if (adapter.name === 'duckduckgo') {
          const isDuckAiHost = hostname.includes('duck.ai');
          const hasChatParam = url.includes('ia=chat') || url.includes('duckai');
          if (!hasChatParam && !isDuckAiHost) {
            continue; // Skip DuckDuckGo adapter for non-chat pages
          }
        }
        // console.log(`[AI Bridge] Detected platform: ${adapter.name}`);
        if (window.logAIBridge) window.logAIBridge('PlatformRegistry', 'INFO', `Detected platform: ${adapter.name}`);
        return adapter;
      }
    }

    // console.warn(`[AI Bridge] No platform adapter found for: ${hostname}`);
    if (window.logAIBridge) window.logAIBridge('PlatformRegistry', 'WARN', `No platform adapter found for: ${hostname}`);
    return null;
  },

  // Get adapter by name
  getByName(name) {
    return this.adapters.find(a => a.name === name);
  },

  // Get list of all supported platforms
  getSupportedPlatforms() {
    return this.adapters.map(a => ({
      name: a.name,
      patterns: a.hostPatterns
    }));
  }
};

// ============================================
// REGISTER ALL ADAPTERS
// Order matters - first match wins
// ============================================

// Google Gemini
if (typeof GeminiAdapter !== 'undefined') {
  PlatformRegistry.register(GeminiAdapter);
}

// OpenAI ChatGPT
if (typeof ChatGPTAdapter !== 'undefined') {
  PlatformRegistry.register(ChatGPTAdapter);
}

// DeepSeek
if (typeof DeepSeekAdapter !== 'undefined') {
  PlatformRegistry.register(DeepSeekAdapter);
}

// DuckDuckGo AI (Duck.ai)
if (typeof DuckDuckGoAdapter !== 'undefined') {
  PlatformRegistry.register(DuckDuckGoAdapter);
}

// Z.ai
if (typeof ZAIAdapter !== 'undefined') {
  PlatformRegistry.register(ZAIAdapter);
}

// Kimi
if (typeof KimiAdapter !== 'undefined') {
  PlatformRegistry.register(KimiAdapter);
}

// ============================================
// HOW TO ADD NEW PLATFORMS:
// 1. Create new adapter file in platforms/ folder
// 2. Follow the template in template-adapter.js.example
// 3. Add registration line above
// 4. Update manifest.json with new URLs
// ============================================

// Export for global access
window.PlatformRegistry = PlatformRegistry;

// console.log('[AI Bridge] Platform Registry initialized');
// console.log('[AI Bridge] Supported platforms:', PlatformRegistry.getSupportedPlatforms().map(p => p.name).join(', '));
if (window.logAIBridge) {
  window.logAIBridge('PlatformRegistry', 'INFO', 'Platform Registry initialized');
  window.logAIBridge('PlatformRegistry', 'INFO', 'Supported platforms: ' + PlatformRegistry.getSupportedPlatforms().map(p => p.name).join(', '));
}
