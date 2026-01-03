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
    const overlay = document.getElementById('ai-bridge-overlay');
    if (!overlay) return;
    
    const statusDot = overlay.querySelector('.status-dot');
    const statusText = overlay.querySelector('.status-text');
    const selector = document.getElementById('session-selector');
    const currentStatus = document.getElementById('current-status');
    const agentLabel = document.getElementById('agent-label');
    const actionStatus = document.getElementById('action-status');
    
    if (statusDot) {
      statusDot.classList.remove('disconnected');
      statusDot.classList.add('connected');
    }
    if (statusText) {
      statusText.textContent = 'Registered as ' + (num === 1 ? 'Agent A' : 'Agent B');
    }
    if (selector) selector.style.display = 'none';
    if (currentStatus) currentStatus.style.display = 'block';
    if (agentLabel) agentLabel.textContent = '🤖 ' + (num === 1 ? 'Agent A' : 'Agent B');
    if (actionStatus) actionStatus.textContent = 'Ready';
  }
  
  function updateUnregisteredUI() {
    const overlay = document.getElementById('ai-bridge-overlay');
    if (!overlay) return;
    
    const statusDot = overlay.querySelector('.status-dot');
    const statusText = overlay.querySelector('.status-text');
    const selector = document.getElementById('session-selector');
    const currentStatus = document.getElementById('current-status');
    
    if (statusDot) {
      statusDot.classList.remove('connected');
      statusDot.classList.add('disconnected');
    }
    if (statusText) {
      statusText.textContent = 'Not registered';
    }
    if (selector) selector.style.display = 'flex';
    if (currentStatus) currentStatus.style.display = 'none';
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
        <div class="ai-bridge-status">
          <span class="status-dot disconnected"></span>
          <span class="status-text">Not registered</span>
        </div>
        <div class="ai-bridge-session-selector" id="session-selector">
          <button id="register-session-1" class="session-btn">Register as Agent A</button>
          <button id="register-session-2" class="session-btn">Register as Agent B</button>
        </div>
        <div class="ai-bridge-current-status" id="current-status" style="display:none;">
          <div id="agent-label" style="font-weight:bold;color:#818cf8;margin-bottom:8px;"></div>
          <div id="action-status" style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Ready</div>
          <button id="manual-capture" class="session-btn" style="font-size:10px;padding:6px 10px;margin-right:5px;">📷 Capture</button>
          <button id="unregister-btn" class="session-btn danger" style="font-size:10px;padding:6px 10px;">Disconnect</button>
        </div>
        <div class="ai-bridge-info">
          <div id="platform-info">Platform: <strong>${state.platform}</strong></div>
          <div style="font-size:9px;color:#64748b;margin-top:2px;">Supports: ${supportedPlatforms}</div>
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
    
    console.log('[AI Bridge Registration] Overlay created');
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
    console.log('[AI Bridge Registration] Initializing...');
    
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(createOverlay, 1500));
    } else {
      setTimeout(createOverlay, 1500);
    }
  }
  
  init();
  
})();
