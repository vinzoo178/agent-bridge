# AI Chat Bridge Backend Server

Backend proxy server để giao tiếp giữa client và Chrome extension.

## Kiến trúc

```
Client (HTTP API) 
    ↓
Backend Server (Express + WebSocket)
    ↓
Chrome Extension (WebSocket)
    ↓
AI Chat (Gemini, ChatGPT, etc.)
```

## Cài đặt

```bash
cd backend
npm install
```

## Chạy server

```bash
npm start
```

Hoặc development mode (auto-reload):

```bash
npm run dev
```

Server sẽ chạy tại:
- **REST API**: http://localhost:3000/api/v1
- **WebSocket**: ws://localhost:3000/ws/extension

## API Endpoints

### Health Check
```
GET /api/v1/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-03T12:00:00.000Z",
  "connectedExtensions": 1
}
```

### List Extensions
```
GET /api/v1/extensions
```

Response:
```json
{
  "extensions": [
    {
      "id": "uuid",
      "ready": true,
      "connectedAt": "2024-01-03T12:00:00.000Z"
    }
  ]
}
```

### Send Message to AI Chat (Simple Format)
```
POST /api/v1/chat
Content-Type: application/json

{
  "message": "Hello, how are you?",
  "extensionId": "optional-uuid",
  "conversationId": "optional-uuid"
}
```

Response:
```json
{
  "success": true,
  "requestId": "uuid",
  "conversationId": "uuid",
  "response": "AI response text...",
  "timestamp": "2024-01-03T12:00:00.000Z"
}
```

### Send Message to AI Chat (OpenRouter-Compatible Format)
```
POST /api/v1/chat/completions
Content-Type: application/json

{
  "model": "ai-chat-bridge-extension",
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "extensionId": "optional-uuid",
  "conversationId": "optional-uuid"
}
```

Response (OpenRouter format):
```json
{
  "id": "chatcmpl-uuid",
  "object": "chat.completion",
  "created": 1704278400,
  "model": "ai-chat-bridge-extension",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "AI response text..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

**Note**: Endpoint `/api/v1/chat/completions` is compatible with OpenRouter API format, making it easy to integrate with existing OpenRouter clients.

### Get Conversation History
```
GET /api/v1/conversations/:conversationId
```

### List All Conversations
```
GET /api/v1/conversations
```

## WebSocket Protocol

Extension kết nối đến: `ws://localhost:3000/ws/extension`

### Messages từ Backend → Extension

**CLIENT_MESSAGE**
```json
{
  "type": "CLIENT_MESSAGE",
  "requestId": "uuid",
  "conversationId": "uuid",
  "message": "User message",
  "timestamp": "2024-01-03T12:00:00.000Z"
}
```

### Messages từ Extension → Backend

**AI_RESPONSE**
```json
{
  "type": "AI_RESPONSE",
  "requestId": "uuid",
  "response": "AI response text"
}
```

**ERROR**
```json
{
  "type": "ERROR",
  "requestId": "uuid",
  "error": "Error message"
}
```

**PING** (heartbeat)
```json
{
  "type": "PING"
}
```

## Ví dụ sử dụng

### Python Client

```python
import requests

# Send message
response = requests.post('http://localhost:3000/api/v1/chat', json={
    'message': 'Hello, how are you?'
})

print(response.json()['response'])
```

### JavaScript/Node.js Client

```javascript
const response = await fetch('http://localhost:3000/api/v1/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Hello, how are you?'
  })
});

const data = await response.json();
console.log(data.response);
```

### cURL

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, how are you?"}'
```

## Cấu hình

Mặc định server chạy trên port 3000. Để thay đổi:

```bash
PORT=8080 npm start
```

## Troubleshooting

### Extension không kết nối được

1. Kiểm tra extension đã được load chưa
2. Kiểm tra backend server đang chạy
3. Kiểm tra console của extension (F12)
4. Đảm bảo đã register Agent A hoặc B trong extension

### Request timeout

- Mặc định timeout là 30 giây
- Nếu AI chat trả lời chậm, có thể cần tăng timeout trong code

## License

MIT

