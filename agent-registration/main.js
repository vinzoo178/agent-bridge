// Agent Registration - Main Entry Point
(function () {
    'use strict';

    // Dependencies
    window.AIBridge = window.AIBridge || {};
    const state = window.AIBridge.state;
    const UI = window.AIBridge.ui;
    const Actions = window.AIBridge; // Attached directly

    // Safe logging wrapper
    function safeLog(level, message) {
        try {
            const logFn = window.AIBridge && window.AIBridge.sendLog;
            if (logFn && typeof logFn === 'function') {
                try {
                    logFn(level, message);
                    return;
                } catch (e) {
                    // Fallback to console if sendLog fails
                }
            }
        } catch (e) {
            // Ignore errors accessing window.AIBridge
        }
        
        // Fallback to console if sendLog is not available or fails
        try {
            const consoleMethod = console[level.toLowerCase()] || console.log;
            consoleMethod('[AI Bridge Registration]', message);
        } catch (e) {
            // Last resort - do nothing if even console fails
        }
    }

    if (!state || !UI || !Actions.checkExistingRegistration) {
        safeLog('ERROR', '[AI Bridge Registration] Missing dependencies for main.js');
        return;
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    function init() {
        safeLog('INFO', '[AI Bridge Registration] Initializing...');
        safeLog('INFO', 'Initializing registration module...');

        // Proactively register to pool when page loads
        const registerToPoolDelayed = () => {
            setTimeout(() => {
                // Only register if not already registered/assigned
                if (!state.isRegistered) {
                    Actions.registerToPool();
                }
            }, 2000); // Wait 2 seconds for page to fully load
        };

        // Initialize Overlay
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initOverlayAndChecks, 1000);
                registerToPoolDelayed();
            });
        } else {
            setTimeout(initOverlayAndChecks, 1000);
            registerToPoolDelayed();
        }
    }

    function initOverlayAndChecks() {
        UI.createOverlay();

        // Check registration status immediately
        Actions.checkExistingRegistration();

        // Also check after a short delay
        setTimeout(() => {
            if (!state.isRegistered) {
                Actions.checkExistingRegistration();
            }
        }, 1000);

        // Fallback check after longer delay
        setTimeout(() => {
            if (!state.isRegistered) {
                Actions.checkExistingRegistration();
                // Update status text
                const registrationStatusText = document.getElementById('registration-status-text');
                if (registrationStatusText) {
                    registrationStatusText.textContent = 'Waiting for assignment...';
                }
            }
        }, 5000);

        // Periodic check every 2 seconds if not registered
        const periodicCheckInterval = setInterval(() => {
            if (!state.isRegistered) {
                Actions.checkExistingRegistration();
            } else {
                clearInterval(periodicCheckInterval);
            }
        }, 2000);

        // Stop periodic check after 30 seconds
        setTimeout(() => {
            clearInterval(periodicCheckInterval);
        }, 30000);

        // Check when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                Actions.checkExistingRegistration();
            }
        });

        // Start extension availability checker
        startExtensionAvailabilityChecker();

        // Message Listener
        setupMessageListener();
    }

    function startExtensionAvailabilityChecker() {
        let extensionReloadCheckInterval = null;
        let lastRuntimeAvailable = true;

        function checkExtensionAvailability() {
            try {
                if (!chrome.runtime || !chrome.runtime.sendMessage) {
                    throw new Error('Extension context invalidated');
                }

                chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
                    if (chrome.runtime.lastError) {
                        const errorMsg = chrome.runtime.lastError.message;
                        const isContextInvalidated = errorMsg && (
                            errorMsg.includes('Extension context invalidated') ||
                            errorMsg.includes('message port closed')
                        );

                        if (isContextInvalidated) {
                            clearInterval(extensionReloadCheckInterval);
                            safeLog('INFO', '[AI Bridge Registration] Extension context invalidated. Stopping checks.');

                            if (UI.updateReloadRequiredUI) {
                                UI.updateReloadRequiredUI();
                            }
                            return;
                        }

                        if (lastRuntimeAvailable) {
                            safeLog('INFO', '[AI Bridge Registration] Extension is unavailable...');
                            lastRuntimeAvailable = false;
                        }
                    } else {
                        if (!lastRuntimeAvailable) {
                            safeLog('INFO', '[AI Bridge Registration] Extension reloaded - refreshing status');
                            lastRuntimeAvailable = true;
                            Actions.checkExistingRegistration();
                            setTimeout(Actions.checkExistingRegistration, 1000);
                        }
                    }
                });
            } catch (e) {
                if (e.message.includes('Extension context invalidated')) {
                    clearInterval(extensionReloadCheckInterval);
                    safeLog('INFO', '[AI Bridge Registration] Extension context invalidated (sync).');
                    
                    if (UI.updateReloadRequiredUI) {
                        UI.updateReloadRequiredUI();
                    }
                }
            }
        }

        extensionReloadCheckInterval = setInterval(checkExtensionAvailability, 2000);
        try { checkExtensionAvailability(); } catch (e) { }
    }

    function setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            safeLog('INFO', '[AI Bridge Registration] Received message: ' + message.type);

            if (message.type === 'STATE_UPDATE') {
                UI.updateActionStatusFromState(message.state);
                return false;
            } else if (message.type === 'REGISTRATION_CONFIRMED') {
                safeLog('INFO', '[AI Bridge Registration] Registration confirmed: ' + JSON.stringify(message));
                safeLog('INFO', 'Registration confirmed: Session ' + message.sessionNum);
                state.isRegistered = true;
                state.sessionNum = message.sessionNum;
                const role = message.role || `Participant ${message.sessionNum}`;

                UI.updateRegisteredUI(message.sessionNum, role);

                window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
                    detail: {
                        sessionNum: message.sessionNum,
                        platform: message.platform || state.platform,
                        role: role,
                        order: message.order
                    }
                }));

                safeLog('INFO', 'UI updated after REGISTRATION_CONFIRMED');
                return false;
            } else if (message.type === 'REGISTERED_TO_POOL') {
                safeLog('INFO', '[AI Bridge Registration] Registered to pool');
                safeLog('INFO', 'Registered to pool');
                state.isRegistered = false;
                state.sessionNum = null;

                UI.updatePoolRegisteredUI();
                return false;
            } else if (message.type === 'REMOVED_FROM_POOL') {
                safeLog('INFO', '[AI Bridge Registration] Removed from pool');
                safeLog('INFO', 'Removed from pool');

                UI.updateUnregisteredUI();
                return false;
            } else if (message.type === 'REMOVED_FROM_CONVERSATION') {
                safeLog('INFO', '[AI Bridge Registration] Removed from conversation');
                safeLog('INFO', 'Removed from conversation');
                state.isRegistered = false;
                state.sessionNum = null;

                UI.updateUnregisteredUI();
                return false;
            }

            return false;
        });
    }

    // Start everything
    init();

})();
