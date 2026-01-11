// AI Chat Bridge - Content Script (Message Handling)
// Handles sending messages and capturing responses
// Uses Platform Adapters for cross-platform support
// Registration is handled by agent-registration.js

(function () {
  'use strict';

  // Centralized logging - sends to background
  function log(...args) {
    const message = args.join(' ');
    console.log('[AI Bridge Content]', ...args); // Enable for debugging
    sendLog('Content', 'INFO', message);
  }

  function logError(...args) {
    const message = args.join(' ');
    // console.error('[AI Bridge Content]', ...args);
    sendLog('Content', 'ERROR', message);
  }

  function sendLog(source, level, message) {
    try {
      chrome.runtime.sendMessage({
        type: 'ADD_LOG',
        entry: {
          timestamp: new Date().toISOString(),
          level: level,
          source: source,
          message: message
        }
      }).catch(() => { }); // Ignore errors
    } catch (e) { }
  }

  log('Loading...');

  // Wait for registration module and platform adapter to load
  let initAttempts = 0;
  const maxAttempts = 20;

  function waitForRegistration() {
    initAttempts++;

    if (window.AIBridge && window.AIBridge.state) {
      log('Registration module ready');
      log('Platform adapter:', window.AIBridge.adapter ? 'Available' : 'Not found');
      initMessageHandling();
      return;
    }

    if (initAttempts < maxAttempts) {
      setTimeout(waitForRegistration, 200);
    } else {
      logError('Registration module not found!');
    }
  }

  // ============================================
  // MESSAGE HANDLING
  // ============================================

  let lastResponseText = '';
  let pollInterval = null;
  let pollCount = 0;
  let stableCount = 0;
  let lastPolledResponse = '';
  let isWaitingForResponse = false;
  let currentRequestId = null; // Store requestId from backend
  const MAX_POLLS = 90;
  const STABLE_THRESHOLD = 2;
  
  // Platform-specific timeout settings
  function getMaxPolls() {
    const adapter = window.AIBridge?.adapter;
    const platform = window.AIBridge?.platform || 'unknown';
    
    // z.ai with deepthink mode needs more time
    if (platform === 'zai' || (adapter && adapter.name === 'zai')) {
      // Check if in deepthink mode
      if (adapter && typeof adapter.isDeepthinkMode === 'function' && adapter.isDeepthinkMode()) {
        log('Z.ai DeepThink mode detected - using extended timeout');
        return 300; // 300 polls * 2s = 10 minutes for deepthink
      }
      // Even without deepthink, z.ai can be slow
      return 150; // 150 polls * 2s = 5 minutes
    }
    
    return MAX_POLLS; // Default: 90 polls * 2s = 3 minutes
  }

  async function initMessageHandling() {
    log('Initializing message handling');

    // Check registration status from background on init
    try {
      const checkResult = await chrome.runtime.sendMessage({ type: 'CHECK_TAB_REGISTRATION' });
      log('Initial registration check:', JSON.stringify(checkResult));

      if (checkResult && checkResult.isRegistered) {
        // Sync state from background
        if (!window.AIBridge) window.AIBridge = {};
        if (!window.AIBridge.state) window.AIBridge.state = {};
        window.AIBridge.state.isRegistered = true;
        window.AIBridge.state.sessionNum = checkResult.sessionNum;
        log('State synced from background on init:', JSON.stringify(window.AIBridge.state));
      }
    } catch (error) {
      log('Initial registration check failed (may be normal):', error.message);
    }

    // Listen for registration events
    window.addEventListener('aiBridgeRegistered', (e) => {
      log('Registered event received:', JSON.stringify(e.detail));

      // IMPORTANT: Update state from event detail
      if (window.AIBridge && window.AIBridge.state) {
        window.AIBridge.state.isRegistered = true;
        window.AIBridge.state.sessionNum = e.detail.sessionNum;
        log('State updated - isRegistered:', window.AIBridge.state.isRegistered, 'sessionNum:', window.AIBridge.state.sessionNum);
      } else {
        logError('window.AIBridge.state not found!');
      }

      lastResponseText = getLatestResponse() || '';
    });

    window.addEventListener('aiBridgeUnregistered', () => {
      log('Unregistered event received');

      // Update state
      if (window.AIBridge && window.AIBridge.state) {
        window.AIBridge.state.isRegistered = false;
        window.AIBridge.state.sessionNum = null;
      }

      stopPolling();
    });

    // Listen for manual capture
    window.addEventListener('aiBridgeManualCapture', () => {
      manualCaptureResponse();
    });

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Don't intercept CHECK_TAB_REGISTRATION - let it go to background
      if (message.type === 'CHECK_TAB_REGISTRATION') {
        return false; // Let background handle it
      }

      log('Received message:', message.type);

      switch (message.type) {
        case 'SEND_MESSAGE':
          // Store requestId if provided (from backend)
          if (message.requestId) {
            currentRequestId = message.requestId;
            log('Stored requestId:', currentRequestId);
          }
          sendMessageToChat(message.text).then(success => {
            sendResponse({ success });
          });
          return true;

        case 'REGISTRATION_CONFIRMED':
          log('Registration confirmed from background:', JSON.stringify(message));
          // Update state from background confirmation
          if (window.AIBridge && window.AIBridge.state) {
            window.AIBridge.state.isRegistered = true;
            window.AIBridge.state.sessionNum = message.sessionNum;
            log('State updated from REGISTRATION_CONFIRMED:', JSON.stringify(window.AIBridge.state));
          }
          sendResponse({ success: true });
          break;

        case 'STATE_UPDATE':
          if (window.AIBridge && window.AIBridge.state && window.AIBridge.state.isRegistered) {
            const myTurn = message.state.currentTurn === window.AIBridge.state.sessionNum;
            updateStatus(myTurn ? '🎯 Your turn!' : '⏳ Waiting...');
          }
          sendResponse({ success: true });
          break;

      case 'CONVERSATION_STOPPED':
        stopPolling();
        updateStatus('⏹️ Stopped');
        sendResponse({ success: true });
        break;

      case 'CHECK_AVAILABILITY':
        // Check if agent is available (can receive input and submit)
        const availability = checkAgentAvailability();
        sendResponse(availability);
        return true;
      }

      return false;
    });
  }

  // ============================================
  // RESPONSE DETECTION (Using Platform Adapter)
  // ============================================

  function getLatestResponse() {
    const adapter = window.AIBridge?.adapter;

    log('getLatestResponse - adapter:', adapter ? adapter.name : 'none');

    // Use adapter if available
    if (adapter) {
      const response = adapter.getLatestResponse();
      log('Adapter response length:', response?.length || 0);
      return response;
    }

    // Fallback to legacy detection
    log('Using legacy detection');
    return getLatestResponseLegacy();
  }

  function getLatestResponseLegacy() {
    const platform = window.AIBridge?.platform || 'unknown';
    let responses = [];

    if (platform === 'gemini') {
      responses = getGeminiResponsesLegacy();
    } else if (platform === 'chatgpt') {
      responses = getChatGPTResponsesLegacy();
    } else if (platform === 'deepseek') {
      responses = getDeepSeekResponsesLegacy();
    }

    if (responses.length === 0) return null;

    const lastResponse = responses[responses.length - 1];
    return (lastResponse.innerText || lastResponse.textContent || '').trim();
  }

  function getGeminiResponsesLegacy() {
    const selectors = [
      'model-response message-content',
      'message-content.model-response-text',
      '.model-response-text',
      'model-response',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) return Array.from(elements);
    }

    const allMessages = document.querySelectorAll('message-content');
    if (allMessages.length > 0) {
      return Array.from(allMessages).filter(el => el.closest('model-response'));
    }

    return [];
  }

  function getChatGPTResponsesLegacy() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      '.agent-turn .markdown',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) return Array.from(elements);
    }
    return [];
  }

  function getDeepSeekResponsesLegacy() {
    const selectors = [
      '.assistant-message',
      '[data-role="assistant"]',
      '.message-assistant',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) return Array.from(elements);
    }
    return [];
  }

  function isGenerating() {
    const adapter = window.AIBridge?.adapter;

    // Use adapter if available
    if (adapter) {
      const result = adapter.isGenerating();
      // Only log when generating (to avoid spam)
      if (result) log('isGenerating:', result);
      return result;
    }

    // Fallback to legacy detection
    return isGeneratingLegacy();
  }

  function isGeneratingLegacy() {
    const platform = window.AIBridge?.platform || 'unknown';

    const loadingSelectors = {
      gemini: ['.loading-indicator', 'mat-progress-bar', '.streaming-indicator', 'button[aria-label*="Stop"]'],
      chatgpt: ['.result-streaming', '[data-testid="stop-button"]'],
      deepseek: ['.loading', '.generating', 'button[aria-label*="Stop"]']
    };

    const selectors = loadingSelectors[platform] || [];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return true;
    }

    return false;
  }

  // ============================================
  // SEND MESSAGE TO CHAT (Using Platform Adapter)
  // ============================================

  async function sendMessageToChat(text) {
    log('📤 Sending message... length:', text.length);

    const adapter = window.AIBridge?.adapter;

    // Use adapter if available
    if (adapter) {
      return await sendMessageWithAdapter(adapter, text);
    }

    // Fallback to legacy method
    return await sendMessageLegacy(text);
  }

  async function sendMessageWithAdapter(adapter, text) {
    log('Using adapter:', adapter.name);

    const inputField = adapter.getInputField();
    if (!inputField) {
      logError('Input field not found');
      updateStatus('❌ Input not found');
      return false;
    }

    // Save current response to detect new ones
    lastResponseText = adapter.getLatestResponse() || '';

    // Set text and send
    const textSet = await adapter.setInputText(text);
    if (!textSet) {
      logError('Failed to set text');
      updateStatus('❌ Cannot type');
      return false;
    }

    await sleep(500);

    const sent = await adapter.clickSend();
    if (!sent) {
      log('Send button not found, trying Enter key');
    }

    isWaitingForResponse = true;
    updateStatus('📤 Sent! Waiting...');
    startPollingForResponse();

    return true;
  }

  async function sendMessageLegacy(text) {
    const platform = window.AIBridge?.platform || 'unknown';
    const inputField = findInputFieldLegacy(platform);

    if (!inputField) {
      logError('Input field not found (legacy)');
      updateStatus('❌ Input not found');
      return false;
    }

    lastResponseText = getLatestResponse() || '';

    // Focus and clear
    inputField.focus();
    await sleep(100);
    inputField.innerHTML = '';
    inputField.textContent = '';

    // Set text
    if (platform === 'gemini') {
      const p = document.createElement('p');
      p.textContent = text;
      inputField.appendChild(p);
      inputField.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      if (inputField.tagName === 'TEXTAREA') {
        inputField.value = text;
      } else {
        inputField.textContent = text;
      }
      inputField.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await sleep(500);

    // Click send
    const sendButton = findSendButtonLegacy(platform);
    if (sendButton) {
      sendButton.click();
    } else {
      inputField.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
    }

    isWaitingForResponse = true;
    updateStatus('📤 Sent! Waiting...');
    startPollingForResponse();

    return true;
  }

  function findInputFieldLegacy(platform) {
    const selectors = {
      gemini: ['rich-textarea .ql-editor', 'div.ql-editor[contenteditable="true"]'],
      chatgpt: ['#prompt-textarea', 'textarea[placeholder*="Message"]'],
      deepseek: ['textarea', 'div[contenteditable="true"]']
    };

    for (const selector of selectors[platform] || []) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function findSendButtonLegacy(platform) {
    const selectors = {
      gemini: ['button[aria-label*="Send"]', 'button.send-button'],
      chatgpt: ['button[data-testid="send-button"]'],
      deepseek: ['button[aria-label*="Send"]', 'button[type="submit"]']
    };

    for (const selector of selectors[platform] || []) {
      const el = document.querySelector(selector);
      if (el && !el.disabled) return el;
    }
    return null;
  }

  // ============================================
  // POLLING FOR RESPONSE
  // ============================================

  function startPollingForResponse() {
    pollCount = 0;
    stableCount = 0;
    lastPolledResponse = '';

    stopPolling();

    log('🔄 Starting polling for response...');
    log('Last response text length:', lastResponseText.length);

    pollInterval = setInterval(() => {
      pollCount++;

      // Debug: Check if generating
      const generating = isGenerating();
      log(`Poll #${pollCount}: generating=${generating}`);

      if (generating) {
        updateStatus('⏳ Generating... (' + (pollCount * 2) + 's)');
        stableCount = 0;
        return;
      }

      const currentResponse = getLatestResponse();
      log(`Poll #${pollCount}: response length=${currentResponse?.length || 0}`);

      if (!currentResponse || currentResponse.length < 20) {
        log('Response too short or empty');
        return;
      }

      if (currentResponse === lastResponseText) {
        log('Same as last response, skipping');
        return;
      }

      log(`Poll #${pollCount}: stableCount=${stableCount}, same as last poll=${currentResponse === lastPolledResponse}`);

      if (currentResponse === lastPolledResponse) {
        stableCount++;
        updateStatus(`⏳ Checking stability (${stableCount}/${STABLE_THRESHOLD})...`);

        if (stableCount >= STABLE_THRESHOLD) {
          log('✅ Response stable! Reporting...');
          log('Response preview:', currentResponse.substring(0, 100));
          stopPolling();
          reportResponse(currentResponse);
        }
      } else {
        stableCount = 0;
        lastPolledResponse = currentResponse;
        log('Response changed, resetting stability counter');
      }

      const maxPolls = getMaxPolls();
      if (pollCount >= maxPolls) {
        log('⚠️ Timeout reached (max polls:', maxPolls, ')');
        stopPolling();
        updateStatus('⚠️ Timeout');
      }

    }, 2000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    isWaitingForResponse = false;
  }

  // ============================================
  // REPORT RESPONSE
  // ============================================

  async function reportResponse(text) {
    let state = window.AIBridge?.state;

    // Debug: Log current state
    log('reportResponse called - state:', state ? JSON.stringify(state) : 'null');
    log('window.AIBridge:', window.AIBridge ? 'exists' : 'null');

    // If state not found or not registered, try to check with background
    if (!state || !state.isRegistered) {
      log('State not registered, checking with background...');

      try {
        const checkResult = await chrome.runtime.sendMessage({ type: 'CHECK_TAB_REGISTRATION' });
        log('Background check result:', JSON.stringify(checkResult));

        if (checkResult && checkResult.isRegistered) {
          // Update local state
          if (!window.AIBridge) window.AIBridge = {};
          if (!window.AIBridge.state) window.AIBridge.state = {};
          window.AIBridge.state.isRegistered = true;
          window.AIBridge.state.sessionNum = checkResult.sessionNum;
          state = window.AIBridge.state;
          log('State restored from background:', JSON.stringify(state));
        } else {
          logError('Cannot report - not registered (checked with background)');
          updateStatus('❌ Not registered - please register again');
          return;
        }
      } catch (error) {
        logError('Error checking registration:', error.message);
        updateStatus('❌ Registration check failed');
        return;
      }
    }

    if (!state || !state.isRegistered || !state.sessionNum) {
      logError('Cannot report - invalid state:', JSON.stringify(state));
      return;
    }

    log('📨 Reporting response to background...');
    log('Session:', state.sessionNum);
    log('Response length:', text.length);
    log('Response preview:', text.substring(0, 150) + '...');
    updateStatus('📨 Sending to bridge...');

    try {
      const messageToBackground = {
        type: 'AI_RESPONSE_RECEIVED',
        response: text,
        sessionNum: state.sessionNum
      };

      // Include requestId if available (from backend)
      if (currentRequestId) {
        messageToBackground.requestId = currentRequestId;
        log('Including requestId in response:', currentRequestId);
        currentRequestId = null; // Clear after use
      }

      const result = await chrome.runtime.sendMessage(messageToBackground);

      log('✅ Report result:', JSON.stringify(result));
      updateStatus('✅ Sent to Agent ' + (state.sessionNum === 1 ? 'B' : 'A'));
      lastResponseText = text;
    } catch (error) {
      logError('❌ Report error:', error.message);
      if (error.message?.includes('context invalidated')) {
        updateStatus('⚠️ Extension updated - Refresh page');
      } else {
        updateStatus('❌ Error: ' + error.message);
      }
    }
  }

  function manualCaptureResponse() {
    log('📷 Manual capture triggered');

    const adapter = window.AIBridge?.adapter;
    log('Using adapter:', adapter ? adapter.name : 'legacy');

    // Debug: Show what we can find
    if (adapter && adapter.name === 'gemini') {
      const modelResponses = document.querySelectorAll('model-response');
      log('DEBUG: Found', modelResponses.length, 'model-response elements');

      if (modelResponses.length > 0) {
        const last = modelResponses[modelResponses.length - 1];
        log('DEBUG: Last model-response innerHTML preview:', last.innerHTML.substring(0, 200));
      }
    }

    const response = getLatestResponse();
    log('Manual capture response:', response ? response.length + ' chars' : 'NULL');

    if (!response || response.length < 10) {
      alert('No response found!\n\nCheck console (F12) for debug info.');
      return;
    }

    if (response === lastResponseText) {
      if (!confirm('Same as last response. Send anyway?')) return;
    }

    reportResponse(response);
  }

  // ============================================
  // UTILITIES
  // ============================================

  function updateStatus(text) {
    const el = document.getElementById('action-status');
    if (el) el.textContent = text;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // AVAILABILITY CHECKING
  // ============================================

  function checkAgentAvailability() {
    const adapter = window.AIBridge?.adapter;
    
    if (adapter && typeof adapter.checkAvailability === 'function') {
      return adapter.checkAvailability();
    }
    
    // Fallback: basic check
    const inputField = adapter ? adapter.getInputField() : null;
    const sendButton = adapter ? adapter.getSendButton() : null;
    
    if (!inputField) {
      return {
        available: false,
        reason: 'Input field not found',
        requiresLogin: false
      };
    }
    
    if (inputField.disabled || inputField.readOnly) {
      return {
        available: false,
        reason: 'Input field is disabled',
        requiresLogin: false
      };
    }
    
    if (sendButton && sendButton.disabled) {
      return {
        available: false,
        reason: 'Send button is disabled',
        requiresLogin: false
      };
    }
    
    return {
      available: true,
      reason: null,
      requiresLogin: false
    };
  }

  // Periodically check availability and report to background
  setInterval(async () => {
    if (window.AIBridge && window.AIBridge.state && window.AIBridge.state.isRegistered) {
      try {
        const availability = checkAgentAvailability();
        await chrome.runtime.sendMessage({
          type: 'UPDATE_AGENT_AVAILABILITY',
          tabId: null, // Background will use sender.tab.id
          availability: availability
        });
      } catch (e) {
        // Silently fail - agent might not be registered yet
      }
    }
  }, 10000); // Check every 10 seconds

  // Start
  waitForRegistration();

})();
