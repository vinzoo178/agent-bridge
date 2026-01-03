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
  
  // Helper to send logs to background
  function sendLog(level, message) {
    try {
      chrome.runtime.sendMessage({
        type: 'ADD_LOG',
        entry: {
          timestamp: new Date().toISOString(),
          level: level,
          source: 'Registration',
          message: message
        }
      }, (response) => {
        // Ignore response and errors
        if (chrome.runtime.lastError) {
          // Silently ignore - extension might not be ready
        }
      });
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
    sendLog('INFO', `updateRegisteredUI called for session ${num}`);
    console.log('[AI Bridge Registration] updateRegisteredUI called for session:', num);
    
    const overlay = document.getElementById('ai-bridge-overlay');
    if (!overlay) {
      sendLog('ERROR', 'Overlay not found!');
      console.error('[AI Bridge Registration] Overlay not found!');
      return;
    }
    
    const statusDot = overlay.querySelector('.status-dot');
    const statusText = document.getElementById('overlay-status-text');
    const registeredView = document.getElementById('registered-view');
    const notRegisteredView = document.getElementById('not-registered-view');
    const selector = document.getElementById('session-selector');
    const agentLabel = document.getElementById('agent-label');
    const actionStatus = document.getElementById('action-status');
    const platformInfo = document.getElementById('platform-info');
    
    sendLog('INFO', `Elements found - statusDot: ${!!statusDot}, statusText: ${!!statusText}, registeredView: ${!!registeredView}`);
    
    // Update status indicator
    if (statusDot) {
      statusDot.classList.remove('disconnected');
      statusDot.classList.add('connected');
      sendLog('INFO', 'Status dot updated to connected');
    }
    if (statusText) {
      statusText.textContent = (num === 1 ? 'Agent A' : 'Agent B');
      sendLog('INFO', 'Status text updated to: ' + statusText.textContent);
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
    
    // Update agent info
    if (agentLabel) {
      agentLabel.textContent = '🤖 ' + (num === 1 ? 'Agent A' : 'Agent B');
    }
    if (actionStatus) {
      actionStatus.textContent = 'Ready';
    }
    
    // Make overlay more compact when registered
    overlay.classList.add('compact');
    
    // Update platform info
    if (platformInfo) {
      platformInfo.innerHTML = `<strong>${state.platform}</strong>`;
    }
    
    sendLog('INFO', 'updateRegisteredUI completed successfully');
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
          <div id="agent-label" style="font-weight:bold;color:#818cf8;margin-bottom:6px;font-size:12px;"></div>
          <div id="action-status" style="font-size:10px;color:#94a3b8;margin-bottom:8px;">Ready</div>
          <div class="ai-bridge-quick-actions">
            <button id="manual-capture" class="session-btn small" title="Manually capture AI response">📷</button>
            <button id="unregister-btn" class="session-btn small danger" title="Disconnect">✕</button>
          </div>
        </div>
        
        <!-- Not Registered View (default hidden) -->
        <div class="ai-bridge-not-registered-view" id="not-registered-view" style="display:none;">
          <div style="font-size:10px;color:#94a3b8;margin-bottom:8px;text-align:center;">
            Auto-registering when detected...
          </div>
          <div class="ai-bridge-session-selector" id="session-selector" style="display:none;">
            <button id="register-session-1" class="session-btn small">Agent A</button>
            <button id="register-session-2" class="session-btn small">Agent B</button>
          </div>
        </div>
        
        <!-- Info Footer -->
        <div class="ai-bridge-info">
          <div id="platform-info" style="font-size:9px;">Platform: <strong>${state.platform}</strong></div>
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
    
    // Check registration status immediately (don't wait for periodic check)
    sendLog('INFO', 'Overlay created, will check registration in 100ms');
    setTimeout(() => {
      sendLog('INFO', 'Calling checkExistingRegistration()');
      checkExistingRegistration();
    }, 100);
    
    // Check registration status periodically
    checkRegistrationPeriodically();
    
    // Listen for storage changes to auto-update registration status
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      
      // Check if registration data changed
      if (changes.session1_tabId || changes.session1_platform || 
          changes.session2_tabId || changes.session2_platform) {
        sendLog('INFO', 'Registration storage changed, rechecking...');
        setTimeout(() => {
          checkExistingRegistration();
        }, 200);
      }
    });
    
    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Don't intercept CHECK_TAB_REGISTRATION - let it go to background
      if (message.type === 'CHECK_TAB_REGISTRATION') {
        return false; // Let background handle it
      }
      
      sendLog('INFO', 'Received message: ' + message.type);
      console.log('[AI Bridge Registration] Received message:', message.type, message);
      
      if (message.type === 'STATE_UPDATE') {
        updateActionStatusFromState(message.state);
        return false; // Not async, no need to keep channel open
      } else if (message.type === 'REGISTRATION_CONFIRMED') {
        // Registration confirmed by background (e.g., from auto-register)
        sendLog('INFO', 'Registration confirmed: Session ' + message.sessionNum);
        console.log('[AI Bridge Registration] Registration confirmed:', message);
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
        return false; // Not async, no need to keep channel open
      }
      
      // For all other messages, return false to let other listeners handle them
      return false;
    });
    
    sendLog('INFO', 'Overlay created and initialized');
    console.log('[AI Bridge Registration] Overlay created');
  }
  
  // Check existing registration from storage directly
  async function checkExistingRegistration() {
    try {
      sendLog('INFO', 'Checking registration status from storage...');
      console.log('[AI Bridge Registration] Checking registration status...');
      
      // Get current tab ID from background (content scripts can't use chrome.tabs.query)
      // Retry up to 3 times if needed
      let currentTabId = null;
      for (let attempt = 0; attempt < 3 && !currentTabId; attempt++) {
        currentTabId = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve(null);
          }, 1000); // 1 second timeout
          
          chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_ID' }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              if (attempt < 2) {
                // Don't log on first attempts, only on final failure
                resolve(null);
              } else {
                sendLog('WARN', 'Could not get tab ID: ' + chrome.runtime.lastError.message);
                resolve(null);
              }
            } else if (response && response.tabId) {
              resolve(response.tabId);
            } else {
              resolve(null);
            }
          });
        });
        
        if (currentTabId) break;
        // Wait a bit before retry
        if (attempt < 2) await new Promise(r => setTimeout(r, 100));
      }
      
      if (!currentTabId) {
        sendLog('WARN', 'Could not get current tab ID, will check by platform match');
        // Fallback: check by platform match
        const storage = await chrome.storage.local.get([
          'session1_tabId', 'session1_platform',
          'session2_tabId', 'session2_platform'
        ]);
        
        // If only one session matches current platform, assume it's this tab
        if (storage.session1_platform === state.platform && !storage.session2_tabId) {
          sendLog('INFO', 'Found single session matching platform, assuming Session 1');
          state.isRegistered = true;
          state.sessionNum = 1;
          updateRegisteredUI(1);
          window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
            detail: { sessionNum: 1, platform: state.platform }
          }));
          return;
        } else if (storage.session2_platform === state.platform && !storage.session1_tabId) {
          sendLog('INFO', 'Found single session matching platform, assuming Session 2');
          state.isRegistered = true;
          state.sessionNum = 2;
          updateRegisteredUI(2);
          window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
            detail: { sessionNum: 2, platform: state.platform }
          }));
          return;
        }
        
        updateUnregisteredUI();
        return;
      }
      
      sendLog('INFO', 'Current tab ID: ' + currentTabId);
      
      // Check storage directly
      const storage = await chrome.storage.local.get([
        'session1_tabId', 'session1_platform',
        'session2_tabId', 'session2_platform'
      ]);
      
      sendLog('INFO', 'Storage data: ' + JSON.stringify(storage));
      
      // Check if current tab is registered
      let sessionNum = null;
      if (storage.session1_tabId && Number(storage.session1_tabId) === Number(currentTabId)) {
        sessionNum = 1;
      } else if (storage.session2_tabId && Number(storage.session2_tabId) === Number(currentTabId)) {
        sessionNum = 2;
      }
      
      if (sessionNum) {
        // Update state
        state.isRegistered = true;
        state.sessionNum = sessionNum;
        
        sendLog('INFO', `Registration found in storage! Session: ${sessionNum}`);
        console.log('[AI Bridge Registration] Registration found! Session:', sessionNum);
        
        // Update UI
        updateRegisteredUI(sessionNum);
        
        // Notify main content script
        window.dispatchEvent(new CustomEvent('aiBridgeRegistered', {
          detail: { 
            sessionNum: sessionNum, 
            platform: state.platform 
          }
        }));
        
        sendLog('INFO', 'UI updated and event dispatched');
        console.log('[AI Bridge Registration] UI updated and event dispatched');
      } else {
        // Not registered
        sendLog('INFO', 'Not registered in storage');
        console.log('[AI Bridge Registration] Not registered');
        if (!state.isRegistered) {
          updateUnregisteredUI();
        }
      }
    } catch (error) {
      sendLog('ERROR', 'Check failed: ' + error.message);
      console.error('[AI Bridge Registration] Check failed:', error);
      // If not registered, show unregistered UI
      if (!state.isRegistered) {
        updateUnregisteredUI();
      }
    }
  }
  
  // Check registration status periodically
  let checkCount = 0;
  function checkRegistrationPeriodically() {
    // Check immediately
    checkExistingRegistration();
    
    // Then check every 3 seconds
    const interval = setInterval(() => {
      checkCount++;
      checkExistingRegistration();
      
      // After 3 checks (9 seconds), show manual register buttons if still not registered
      if (checkCount >= 3 && !state.isRegistered) {
        const selector = document.getElementById('session-selector');
        if (selector) {
          selector.style.display = 'flex';
          const statusText = document.getElementById('overlay-status-text');
          if (statusText) {
            statusText.textContent = 'Not registered';
          }
        }
      }
    }, 3000);
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
        actionStatus.textContent = '🎯 Your turn!';
        actionStatus.style.color = '#818cf8';
      } else {
        actionStatus.textContent = '⏳ Waiting...';
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
  // INITIALIZATION - DO NOT MODIFY
  // ============================================
  
  function init() {
    sendLog('INFO', 'Initializing registration module...');
    console.log('[AI Bridge Registration] Initializing...');
    
    // Wait for page to load
    if (document.readyState === 'loading') {
      sendLog('INFO', 'DOM still loading, will create overlay after DOMContentLoaded');
      document.addEventListener('DOMContentLoaded', () => {
        sendLog('INFO', 'DOMContentLoaded fired, will create overlay in 1.5s');
        setTimeout(createOverlay, 1500);
      });
    } else {
      sendLog('INFO', 'DOM already loaded, will create overlay in 1.5s');
      setTimeout(createOverlay, 1500);
    }
  }
  
  init();
  
})();
