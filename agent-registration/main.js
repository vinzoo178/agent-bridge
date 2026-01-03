// Agent Registration - Main Entry Point
(function () {
    'use strict';

    // Dependencies
    window.AIBridge = window.AIBridge || {};
    const state = window.AIBridge.state;
    const sendLog = window.AIBridge.sendLog;
    const UI = window.AIBridge.ui;
    const Actions = window.AIBridge; // Attached directly

    if (!state || !UI || !Actions.checkExistingRegistration) {
        sendLog.bind(null, 'ERROR')('[AI Bridge Registration] Missing dependencies for main.js');
        return;
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    function init() {
        sendLog.bind(null, 'INFO')('[AI Bridge Registration] Initializing...');
        sendLog('INFO', 'Initializing registration module...');

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
                            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Extension context invalidated. Stopping checks.');

                            const statusText = document.getElementById('overlay-status-text');
                            if (statusText) statusText.textContent = '❌ Reload Required';

                            const actionStatus = document.getElementById('action-status');
                            if (actionStatus) {
                                actionStatus.textContent = 'Extension updated. Please refresh page.';
                                actionStatus.style.color = '#ef4444';
                                actionStatus.style.fontWeight = 'bold';
                            }
                            return;
                        }

                        if (lastRuntimeAvailable) {
                            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Extension is unavailable...');
                            lastRuntimeAvailable = false;
                        }
                    } else {
                        if (!lastRuntimeAvailable) {
                            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Extension reloaded - refreshing status');
                            lastRuntimeAvailable = true;
                            Actions.checkExistingRegistration();
                            setTimeout(Actions.checkExistingRegistration, 1000);
                        }
                    }
                });
            } catch (e) {
                if (e.message.includes('Extension context invalidated')) {
                    clearInterval(extensionReloadCheckInterval);
                    sendLog.bind(null, 'INFO')('[AI Bridge Registration] Extension context invalidated (sync).');
                    // Update UI to show error (simplified here)
                    const statusText = document.getElementById('overlay-status-text');
                    if (statusText) statusText.textContent = '❌ Reload Required';
                }
            }
        }

        extensionReloadCheckInterval = setInterval(checkExtensionAvailability, 2000);
        try { checkExtensionAvailability(); } catch (e) { }
    }

    function setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Received message:', message.type);

            if (message.type === 'STATE_UPDATE') {
                UI.updateActionStatusFromState(message.state);
                return false;
            } else if (message.type === 'REGISTRATION_CONFIRMED') {
                sendLog.bind(null, 'INFO')('[AI Bridge Registration] Registration confirmed:', message);
                sendLog('INFO', 'Registration confirmed: Session ' + message.sessionNum);
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

                sendLog('INFO', 'UI updated after REGISTRATION_CONFIRMED');
                return false;
            } else if (message.type === 'REGISTERED_TO_POOL') {
                sendLog.bind(null, 'INFO')('[AI Bridge Registration] Registered to pool');
                sendLog('INFO', 'Registered to pool');
                state.isRegistered = false;
                state.sessionNum = null;

                UI.updatePoolRegisteredUI();
                return false;
            } else if (message.type === 'REMOVED_FROM_POOL') {
                sendLog.bind(null, 'INFO')('[AI Bridge Registration] Removed from pool');
                sendLog('INFO', 'Removed from pool');

                UI.updateUnregisteredUI();
                return false;
            } else if (message.type === 'REMOVED_FROM_CONVERSATION') {
                sendLog.bind(null, 'INFO')('[AI Bridge Registration] Removed from conversation');
                sendLog('INFO', 'Removed from conversation');
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
