// Agent Registration - UI Components
(function () {
    'use strict';

    window.AIBridge = window.AIBridge || {};
    window.AIBridge.ui = window.AIBridge.ui || {};

    const state = window.AIBridge.state;

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

    // ============================================
    // UI UPDATE FUNCTIONS
    // ============================================

    function updateRegisteredUI(num, role = null) {
        safeLog('INFO', '[AI Bridge Registration] updateRegisteredUI called for session: ' + num + ', role: ' + role);

        const overlay = document.getElementById('ai-bridge-overlay');
        if (!overlay) {
            safeLog('ERROR', '[AI Bridge Registration] Overlay not found!');
            return;
        }

        const statusDot = overlay.querySelector('.status-dot');
        const statusText = document.getElementById('overlay-status-text');
        const disconnectBtn = document.getElementById('unregister-btn');

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

        if (disconnectBtn) {
            disconnectBtn.style.display = 'flex';
        }

        overlay.style.display = 'block';
        overlay.classList.add('compact');
        safeLog('INFO', '[AI Bridge Registration] updateRegisteredUI completed');
    }

    function updatePoolRegisteredUI() {
        const overlay = document.getElementById('ai-bridge-overlay');
        if (!overlay) return;

        overlay.style.display = 'none';
        overlay.classList.remove('compact');
    }

    function updateUnregisteredUI() {
        const overlay = document.getElementById('ai-bridge-overlay');
        if (!overlay) return;

        const disconnectBtn = document.getElementById('unregister-btn');
        if (disconnectBtn) {
            disconnectBtn.style.display = 'none';
        }

        overlay.style.display = 'none';
        overlay.classList.remove('compact');
    }

    function updateReloadRequiredUI() {
        const overlay = document.getElementById('ai-bridge-overlay');
        if (!overlay) return;

        const statusDot = overlay.querySelector('.status-dot');
        const statusText = document.getElementById('overlay-status-text');
        const disconnectBtn = document.getElementById('unregister-btn');
        const reloadView = document.getElementById('reload-view');
        const reloadMessage = document.getElementById('reload-message');

        if (statusDot) {
            statusDot.classList.remove('connected');
            statusDot.classList.add('disconnected');
            statusDot.style.background = '';
        }
        if (statusText) {
            statusText.textContent = '❌ Reload Required';
        }

        if (disconnectBtn) {
            disconnectBtn.style.display = 'none';
        }
        if (reloadView) reloadView.style.display = 'block';

        overlay.style.display = 'block';
        overlay.classList.remove('compact');

        // Auto-reload after 5 seconds with countdown
        if (reloadMessage) {
            let countdown = 5;
            reloadMessage.textContent = `Extension updated. Auto-reloading in ${countdown}s...`;
            
            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdown > 0) {
                    reloadMessage.textContent = `Extension updated. Auto-reloading in ${countdown}s...`;
                } else {
                    clearInterval(countdownInterval);
                    reloadMessage.textContent = 'Reloading...';
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                }
            }, 1000);

            // Store interval ID so we can clear it if user clicks button
            overlay._reloadCountdown = countdownInterval;
        }
    }

    function updateActionStatusFromState(conversationState) {
        // Action status removed - interface streamlined
        // Status is only shown in the status bar now
    }

    // ============================================
    // DOM CREATION
    // ============================================

    function makeDraggable(element) {
        const statusBar = element.querySelector('.ai-bridge-status');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        if (!statusBar) return;

        statusBar.style.cursor = 'move';
        statusBar.onmousedown = function (e) {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            // Get current position
            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            
            // Disable transitions during drag for smooth movement
            element.style.transition = 'none';
            element.style.cursor = 'grabbing';
            element.style.userSelect = 'none';
            
            e.preventDefault();
        };

        function handleMouseMove(e) {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            // Use transform for GPU-accelerated smooth movement
            element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        }

        function handleMouseUp() {
            if (!isDragging) return;
            
            isDragging = false;
            element.style.userSelect = '';
            
            // Get final position from transform
            const transform = element.style.transform;
            const matches = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
            
            if (matches) {
                const deltaX = parseFloat(matches[1]);
                const deltaY = parseFloat(matches[2]);
                
                // Convert transform to left/top for final position
                const finalLeft = initialLeft + deltaX;
                const finalTop = initialTop + deltaY;
                
                // Reset transform and set final position
                element.style.transform = '';
                element.style.transition = '';
                element.style.left = finalLeft + 'px';
                element.style.top = finalTop + 'px';
            }
            
            element.style.cursor = 'move';
        }

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Clean up on element removal
        const observer = new MutationObserver(() => {
            if (!document.body.contains(element)) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function createOverlay() {
        const existing = document.getElementById('ai-bridge-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ai-bridge-overlay';
        overlay.innerHTML = `
      <div class="ai-bridge-content">
        <!-- Status Display -->
        <div class="ai-bridge-status" id="overlay-status">
          <span class="status-dot disconnected"></span>
          <span class="status-text" id="overlay-status-text">Waiting...</span>
          <button id="unregister-btn" class="ai-bridge-disconnect-icon" title="Disconnect" style="display:none;">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        <!-- Reload Required View (default hidden) -->
        <div class="ai-bridge-reload-view" id="reload-view" style="display:none;">
          <div id="reload-message" class="reload-message">Extension updated. Please refresh page.</div>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        // Unregister button (disconnect icon)
        const unregisterBtn = document.getElementById('unregister-btn');
        if (unregisterBtn) {
            unregisterBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.AIBridge.unregister) {
                    window.AIBridge.unregister();
                }
            };
        }

        makeDraggable(overlay);
        updateUnregisteredUI(); // Initial state

        safeLog('INFO', 'Overlay created and initialized');
    }

    // Expose UI functions
    window.AIBridge.ui.updateRegisteredUI = updateRegisteredUI;
    window.AIBridge.ui.updatePoolRegisteredUI = updatePoolRegisteredUI;
    window.AIBridge.ui.updateUnregisteredUI = updateUnregisteredUI;
    window.AIBridge.ui.updateReloadRequiredUI = updateReloadRequiredUI;
    window.AIBridge.ui.updateActionStatusFromState = updateActionStatusFromState;
    window.AIBridge.ui.createOverlay = createOverlay;

})();
