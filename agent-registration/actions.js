// Agent Registration - Actions & Logic
(function () {
    'use strict';

    window.AIBridge = window.AIBridge || {};
    const state = window.AIBridge.state;
    const sendLog = window.AIBridge.sendLog;
    const UI = window.AIBridge.ui;

    // Safe logging wrapper - uses window.AIBridge.sendLog directly to avoid scope issues
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

    // Validate dependencies
    if (!state || !UI) {
        safeLog('ERROR', '[AI Bridge Registration] Missing dependencies for actions.js');
        return;
    }

    // ============================================
    // REGISTRATION FUNCTIONS
    // ============================================

    async function registerAsSession(num) {
        safeLog('INFO', '[AI Bridge Registration] Registering as session: ' + num);
        state.sessionNum = num;

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'REGISTER_SESSION',
                sessionNum: num,
                platform: state.platform
            });

            safeLog('INFO', '[AI Bridge Registration] Response: ' + JSON.stringify(response));

            if (response && response.success) {
                state.isRegistered = true;
                state.sessionNum = num;

                UI.updateRegisteredUI(num);

                window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
                    detail: { sessionNum: num, platform: state.platform }
                }));

                safeLog('INFO', '[AI Bridge Registration] SUCCESS! Session: ' + num);
                return true;
            } else {
                safeLog('ERROR', '[AI Bridge Registration] Failed: ' + JSON.stringify(response));
                alert('Registration failed: ' + JSON.stringify(response));
                return false;
            }
        } catch (error) {
            handleRegistrationError(error);
            return false;
        }
    }

    async function unregisterSession() {
        safeLog('INFO', '[AI Bridge Registration] Unregistering session: ' + state.sessionNum);

        try {
            await chrome.runtime.sendMessage({
                type: 'UNREGISTER_SESSION',
                sessionNum: state.sessionNum
            });

            state.isRegistered = false;
            state.sessionNum = null;

            UI.updateUnregisteredUI();

            window.dispatchEvent(new CustomEvent('aiBridgeUnregistered'));

            safeLog('INFO', '[AI Bridge Registration] Unregistered successfully');
        } catch (error) {
            const errorMsg = error?.message || error?.toString() || String(error);
            safeLog('ERROR', '[AI Bridge Registration] Unregister error: ' + errorMsg);
            if (error.message && error.message.includes('context invalidated')) {
                alert('Extension was updated. Please refresh the page (F5).');
            }
        }
    }

    // Check existing registration using CHECK_TAB_REGISTRATION API
    async function checkExistingRegistration() {
        try {
            safeLog('INFO', '[AI Bridge Registration] Checking registration status...');

            const response = await chrome.runtime.sendMessage({ type: 'CHECK_TAB_REGISTRATION' });

            if (!response || typeof response !== 'object' || !('isRegistered' in response)) {
                safeLog('WARN', '[AI Bridge Registration] Received unexpected response format: ' + JSON.stringify(response));
                return;
            }

            safeLog('INFO', '[AI Bridge Registration] Check result: ' + JSON.stringify(response));

            if (response && response.isRegistered === true) {
                const wasRegistered = state.isRegistered;
                const sessionChanged = state.sessionNum !== response.sessionNum;

                // Handle Pool Registration
                if (response.inPool) {
                    safeLog('INFO', '[AI Bridge Registration] Found in pool');
                    state.isRegistered = true;
                    state.sessionNum = null;
                    state.inPool = true;

                    UI.updatePoolRegisteredUI();
                    return;
                }

                // Update state
                state.isRegistered = true;
                state.sessionNum = response.sessionNum;
                state.inPool = false;

                safeLog('INFO', '[AI Bridge Registration] Registration found! Session: ' + response.sessionNum);

                const role = response.role || `Participant ${response.sessionNum}`;
                UI.updateRegisteredUI(response.sessionNum, role);

                if (!wasRegistered || sessionChanged || !state.isRegistered) {
                    window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
                        detail: {
                            sessionNum: response.sessionNum,
                            platform: response.platform || state.platform,
                            role: role,
                            order: response.order
                        }
                    }));
                }

                safeLog('INFO', '[AI Bridge Registration] UI updated');
            } else {
                safeLog('INFO', '[AI Bridge Registration] Not registered - checkResult: ' + JSON.stringify(response));

                if (state.isRegistered) {
                    state.isRegistered = false;
                    state.sessionNum = null;
                    UI.updateUnregisteredUI();
                } else if (!state.isRegistered) {
                    UI.updateUnregisteredUI();
                }
            }
        } catch (error) {
            handleRegistrationError(error, true);
        }
    }

    // ============================================
    // POOL REGISTRATION
    // ============================================

    let isRegisteringToPool = false;

    async function registerToPool() {
        if (isRegisteringToPool) return;
        if (state.isRegistered && state.sessionNum) {
            safeLog('INFO', '[AI Bridge Registration] Already participating in session ' + state.sessionNum);
            return;
        }
        if (state.isRegistered && state.inPool) return;

        if (!state.platform || state.platform === 'unknown') {
            setTimeout(() => {
                if (state.platform && state.platform !== 'unknown') {
                    registerToPool();
                } else {
                    safeLog('INFO', '[AI Bridge Registration] Platform not detected, skipping pool registration');
                }
            }, 1000);
            return;
        }

        try {
            isRegisteringToPool = true;
            safeLog('INFO', '[AI Bridge Registration] Registering to pool... Platform: ' + state.platform);

            // Check availability before registering
            let availability = null;
            if (window.AIBridge && window.AIBridge.adapter && typeof window.AIBridge.adapter.checkAvailability === 'function') {
                availability = window.AIBridge.adapter.checkAvailability();
                safeLog('INFO', '[AI Bridge Registration] Availability check:', JSON.stringify(availability));
            }

            const response = await chrome.runtime.sendMessage({
                type: 'REGISTER_TO_POOL',
                platform: state.platform,
                availability: availability
            });

            if (response && response.success) {
                safeLog('INFO', '[AI Bridge Registration] Successfully registered to pool');
                state.isRegistered = true;
                state.inPool = true;
                UI.updatePoolRegisteredUI();
            }
        } catch (error) {
            const errorMsg = error?.message || error?.toString() || String(error);
            safeLog('ERROR', '[AI Bridge Registration] Pool registration failed: ' + errorMsg);
            // Silently fail for pool registration to avoid annoyance
        } finally {
            isRegisteringToPool = false;
        }
    }

    // Error handing helper
    function handleRegistrationError(error, silent = false) {
        let isContextInvalidated = false;
        const errorStr = String(error);
        const errorMessage = error?.message || error?.toString() || String(error);
        const errorStack = error?.stack || '';

        if (errorStr.includes('Extension context invalidated') ||
            errorStr.includes('message port closed') ||
            errorStr.includes('Receiving end does not exist')) {
            isContextInvalidated = true;
        }

        if (chrome.runtime && chrome.runtime.lastError) {
            const lastErrorMsg = chrome.runtime.lastError.message || '';
            if (lastErrorMsg.includes('Extension context invalidated') ||
                lastErrorMsg.includes('message port closed')) {
                isContextInvalidated = true;
            }
        }

        if (isContextInvalidated) {
            if (!silent) safeLog('INFO', '[AI Bridge Registration] Extension context invalidated.');
            return; // Stop processing
        }

        // Log detailed error information
        const fullErrorMessage = '[AI Bridge Registration] Error: ' + errorMessage + (errorStack ? ' | Stack: ' + errorStack.split('\n')[0] : '');
        safeLog('ERROR', fullErrorMessage);
        if (!silent) alert('Registration error: ' + errorMessage);
    }

    // Expose functions
    window.AIBridge.register = registerAsSession;
    window.AIBridge.unregister = unregisterSession;
    window.AIBridge.registerToPool = registerToPool;
    window.AIBridge.checkExistingRegistration = checkExistingRegistration;
    window.AIBridge.getState = () => ({ ...state });

})();
