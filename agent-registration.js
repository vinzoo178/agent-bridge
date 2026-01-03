// Agent Registration Module - DO NOT MODIFY
// This file handles agent registration and should remain stable

(function() {
  'use strict';
  
  // ============================================
  // REGISTRATION STATE - DO NOT MODIFY
  // ============================================
  window.AIBridge = window.AIBridge || {};
  
  // Use PlatformRegistry if available
  let platformAdapter = null;
  if (window.PlatformRegistry) {
    platformAdapter = window.PlatformRegistry.detect();
  }
  
  const state = {
    sessionNum: null,
    isRegistered: false,
    platform: platformAdapter ? platformAdapter.name : detectPlatformLegacy()
  };
  
  // Expose state and adapter
  window.AIBridge.state = state;
  window.AIBridge.adapter = platformAdapter;
  
  // Legacy platform detection (fallback)
  function detectPlatformLegacy() {
    const url = window.location.hostname;
    if (url.includes('gemini.google.com')) return 'gemini';
    if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
    if (url.includes('deepseek.com')) return 'deepseek';
    return 'unknown';
  }
  
  window.AIBridge.platform = state.platform;
  console.log('[AI Bridge Registration] Platform:', state.platform);
  console.log('[AI Bridge Registration] Adapter:', platformAdapter ? 'Found' : 'Legacy mode');
  
  // Helper to send logs to background (fire-and-forget, don't wait for response)
  function sendLog(level, message) {
    try {
      // Use setTimeout to make this truly async and non-blocking
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
            // Completely ignore response and errors - fire and forget
            if (chrome.runtime.lastError) {
              // Silently ignore
            }
          });
        } catch (e) {
          // Silently ignore
        }
      }, 0);
    } catch (e) {
      // Silently ignore errors
    }
  }
  
  // ============================================
  // REGISTRATION FUNCTIONS - DO NOT MODIFY
  // ============================================
  
  // Register as a session
  async function registerAsSession(num) {
    console.log('[AI Bridge Registration] Registering as session:', num);
    state.sessionNum = num;
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REGISTER_SESSION',
        sessionNum: num,
        platform: state.platform
      });
      
      console.log('[AI Bridge Registration] Response:', response);
      
      if (response && response.success) {
        state.isRegistered = true;
        state.sessionNum = num;
        
        // Update UI
        updateRegisteredUI(num);
        
        // Notify main content script
        window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
          detail: { sessionNum: num, platform: state.platform }
        }));
        
        console.log('[AI Bridge Registration] SUCCESS! Session:', num);
        return true;
      } else {
        console.error('[AI Bridge Registration] Failed:', response);
        alert('Registration failed: ' + JSON.stringify(response));
        return false;
      }
    } catch (error) {
      console.error('[AI Bridge Registration] Error:', error);
      // Don't show alert for context invalidated - just need to refresh
      if (error.message && error.message.includes('context invalidated')) {
        alert('Extension was updated. Please refresh the page (F5).');
      } else {
        alert('Registration error: ' + error.message);
      }
      return false;
    }
  }
  
  // Unregister session
  async function unregisterSession() {
    console.log('[AI Bridge Registration] Unregistering session:', state.sessionNum);
    
    try {
      await chrome.runtime.sendMessage({
        type: 'UNREGISTER_SESSION',
        sessionNum: state.sessionNum
      });
      
      state.isRegistered = false;
      state.sessionNum = null;
      
      // Update UI
      updateUnregisteredUI();
      
      // Notify main content script
      window.dispatchEvent(new CustomEvent('aiBridgeUnregistered'));
      
      console.log('[AI Bridge Registration] Unregistered successfully');
    } catch (error) {
      console.error('[AI Bridge Registration] Unregister error:', error);
      if (error.message && error.message.includes('context invalidated')) {
        alert('Extension was updated. Please refresh the page (F5).');
      }
    }
  }
  
  // Expose functions
  window.AIBridge.register = registerAsSession;
  window.AIBridge.unregister = unregisterSession;
  window.AIBridge.getState = () => ({ ...state });
  
  // ============================================
  // UI FUNCTIONS - DO NOT MODIFY
  // ============================================
  
  function updateRegisteredUI(num) {
    console.log('[AI Bridge Registration] updateRegisteredUI called for session:', num);
    
    const overlay = document.getElementById('ai-bridge-overlay');
    if (!overlay) {
      console.error('[AI Bridge Registration] Overlay not found!');
      return;
    }
    
    const statusDot = overlay.querySelector('.status-dot');
    const statusText = document.getElementById('overlay-status-text');
    const registeredView = document.getElementById('registered-view');
    const notRegisteredView = document.getElementById('not-registered-view');
    const selector = document.getElementById('session-selector');
    const actionStatus = document.getElementById('action-status');
    
    // Update status indicator
    if (statusDot) {
      statusDot.classList.remove('disconnected');
      statusDot.classList.add('connected');
    }
    if (statusText) {
      statusText.textContent = (num === 1 ? 'Agent A' : 'Agent B');
    }
    
    // Show registered view, hide not-registered view
    if (registeredView) {
      registeredView.style.display = 'block';
    }
    if (notRegisteredView) {
      notRegisteredView.style.display = 'none';
    }
    if (selector) {
      selector.style.display = 'none';
    }
    
    // Update action status
    if (actionStatus) {
      actionStatus.textContent = 'Ready';
      actionStatus.style.color = '#94a3b8';
    }
    
    // Make overlay compact when registered
    overlay.classList.add('compact');
    
    console.log('[AI Bridge Registration] updateRegisteredUI completed');
  }
  
  function updateUnregisteredUI() {
    const overlay = document.getElementById('ai-bridge-overlay');
    if (!overlay) return;
    
    const statusDot = overlay.querySelector('.status-dot');
    const statusText = document.getElementById('overlay-status-text');
    const registeredView = document.getElementById('registered-view');
    const notRegisteredView = document.getElementById('not-registered-view');
    const selector = document.getElementById('session-selector');
    
    // Update status indicator
    if (statusDot) {
      statusDot.classList.remove('connected');
      statusDot.classList.add('disconnected');
    }
    if (statusText) {
      statusText.textContent = 'Waiting...';
    }
    
    // Show not-registered view, hide registered view
    if (registeredView) {
      registeredView.style.display = 'none';
    }
    if (notRegisteredView) {
      notRegisteredView.style.display = 'block';
    }
    
    // Remove compact class
    overlay.classList.remove('compact');
    
    // Only show manual register buttons if auto-register failed
    // (We'll check this periodically)
    if (selector) {
      selector.style.display = 'none'; // Hide by default, show only if needed
    }
  }
  
  // ============================================
  // OVERLAY CREATION - DO NOT MODIFY
  // ============================================
  
  function createOverlay() {
    const existing = document.getElementById('ai-bridge-overlay');
    if (existing) existing.remove();
    
    // Get supported platforms for display
    let supportedPlatforms = 'Gemini, ChatGPT, DeepSeek';
    if (window.PlatformRegistry) {
      supportedPlatforms = window.PlatformRegistry.getSupportedPlatforms()
        .map(p => p.name.charAt(0).toUpperCase() + p.name.slice(1))
        .join(', ');
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'ai-bridge-overlay';
    overlay.innerHTML = `
      <div class="ai-bridge-header">
        <span class="ai-bridge-title">🤖 AI Bridge</span>
        <button id="ai-bridge-toggle" class="ai-bridge-btn">−</button>
      </div>
      <div class="ai-bridge-content">
        <!-- Status Display -->
        <div class="ai-bridge-status" id="overlay-status">
          <span class="status-dot disconnected"></span>
          <span class="status-text" id="overlay-status-text">Waiting...</span>
        </div>
        
        <!-- Registered View (default hidden) -->
        <div class="ai-bridge-registered-view" id="registered-view" style="display:none;">
          <div id="action-status" style="font-size:11px;color:#94a3b8;margin-bottom:10px;text-align:center;">Ready</div>
          <div class="ai-bridge-quick-actions">
            <button id="manual-capture" class="session-btn small" title="Manually capture AI response">📷</button>
            <button id="unregister-btn" class="session-btn small danger" title="Disconnect">✕</button>
          </div>
        </div>
        
        <!-- Not Registered View (default hidden) -->
        <div class="ai-bridge-not-registered-view" id="not-registered-view" style="display:none;">
          <div style="font-size:10px;color:#94a3b8;margin-bottom:8px;text-align:center;">
            Auto-registering...
          </div>
          <div class="ai-bridge-session-selector" id="session-selector" style="display:none;">
            <button id="register-session-1" class="session-btn small">Agent A</button>
            <button id="register-session-2" class="session-btn small">Agent B</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Toggle button
    document.getElementById('ai-bridge-toggle').onclick = function() {
      const content = overlay.querySelector('.ai-bridge-content');
      const isVisible = content.style.display !== 'none';
      content.style.display = isVisible ? 'none' : 'flex';
      this.textContent = isVisible ? '+' : '−';
    };
    
    // Register buttons
    document.getElementById('register-session-1').onclick = () => registerAsSession(1);
    document.getElementById('register-session-2').onclick = () => registerAsSession(2);
    
    // Unregister button
    document.getElementById('unregister-btn').onclick = () => unregisterSession();
    
    // Manual capture button - will be handled by content.js
    document.getElementById('manual-capture').onclick = function() {
      window.dispatchEvent(new CustomEvent('aiBridgeManualCapture'));
    };
    
    // Make draggable
    makeDraggable(overlay);
    
    // Show "Auto-registering..." initially
    updateUnregisteredUI();
    
    // Check registration status immediately (in case already registered)
    checkExistingRegistration();
    
    // Also check after a short delay (allow auto-registration to complete)
    setTimeout(() => {
      if (!state.isRegistered) {
        checkExistingRegistration();
      }
    }, 1000);
    
    // Fallback check after longer delay (in case auto-registration is slow)
    setTimeout(() => {
      if (!state.isRegistered) {
        checkExistingRegistration();
        // Show manual register buttons if still not registered after 5 seconds
        const selector = document.getElementById('session-selector');
        if (selector) {
          selector.style.display = 'flex';
        }
      }
    }, 5000);
    
    // Periodic check every 2 seconds if not registered (catch missed registrations)
    const periodicCheckInterval = setInterval(() => {
      if (!state.isRegistered) {
        checkExistingRegistration();
      } else {
        clearInterval(periodicCheckInterval);
      }
    }, 2000);
    
    // Stop periodic check after 30 seconds (to avoid infinite checking)
    setTimeout(() => {
      clearInterval(periodicCheckInterval);
    }, 30000);
    
    // Also check when page becomes visible (user switches back to tab)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !state.isRegistered) {
        checkExistingRegistration();
      }
    });
    
    // Listen for messages from background (primary synchronization method)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[AI Bridge Registration] Received message:', message.type);
      
      if (message.type === 'STATE_UPDATE') {
        // Update action status from conversation state
        updateActionStatusFromState(message.state);
        return false;
      } else if (message.type === 'REGISTRATION_CONFIRMED') {
        // Registration confirmed by background (assigned to slot)
        console.log('[AI Bridge Registration] Registration confirmed:', message);
        sendLog('INFO', 'Registration confirmed: Session ' + message.sessionNum);
        state.isRegistered = true;
        state.sessionNum = message.sessionNum;
        updateRegisteredUI(message.sessionNum);
        
        // Notify main content script
        window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
          detail: { 
            sessionNum: message.sessionNum, 
            platform: message.platform || state.platform 
          }
        }));
        
        sendLog('INFO', 'UI updated after REGISTRATION_CONFIRMED');
        return false;
      } else if (message.type === 'REGISTERED_TO_POOL') {
        // Registered to pool (not assigned to slot yet)
        console.log('[AI Bridge Registration] Registered to pool');
        sendLog('INFO', 'Registered to pool');
        updatePoolRegisteredUI();
        return false;
      } else if (message.type === 'REMOVED_FROM_POOL') {
        // Removed from pool
        console.log('[AI Bridge Registration] Removed from pool');
        sendLog('INFO', 'Removed from pool');
        updateUnregisteredUI();
        return false;
      }
      
      return false;
    });
    
    console.log('[AI Bridge Registration] Overlay created');
    sendLog('INFO', 'Overlay created and initialized');
  }
  
  // Check existing registration using CHECK_TAB_REGISTRATION API (more reliable)
  async function checkExistingRegistration() {
    // Note: We check even if state.isRegistered is true, to handle cases where
    // the state might be out of sync (e.g., after page reload)
    
    try {
      console.log('[AI Bridge Registration] Checking registration status...');
      sendLog('INFO', 'Checking registration status...');
      
      // Use Promise-based sendMessage (Manifest V3 pattern, same as content.js)
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_TAB_REGISTRATION' });
      
      // Validate response structure to ensure we got the right response
      if (!response || typeof response !== 'object' || !('isRegistered' in response)) {
        console.warn('[AI Bridge Registration] Received unexpected response format:', response);
        sendLog('WARN', 'Received unexpected response format: ' + JSON.stringify(response));
        // Don't update state if we got invalid response
        return;
      }
      
      console.log('[AI Bridge Registration] Check result:', response);
      sendLog('INFO', 'Registration check result - isRegistered: ' + (response?.isRegistered || false) + ', sessionNum: ' + (response?.sessionNum || 'null'));
      
      if (response && response.isRegistered === true) {
        // Update state
        state.isRegistered = true;
        state.sessionNum = response.sessionNum;
        
        console.log('[AI Bridge Registration] Registration found! Session:', response.sessionNum);
        sendLog('INFO', 'Registration found! Session: ' + response.sessionNum);
        
        // Update UI
        updateRegisteredUI(response.sessionNum);
        
        // Notify main content script
        window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
          detail: { 
            sessionNum: response.sessionNum, 
            platform: response.platform || state.platform 
          }
        }));
        
        sendLog('INFO', 'UI updated and event dispatched');
      } else {
        // Not registered - show unregistered UI
        sendLog('INFO', 'Not registered - checkResult: ' + JSON.stringify(response));
        // Only update UI if we're not already showing registered state
        // (to avoid flickering if check happens while already registered)
        if (!state.isRegistered) {
          updateUnregisteredUI();
        }
      }
    } catch (error) {
      console.error('[AI Bridge Registration] Check failed:', error);
      sendLog('ERROR', 'Check failed: ' + error.message);
      // If not registered, show unregistered UI
      if (!state.isRegistered) {
        updateUnregisteredUI();
      }
    }
  }
  

  
  // Update action status from conversation state
  function updateActionStatusFromState(conversationState) {
    const actionStatus = document.getElementById('action-status');
    if (!actionStatus || !state.isRegistered) return;
    if (!conversationState) return;
    
    const mySessionNum = state.sessionNum;
    const isActive = conversationState.isActive;
    const currentTurn = conversationState.currentTurn;
    
    if (isActive) {
      if (currentTurn === mySessionNum) {
        actionStatus.textContent = '🎯 Your turn';
        actionStatus.style.color = '#818cf8';
      } else {
        actionStatus.textContent = '⏳ Waiting';
        actionStatus.style.color = '#94a3b8';
      }
    } else {
      actionStatus.textContent = 'Ready';
      actionStatus.style.color = '#94a3b8';
    }
  }
  
  function makeDraggable(element) {
    const header = element.querySelector('.ai-bridge-header');
    let isDragging = false;
    let offsetX, offsetY;
    
    header.onmousedown = function(e) {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      offsetX = e.clientX - element.offsetLeft;
      offsetY = e.clientY - element.offsetTop;
    };
    
    document.onmousemove = function(e) {
      if (!isDragging) return;
      element.style.left = (e.clientX - offsetX) + 'px';
      element.style.top = (e.clientY - offsetY) + 'px';
      element.style.right = 'auto';
    };
    
    document.onmouseup = function() {
      isDragging = false;
    };
  }
  
  // ============================================
  // PROACTIVE REGISTRATION TO POOL
  // ============================================
  
  // Proactively register this tab to the available agents pool
  async function registerToPool() {
    if (!state.platform || state.platform === 'unknown') {
      console.log('[AI Bridge Registration] Platform not detected, skipping pool registration');
      return;
    }
    
    try {
      console.log('[AI Bridge Registration] Registering to pool...');
      sendLog('INFO', 'Registering to available agents pool');
      
      const response = await chrome.runtime.sendMessage({
        type: 'REGISTER_TO_POOL',
        platform: state.platform
      });
      
      if (response && response.success) {
        console.log('[AI Bridge Registration] Successfully registered to pool');
        sendLog('INFO', 'Registered to pool successfully');
        // Update UI to show "Registered" status (but not assigned to slot)
        updatePoolRegisteredUI();
      } else {
        console.error('[AI Bridge Registration] Pool registration failed:', response);
        sendLog('ERROR', 'Pool registration failed: ' + JSON.stringify(response));
      }
    } catch (error) {
      console.error('[AI Bridge Registration] Pool registration error:', error);
      sendLog('ERROR', 'Pool registration error: ' + error.message);
    }
  }
  
  function updatePoolRegisteredUI() {
    const overlay = document.getElementById('ai-bridge-overlay');
    if (!overlay) return;
    
    const statusDot = overlay.querySelector('.status-dot');
    const statusText = document.getElementById('overlay-status-text');
    
    if (statusDot) {
      statusDot.classList.remove('disconnected');
      statusDot.classList.add('connected');
    }
    if (statusText) {
      statusText.textContent = 'Registered';
    }
  }
  
  // ============================================
  // INITIALIZATION - DO NOT MODIFY
  // ============================================
  
  function init() {
    console.log('[AI Bridge Registration] Initializing...');
    sendLog('INFO', 'Initializing registration module...');
    
    // Proactively register to pool when page loads
    const registerToPoolDelayed = () => {
      setTimeout(() => {
        registerToPool();
      }, 2000); // Wait 2 seconds for page to fully load
    };
    
    // Wait for page to load
    if (document.readyState === 'loading') {
      sendLog('INFO', 'DOM still loading, will create overlay after DOMContentLoaded');
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(createOverlay, 1000);
        registerToPoolDelayed();
      });
    } else {
      sendLog('INFO', 'DOM already loaded, will create overlay in 1s');
      setTimeout(createOverlay, 1000);
      registerToPoolDelayed();
    }
  }
  
  init();
  
})();
