// Backend WebSocket Client for Extension
// Connects extension to backend server

(function() {
  'use strict';
  
  const BACKEND_URL = 'ws://localhost:3000/ws/extension';
  const RECONNECT_DELAY = 3000;
  const MAX_RECONNECT_ATTEMPTS = 10;
  
  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimeout = null;
  let isConnecting = false;
  let extensionId = null;
  
  // ============================================
  // WEBSOCKET CONNECTION
  // ============================================
  
  function connect() {
    if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) {
      return;
    }
    
    isConnecting = true;
    console.log('[Backend Client] Connecting to backend...');
    
    // Notify background that we're connecting
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ 
        type: 'BACKEND_STATUS_UPDATE',
        status: { connected: false, status: 'connecting' }
      }).catch(() => {});
    }
    
    try {
      ws = new WebSocket(BACKEND_URL);
      
      ws.onopen = () => {
        console.log('[Backend Client] ✅ Connected to backend');
        isConnecting = false;
        reconnectAttempts = 0;
        // Notify background if in extension context
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ 
            type: 'BACKEND_CONNECTED',
            extensionId: extensionId
          }).catch(() => {});
        }
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleBackendMessage(message);
        } catch (error) {
          console.error('[Backend Client] Error parsing message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('[Backend Client] WebSocket error:', error);
        isConnecting = false;
      };
      
      ws.onclose = (event) => {
        console.log('[Backend Client] Disconnected from backend, code:', event.code, 'reason:', event.reason);
        isConnecting = false;
        sendToBackground({ type: 'BACKEND_DISCONNECTED' });
        
        // Attempt reconnect
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`[Backend Client] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          reconnectTimeout = setTimeout(connect, RECONNECT_DELAY);
        } else {
          console.error('[Backend Client] Max reconnect attempts reached. Will retry when manually triggered.');
          sendToBackground({ 
            type: 'BACKEND_STATUS_UPDATE',
            status: { 
              connected: false, 
              status: 'disconnected',
              error: 'Max reconnect attempts reached. Please check if backend server is running at localhost:3000'
            }
          });
        }
      };
      
    } catch (error) {
      console.error('[Backend Client] Connection error:', error);
      isConnecting = false;
    }
  }
  
  // ============================================
  // MESSAGE HANDLING
  // ============================================
  
  function handleBackendMessage(message) {
    console.log('[Backend Client] Received from backend:', message.type);
    
    switch (message.type) {
      case 'CONNECTION_ESTABLISHED':
        extensionId = message.extensionId;
        console.log('[Backend Client] Extension ID:', extensionId);
        sendToBackground({ 
          type: 'BACKEND_CONNECTED',
          extensionId: extensionId
        });
        break;
      
      case 'CLIENT_MESSAGE':
        // Backend wants us to send a message to AI chat
        handleClientMessage(message);
        break;
      
      case 'PONG':
        // Heartbeat response
        break;
      
      default:
        console.warn('[Backend Client] Unknown message type:', message.type);
    }
  }
  
  async function handleClientMessage(message) {
    const { requestId, conversationId, message: text } = message;
    
    console.log('[Backend Client] Processing client message:', requestId);
    console.log('[Backend Client] Message type:', typeof text, 'value:', text);
    
    // Ensure message is a string
    let messageText = text;
    if (typeof text !== 'string') {
      console.warn('[Backend Client] Message is not a string, converting...', typeof text, text);
      if (Array.isArray(text)) {
        messageText = text.map(item => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && item.text) return item.text;
          return String(item);
        }).join('\n');
      } else if (text && typeof text === 'object') {
        messageText = text.text || text.content || text.message || JSON.stringify(text);
      } else {
        messageText = String(text);
      }
    }
    
    if (!messageText || messageText.trim().length === 0) {
      sendErrorToBackend(requestId, 'Message is empty or invalid');
      return;
    }
    
    console.log('[Backend Client] Final message text:', messageText.substring(0, 100));
    
    try {
      // Get available session directly from background
      const sessionResponse = await chrome.runtime.sendMessage({ type: 'GET_AVAILABLE_SESSION' });
      
      console.log('[Backend Client] Available session response:', JSON.stringify(sessionResponse));
      
      if (!sessionResponse) {
        sendErrorToBackend(requestId, 'Failed to get session information');
        return;
      }
      
      if (!sessionResponse.available || !sessionResponse.sessionNum) {
        console.warn('[Backend Client] No session available, trying auto-register...');
        
        // Try to trigger auto-registration
        try {
          await chrome.runtime.sendMessage({ type: 'AUTO_REGISTER_TABS' });
          console.log('[Backend Client] Auto-register triggered, waiting 2s...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Try again
          const retryResponse = await chrome.runtime.sendMessage({ type: 'GET_AVAILABLE_SESSION' });
          console.log('[Backend Client] Retry response:', JSON.stringify(retryResponse));
          
          if (retryResponse && retryResponse.available && retryResponse.sessionNum) {
            console.log('[Backend Client] Session found after auto-register!');
            // Continue with retryResponse
            const sessionNum = retryResponse.sessionNum;
            
            const sendResult = await chrome.runtime.sendMessage({
              type: 'SEND_TO_SESSION',
              sessionNum: sessionNum,
              text: messageText,
              requestId: requestId,
              conversationId: conversationId
            });
            
            if (!sendResult || !sendResult.success) {
              sendErrorToBackend(requestId, sendResult.error || 'Failed to send message to chat');
              return;
            }
            
            console.log('[Backend Client] Message sent to session', sessionNum, ', waiting for response...');
            return; // Success!
          }
        } catch (autoRegError) {
          console.error('[Backend Client] Auto-register failed:', autoRegError);
        }
        
        // If still no session, return error
        console.error('[Backend Client] No session available after retry. Response:', JSON.stringify(sessionResponse));
        const errorMsg = 'No registered session available. Please register as Agent A or B first. ' +
          `Session 1: ${sessionResponse.session1?.hasTabId ? 'registered' : 'not registered'}, ` +
          `Session 2: ${sessionResponse.session2?.hasTabId ? 'registered' : 'not registered'}`;
        sendErrorToBackend(requestId, errorMsg);
        return;
      }
      
      const sessionNum = sessionResponse.sessionNum;
      console.log('[Backend Client] Using session:', sessionNum, 'tabId:', sessionResponse.tabId, 'platform:', sessionResponse.platform);
      
      // Send message via background script (which will forward to content script)
      const sendResult = await chrome.runtime.sendMessage({
        type: 'SEND_TO_SESSION',
        sessionNum: sessionNum,
        text: messageText, // Use processed message text
        requestId: requestId,
        conversationId: conversationId
      });
      
      if (!sendResult || !sendResult.success) {
        sendErrorToBackend(requestId, sendResult.error || 'Failed to send message to chat');
        return;
      }
      
      console.log('[Backend Client] Message sent to session', sessionNum, ', waiting for response...');
      
      // Response will be sent via content script -> background -> backend client
      // We'll handle it in the message listener below
      
    } catch (error) {
      console.error('[Backend Client] Error handling client message:', error);
      sendErrorToBackend(requestId, error.message);
    }
  }
  
  // ============================================
  // SEND TO BACKEND
  // ============================================
  
  function sendToBackend(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[Backend Client] Cannot send - not connected');
      return false;
    }
    
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[Backend Client] Error sending to backend:', error);
      return false;
    }
  }
  
  function sendErrorToBackend(requestId, error) {
    sendToBackend({
      type: 'ERROR',
      requestId: requestId,
      error: error
    });
  }
  
  function sendResponseToBackend(requestId, response) {
    sendToBackend({
      type: 'AI_RESPONSE',
      requestId: requestId,
      response: response
    });
  }
  
  // Helper to send message to background (if available)
  function sendToBackground(message) {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  }
  
  // ============================================
  // LISTEN TO BACKGROUND MESSAGES
  // ============================================
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AI_RESPONSE_FOR_BACKEND') {
      // Background received AI response and wants to send to backend
      const { requestId, response } = message;
      sendResponseToBackend(requestId, response);
      sendResponse({ success: true });
      return true;
    }
    
    if (message.type === 'BACKEND_SEND_MESSAGE') {
      // Manual send to backend (for testing)
      sendToBackend(message.data);
      sendResponse({ success: true });
      return true;
    }
  });
  
  // ============================================
  // INITIALIZE
  // ============================================
  
  // Connect on startup
  connect();
  
  // Also listen for connect command from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'BACKEND_CONNECT') {
      connect();
    }
  });
  
  // Expose for debugging
  window.BackendClient = {
    connect,
    disconnect: () => {
      if (ws) {
        ws.close();
      }
    },
    send: sendToBackend,
    getStatus: () => ({
      connected: ws && ws.readyState === WebSocket.OPEN,
      extensionId: extensionId
    })
  };
  
  console.log('[Backend Client] Initialized');
  
})();

