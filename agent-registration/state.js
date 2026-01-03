// Agent Registration - State & Utils
(function () {
    'use strict';

    window.AIBridge = window.AIBridge || {};

    // Helpers
    function sendLog(level, message) {
        try {
            setTimeout(() => {
                try {
                    chrome.runtime.sendMessage({
                        type: 'ADD_LOG',
                        entry: {
                            timestamp: new Date().toISOString(),
                            level: level,
                            source: 'Registration',
                            message: message
                        }
                    }, () => {
                        if (chrome.runtime.lastError) { /* Silently ignore */ }
                    });
                } catch (e) { /* Silently ignore */ }
            }, 0);
        } catch (e) { /* Silently ignore */ }
    }

    // Platform Detection
    function detectPlatformLegacy() {
        const url = window.location.hostname;
        if (url.includes('gemini.google.com')) return 'gemini';
        if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
        if (url.includes('deepseek.com')) return 'deepseek';
        return 'unknown';
    }

    let platformAdapter = null;
    if (window.PlatformRegistry) {
        platformAdapter = window.PlatformRegistry.detect();
    }

    const state = {
        sessionNum: null,
        isRegistered: false,
        platform: platformAdapter ? platformAdapter.name : detectPlatformLegacy(),
        inPool: false
    };

    // Expose to global namespace
    window.AIBridge.state = state;
    window.AIBridge.adapter = platformAdapter;
    window.AIBridge.platform = state.platform;
    window.AIBridge.sendLog = sendLog;

    console.log('[AI Bridge Registration] Platform:', state.platform);
    console.log('[AI Bridge Registration] Adapter:', platformAdapter ? 'Found' : 'Legacy mode');
})();
