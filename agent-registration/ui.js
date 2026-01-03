// Agent Registration - UI Components
(function () {
    'use strict';

    window.AIBridge = window.AIBridge || {};
    window.AIBridge.ui = window.AIBridge.ui || {};

    const state = window.AIBridge.state;

    // ============================================
    // UI UPDATE FUNCTIONS
    // ============================================

    function updateRegisteredUI(num, role = null) {
        sendLog.bind(null, 'INFO')('[AI Bridge Registration] updateRegisteredUI called for session:', num, 'role:', role);

        const overlay = document.getElementById('ai-bridge-overlay');
        if (!overlay) {
            sendLog.bind(null, 'ERROR')('[AI Bridge Registration] Overlay not found!');
            return;
        }

        const statusDot = overlay.querySelector('.status-dot');
        const statusText = document.getElementById('overlay-status-text');
        const registeredView = document.getElementById('registered-view');
        const notRegisteredView = document.getElementById('not-registered-view');
        const actionStatus = document.getElementById('action-status');

        if (statusDot) {
            statusDot.classList.remove('disconnected');
            statusDot.classList.add('connected');
        }
        if (statusText) {
            if (role) {
                statusText.textContent = role;
            } else {
                statusText.textContent = `Participant ${num}`;
            }
        }

        if (registeredView) registeredView.style.display = 'block';
        if (notRegisteredView) notRegisteredView.style.display = 'none';

        if (actionStatus) {
            actionStatus.textContent = 'Ready';
            actionStatus.style.color = '#94a3b8';
        }

        overlay.classList.add('compact');
        sendLog.bind(null, 'INFO')('[AI Bridge Registration] updateRegisteredUI completed');
    }

    function updatePoolRegisteredUI() {
        const overlay = document.getElementById('ai-bridge-overlay');
        if (!overlay) return;

        const statusDot = overlay.querySelector('.status-dot');
        const statusText = document.getElementById('overlay-status-text');
        const registeredView = document.getElementById('registered-view');
        const notRegisteredView = document.getElementById('not-registered-view');
        const registrationStatusText = document.getElementById('registration-status-text');

        if (statusDot) {
            statusDot.className = 'status-dot disconnected';
            statusDot.style.background = '#f59e0b'; // Amber
        }
        if (statusText) {
            statusText.textContent = 'Waiting...';
        }

        if (registeredView) registeredView.style.display = 'none';
        if (notRegisteredView) notRegisteredView.style.display = 'block';

        if (registrationStatusText) {
            registrationStatusText.textContent = 'Auto-registering...';
            const subText = registrationStatusText.nextElementSibling;
            if (subText) subText.textContent = 'Assign from sidepanel';
        }

        overlay.classList.remove('compact');
    }

    function updateUnregisteredUI() {
        const overlay = document.getElementById('ai-bridge-overlay');
        if (!overlay) return;

        const statusDot = overlay.querySelector('.status-dot');
        const statusText = document.getElementById('overlay-status-text');
        const registeredView = document.getElementById('registered-view');
        const notRegisteredView = document.getElementById('not-registered-view');
        const registrationStatusText = document.getElementById('registration-status-text');
        const selector = document.getElementById('session-selector');

        if (statusDot) {
            statusDot.className = 'status-dot disconnected';
            statusDot.style.background = '';
        }
        if (statusText) {
            statusText.textContent = 'Waiting...';
        }

        if (registeredView) registeredView.style.display = 'none';
        if (notRegisteredView) notRegisteredView.style.display = 'block';

        if (registrationStatusText) {
            registrationStatusText.textContent = 'Auto-registering...';
        }

        overlay.classList.remove('compact');
        if (selector) selector.style.display = 'none';
    }

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

    // ============================================
    // DOM CREATION
    // ============================================

    function makeDraggable(element) {
        const header = element.querySelector('.ai-bridge-header');
        let isDragging = false;
        let offsetX, offsetY;

        header.onmousedown = function (e) {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
        };

        document.onmousemove = function (e) {
            if (!isDragging) return;
            element.style.left = (e.clientX - offsetX) + 'px';
            element.style.top = (e.clientY - offsetY) + 'px';
            element.style.right = 'auto';
        };

        document.onmouseup = function () {
            isDragging = false;
        };
    }

    function createOverlay() {
        const existing = document.getElementById('ai-bridge-overlay');
        if (existing) existing.remove();

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
            <div id="registration-status-text">Auto-registering...</div>
            <div style="font-size:9px;color:#64748b;margin-top:4px;">
              Assign from sidepanel
            </div>
          </div>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        // Toggle button
        document.getElementById('ai-bridge-toggle').onclick = function () {
            const content = overlay.querySelector('.ai-bridge-content');
            const isVisible = content.style.display !== 'none';
            content.style.display = isVisible ? 'none' : 'flex';
            this.textContent = isVisible ? '+' : '−';
        };

        // Unregister button
        document.getElementById('unregister-btn').onclick = () => {
            if (window.AIBridge.unregister) {
                window.AIBridge.unregister();
            }
        };

        // Manual capture button
        document.getElementById('manual-capture').onclick = function () {
            window.dispatchEvent(new CustomEvent('aiBridgeManualCapture'));
        };

        makeDraggable(overlay);
        updateUnregisteredUI(); // Initial state

        window.AIBridge.sendLog('INFO', 'Overlay created and initialized');
    }

    // Expose UI functions
    window.AIBridge.ui.updateRegisteredUI = updateRegisteredUI;
    window.AIBridge.ui.updatePoolRegisteredUI = updatePoolRegisteredUI;
    window.AIBridge.ui.updateUnregisteredUI = updateUnregisteredUI;
    window.AIBridge.ui.updateActionStatusFromState = updateActionStatusFromState;
    window.AIBridge.ui.createOverlay = createOverlay;

})();
