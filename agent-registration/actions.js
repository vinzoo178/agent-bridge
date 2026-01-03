// Agent Registration - Actions & Logic
(function () {
    'use strict';

    window.AIBridge = window.AIBridge || {};
    const state = window.AIBridge.state;
    const sendLog = window.AIBridge.sendLog;
    const UI = window.AIBridge.ui;

    // Validate dependencies
    if (!state || !UI) {
        sendLog.bind(null, 'ERROR')('[AI Bridge Registration] Missing dependencies for actions.js');
        return;
    }

    // ============================================
    // REGISTRATION FUNCTIONS
    // ============================================

    async function registerAsSession(num) {
        sendLog.bind(null, 'INFO')('[AI Bridge Registration] Registering as session:', num);
        state.sessionNum = num;

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'REGISTER_SESSION',
                sessionNum: num,
                platform: state.platform
            });

            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Response:', response);

            if (response && response.success) {
                state.isRegistered = true;
                state.sessionNum = num;

                UI.updateRegisteredUI(num);

                window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
                    detail: { sessionNum: num, platform: state.platform }
                }));

                sendLog.bind(null, 'INFO')('[AI Bridge Registration] SUCCESS! Session:', num);
                return true;
            } else {
                sendLog.bind(null, 'ERROR')('[AI Bridge Registration] Failed:', response);
                alert('Registration failed: ' + JSON.stringify(response));
                return false;
            }
        } catch (error) {
            handleRegistrationError(error);
            return false;
        }
    }

    async function unregisterSession() {
        sendLog.bind(null, 'INFO')('[AI Bridge Registration] Unregistering session:', state.sessionNum);

        try {
            await chrome.runtime.sendMessage({
                type: 'UNREGISTER_SESSION',
                sessionNum: state.sessionNum
            });

            state.isRegistered = false;
            state.sessionNum = null;

            UI.updateUnregisteredUI();

            window.dispatchEvent(new CustomEvent('aiBridgeUnregistered'));

            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Unregistered successfully');
        } catch (error) {
            sendLog.bind(null, 'ERROR')('[AI Bridge Registration] Unregister error:', error);
            if (error.message && error.message.includes('context invalidated')) {
                alert('Extension was updated. Please refresh the page (F5).');
            }
        }
    }

    // Check existing registration using CHECK_TAB_REGISTRATION API
    async function checkExistingRegistration() {
        try {
            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Checking registration status...');
            sendLog('INFO', 'Checking registration status...');

            const response = await chrome.runtime.sendMessage({ type: 'CHECK_TAB_REGISTRATION' });

            if (!response || typeof response !== 'object' || !('isRegistered' in response)) {
                sendLog.bind(null, 'WARN')('[AI Bridge Registration] Received unexpected response format:', response);
                sendLog('WARN', 'Received unexpected response format: ' + JSON.stringify(response));
                return;
            }

            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Check result:', response);
            sendLog('INFO', 'Registration check result - isRegistered: ' + (response?.isRegistered || false) + ', sessionNum: ' + (response?.sessionNum || 'null'));

            if (response && response.isRegistered === true) {
                const wasRegistered = state.isRegistered;
                const sessionChanged = state.sessionNum !== response.sessionNum;

                // Handle Pool Registration
                if (response.inPool) {
                    sendLog.bind(null, 'INFO')('[AI Bridge Registration] Found in pool');
                    sendLog('INFO', 'Found in pool');
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

                sendLog.bind(null, 'INFO')('[AI Bridge Registration] Registration found! Session:', response.sessionNum);
                sendLog('INFO', 'Registration found! Session: ' + response.sessionNum);

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

                sendLog('INFO', 'UI updated');
            } else {
                sendLog('INFO', 'Not registered - checkResult: ' + JSON.stringify(response));

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
            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Already participating in session', state.sessionNum);
            return;
        }
        if (state.isRegistered && state.inPool) return;

        if (!state.platform || state.platform === 'unknown') {
            setTimeout(() => {
                if (state.platform && state.platform !== 'unknown') {
                    registerToPool();
                } else {
                    sendLog.bind(null, 'INFO')('[AI Bridge Registration] Platform not detected, skipping pool registration');
                }
            }, 1000);
            return;
        }

        try {
            isRegisteringToPool = true;
            sendLog.bind(null, 'INFO')('[AI Bridge Registration] Registering to pool... Platform:', state.platform);

            const response = await chrome.runtime.sendMessage({
                type: 'REGISTER_TO_POOL',
                platform: state.platform
            });

            if (response && response.success) {
                sendLog.bind(null, 'INFO')('[AI Bridge Registration] Successfully registered to pool request sent');
                sendLog('INFO', 'Registered to pool successfully');
                state.isRegistered = true;
                state.inPool = true;
                UI.updatePoolRegisteredUI();
            }
        } catch (error) {
            sendLog.bind(null, 'ERROR')('[AI Bridge Registration] Pool registration failed:', error);
            // Silently fail for pool registration to avoid annoyance
        } finally {
            isRegisteringToPool = false;
        }
    }

    // Error handing helper
    function handleRegistrationError(error, silent = false) {
        let isContextInvalidated = false;
        const errorStr = String(error);

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
            if (!silent) sendLog.bind(null, 'INFO')('[AI Bridge Registration] Extension context invalidated.');
            return; // Stop processing
        }

        sendLog.bind(null, 'ERROR')('[AI Bridge Registration] Error:', error);
        if (!silent) alert('Registration error: ' + (error.message || error));
    }

    // Expose functions
    window.AIBridge.register = registerAsSession;
    window.AIBridge.unregister = unregisterSession;
    window.AIBridge.registerToPool = registerToPool;
    window.AIBridge.checkExistingRegistration = checkExistingRegistration;
    window.AIBridge.getState = () => ({ ...state });

})();
