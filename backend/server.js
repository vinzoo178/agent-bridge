// AI Chat Bridge Backend Server
// Proxy server between clients and Chrome extension

import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import http from 'http';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// MESSAGE QUEUE & ROUTING
// ============================================

// Store pending requests from clients
const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }

// Store connected extensions
const extensionConnections = new Map(); // extensionId -> WebSocket

// Store active conversations
const activeConversations = new Map(); // conversationId -> { clientId, extensionId, messages }

// ============================================
// REST API FOR CLIENTS
// ============================================

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connectedExtensions: extensionConnections.size
  });
});

// Get list of available extensions
app.get('/api/v1/extensions', (req, res) => {
  const extensions = Array.from(extensionConnections.entries()).map(([id, ws]) => ({
    id,
    ready: ws.readyState === 1,
    connectedAt: ws.connectedAt || new Date().toISOString(),
    state: ws.readyState === 1 ? 'open' : ws.readyState === 0 ? 'connecting' : 'closed'
  }));
  
  res.json({ 
    extensions,
    total: extensions.length,
    connected: extensions.filter(e => e.ready).length
  });
});

// Send message to extension (proxy to AI chat)
// Supports both simple format and OpenRouter-compatible format
app.post('/api/v1/chat', async (req, res) => {
  const { message, extensionId, conversationId } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  return handleChatRequest(req, res, message, extensionId, conversationId);
});

// OpenRouter-compatible endpoint
app.post('/api/v1/chat/completions', async (req, res) => {
  const { messages, model, extensionId, conversationId } = req.body;
  
  // Extract message from OpenRouter format
  let message = null;
  if (messages && Array.isArray(messages) && messages.length > 0) {
    // Get last user message
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user' && lastMessage.content) {
      message = extractMessageContent(lastMessage.content);
    } else {
      // Fallback: get any message with content
      for (const msg of [...messages].reverse()) {
        if (msg.content) {
          message = extractMessageContent(msg.content);
          if (message) break;
        }
      }
    }
  }
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ 
      error: {
        message: 'Invalid request format. Expected messages array with user content (string).',
        type: 'invalid_request_error',
        code: 400
      }
    });
  }
  
  return handleChatRequest(req, res, message, extensionId, conversationId, true);
});

// Helper to extract message content from various formats
function extractMessageContent(content) {
  if (!content) return null;
  
  // If it's already a string, return it
  if (typeof content === 'string') {
    return content;
  }
  
  // If it's an array (OpenRouter format with multiple content items)
  if (Array.isArray(content)) {
    // Extract text from each item
    const textParts = content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        } else if (item && typeof item === 'object') {
          // Handle content blocks (text, image_url, etc.)
          if (item.type === 'text' && item.text) {
            return item.text;
          } else if (item.text) {
            return item.text;
          } else if (item.content) {
            return extractMessageContent(item.content);
          }
        }
        return null;
      })
      .filter(part => part !== null);
    
    return textParts.join('\n');
  }
  
  // If it's an object
  if (typeof content === 'object') {
    // Try common properties
    if (content.text) return content.text;
    if (content.content) return extractMessageContent(content.content);
    if (content.message) return extractMessageContent(content.message);
    
    // Last resort: stringify (but this shouldn't happen)
    console.warn('[API] Unexpected content format:', typeof content, content);
    return JSON.stringify(content);
  }
  
  // Fallback: convert to string
  return String(content);
}

// Common handler for chat requests
async function handleChatRequest(req, res, message, extensionId, conversationId, openrouterFormat = false) {
  // Ensure message is a string
  if (typeof message !== 'string') {
    message = extractMessageContent(message) || String(message);
  }
  
  // Validate message is not empty
  if (!message || message.trim().length === 0) {
    const errorResponse = openrouterFormat ? {
      error: {
        message: 'Message cannot be empty',
        type: 'invalid_request_error',
        code: 400
      }
    } : {
      error: 'Message cannot be empty'
    };
    return res.status(400).json(errorResponse);
  }
  
  // Generate conversation ID if not provided
  const convId = conversationId || uuidv4();
  
  // Find extension
  let extensionWs = null;
  if (extensionId) {
    extensionWs = extensionConnections.get(extensionId);
  } else {
    // Use first available extension
    const firstExtension = Array.from(extensionConnections.entries())[0];
    if (firstExtension) {
      extensionWs = firstExtension[1];
    }
  }
  
  if (!extensionWs || extensionWs.readyState !== 1) {
    const errorResponse = {
      error: 'No extension available',
      availableExtensions: extensionConnections.size,
      help: 'Make sure: 1) Extension is loaded in Chrome, 2) Backend client is connected (check Side Panel), 3) At least one Agent is registered'
    };
    
    if (openrouterFormat) {
      errorResponse.error = {
        message: 'No extension available. Please ensure the Chrome extension is loaded and connected to the backend server.',
        type: 'service_unavailable',
        code: 503
      };
      errorResponse.help = 'Make sure: 1) Extension is loaded in Chrome, 2) Backend client is connected (check Side Panel), 3) At least one Agent is registered';
    }
    
    console.error('[API] No extension available. Total connections:', extensionConnections.size);
    return res.status(503).json(errorResponse);
  }
  
  // Create request ID
  const requestId = uuidv4();
  
  // Use extended timeout to handle slow platforms like z.ai with deepthink mode
  // z.ai deepthink can take 5-10 minutes, so use 10 minutes as default
  // This is safe for all platforms - faster platforms will just respond sooner
  const timeoutMs = 600000; // 10 minutes (handles z.ai deepthink and other slow responses)
  
  // Create promise that will be resolved when extension responds
  const responsePromise = new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout: setTimeout(() => {
        pendingRequests.delete(requestId);
        const timeoutSeconds = Math.floor(timeoutMs / 1000);
        reject(new Error(`Request timeout (${timeoutSeconds}s)`));
      }, timeoutMs)
    });
  });
  
  // Log message for debugging
  console.log(`[API] Processing message (type: ${typeof message}, length: ${message.length}):`, message.substring(0, 100));
  
  // Send message to extension
  const messageToExtension = {
    type: 'CLIENT_MESSAGE',
    requestId,
    conversationId: convId,
    message: message, // Ensure it's a string
    timestamp: new Date().toISOString()
  };
  
  try {
    extensionWs.send(JSON.stringify(messageToExtension));
    console.log(`[API] Sent message to extension ${extensionWs.extensionId}, requestId: ${requestId}, message preview: ${message.substring(0, 50)}...`);
    
    // Wait for response from extension
    const response = await responsePromise;
    
    // Update conversation history
    if (!activeConversations.has(convId)) {
      activeConversations.set(convId, {
        clientId: req.ip,
        extensionId: extensionWs.extensionId,
        messages: []
      });
    }
    
    const conversation = activeConversations.get(convId);
    conversation.messages.push({
      requestId,
      message,
      response: response.response,
      timestamp: new Date().toISOString()
    });
    
    // Return response in appropriate format
    if (openrouterFormat) {
      // OpenRouter-compatible response format
      res.json({
        id: `chatcmpl-${requestId}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'ai-chat-bridge-extension',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.response
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    } else {
      // Simple format
      res.json({
        success: true,
        requestId,
        conversationId: convId,
        response: response.response,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('[API] Error:', error);
    
    if (openrouterFormat) {
      res.status(500).json({
        error: {
          message: error.message || 'Internal server error',
          type: 'server_error',
          code: 500
        }
      });
    } else {
      res.status(500).json({ 
        error: error.message || 'Internal server error',
        requestId
      });
    }
  }
}

// Get conversation history
app.get('/api/v1/conversations/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const conversation = activeConversations.get(conversationId);
  
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  
  res.json({
    conversationId,
    ...conversation
  });
});

// List all conversations
app.get('/api/v1/conversations', (req, res) => {
  const conversations = Array.from(activeConversations.entries()).map(([id, conv]) => ({
    conversationId: id,
    messageCount: conv.messages.length,
    lastMessage: conv.messages[conv.messages.length - 1]?.timestamp,
    extensionId: conv.extensionId
  }));
  
  res.json({ conversations });
});

// ============================================
// WEBSOCKET SERVER FOR EXTENSION
// ============================================

const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server,
  path: '/ws/extension'
});

wss.on('connection', (ws, req) => {
  const extensionId = uuidv4();
  ws.extensionId = extensionId;
  ws.connectedAt = new Date().toISOString();
  
  console.log(`[WS] Extension connected: ${extensionId}`);
  
  // Store connection
  extensionConnections.set(extensionId, ws);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'CONNECTION_ESTABLISHED',
    extensionId,
    timestamp: new Date().toISOString()
  }));
  
  // Handle messages from extension
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[WS] Message from extension ${extensionId}:`, message.type);
      
      switch (message.type) {
        case 'AI_RESPONSE':
          // Extension sent AI response - resolve pending request
          handleExtensionResponse(message);
          break;
        
        case 'ERROR':
          // Extension sent error
          handleExtensionError(message);
          break;
        
        case 'PING':
          // Heartbeat
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        
        default:
          console.warn(`[WS] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[WS] Error parsing message:', error);
    }
  });
  
  // Handle disconnect
  ws.on('close', () => {
    console.log(`[WS] Extension disconnected: ${extensionId}`);
    extensionConnections.delete(extensionId);
    
    // Reject all pending requests for this extension
    for (const [requestId, pending] of pendingRequests.entries()) {
      if (pending.extensionId === extensionId) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Extension disconnected'));
        pendingRequests.delete(requestId);
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error(`[WS] Extension ${extensionId} error:`, error);
  });
});

// Handle AI response from extension
function handleExtensionResponse(message) {
  const { requestId, response, error } = message;
  
  if (!requestId) {
    console.warn('[WS] Response without requestId');
    return;
  }
  
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    console.warn(`[WS] No pending request found for: ${requestId}`);
    return;
  }
  
  // Clear timeout
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  
  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve({ response });
  }
}

// Handle error from extension
function handleExtensionError(message) {
  const { requestId, error } = message;
  
  if (requestId) {
    const pending = pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);
      pending.reject(new Error(error || 'Extension error'));
    }
  }
  
  console.error(`[WS] Extension error:`, error);
}

// ============================================
// START SERVER
// ============================================

server.listen(PORT, () => {
  console.log(`🚀 AI Chat Bridge Backend Server`);
  console.log(`📡 REST API: http://localhost:${PORT}/api/v1`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws/extension`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /api/v1/health`);
  console.log(`  GET  /api/v1/extensions`);
  console.log(`  POST /api/v1/chat`);
  console.log(`  POST /api/v1/chat/completions (OpenRouter-compatible)`);
  console.log(`  GET  /api/v1/conversations`);
  console.log(`  GET  /api/v1/conversations/:id`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

