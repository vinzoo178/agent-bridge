# AI Chat Bridge 🤖🔗🤖

Chrome extension cho phép 2 phiên chat AI tự động nói chuyện với nhau.

## Hỗ trợ các nền tảng

| Platform | URL | Status |
|----------|-----|--------|
| 🔷 Google Gemini | gemini.google.com | ✅ Tested |
| 🟢 ChatGPT | chatgpt.com, chat.openai.com | ✅ Tested |
| 🔵 DeepSeek | chat.deepseek.com | 🔄 Ready |
| 🦆 DuckDuckGo AI | duckduckgo.com/?ia=chat, duck.ai | 🔄 Ready |

## Tính năng

- **Kết nối 2 AI Sessions**: Mở 2 tab AI chat và đăng ký chúng như Agent A và Agent B
- **Multi-platform**: Hỗ trợ nhiều nền tảng AI chat
- **Tự động gửi tin nhắn**: Extension tự động chuyển tin nhắn giữa 2 session
- **Theo dõi hội thoại**: Xem toàn bộ cuộc hội thoại trong Side Panel
- **Templates có sẵn**: Debate, Story, Q&A, Brainstorm
- **Dễ mở rộng**: Thêm platform mới dễ dàng

## Cài đặt

1. Mở Chrome và vào `chrome://extensions/`
2. Bật **Developer mode** (góc phải trên)
3. Click **Load unpacked**
4. Chọn thư mục `ai-chat-bridge-extension`

## Cách sử dụng

### Bước 1: Mở 2 tab AI chat

Mở 2 tab trình duyệt với bất kỳ platform nào được hỗ trợ:
- Tab 1: https://gemini.google.com
- Tab 2: https://chatgpt.com (hoặc platform khác)

### Bước 2: Đăng ký Sessions

Trên mỗi tab, bạn sẽ thấy một overlay nhỏ ở góc phải:

- **Tab 1**: Click "Register as Agent A"
- **Tab 2**: Click "Register as Agent B"

### Bước 3: Mở Side Panel

Click vào icon extension để mở Side Panel (bên phải màn hình)

### Bước 4: Bắt đầu hội thoại

1. Nhập **Topic** - chủ đề thảo luận
2. Chọn một template: Debate, Story, Q&A, hoặc Brainstorm
3. Click **Start Conversation**

Extension sẽ tự động điều phối cuộc hội thoại giữa 2 AI!

## Cấu trúc thư mục

```
ai-chat-bridge-extension/
├── manifest.json           # Chrome extension manifest
├── background.js           # Service worker - điều phối sessions
├── content.js             # Content script - message handling
├── agent-registration.js  # Agent registration (DO NOT MODIFY)
├── sidepanel.html         # Side Panel UI
├── sidepanel.js           # Side Panel logic
├── platforms/             # 🆕 Platform Adapters
│   ├── base-adapter.js    # Base class
│   ├── gemini-adapter.js  # Google Gemini
│   ├── chatgpt-adapter.js # ChatGPT
│   ├── deepseek-adapter.js # DeepSeek
│   ├── duckduckgo-adapter.js # DuckDuckGo AI
│   ├── index.js           # Platform registry
│   └── template-adapter.js.example # Template for new platforms
├── styles/
│   ├── overlay.css        # Overlay styles
│   └── sidepanel.css      # Side Panel styles
├── icons/
└── README.md
```

## 🆕 Thêm Platform Mới

Extension sử dụng **Platform Adapters** - mỗi platform có file riêng chứa selectors và logic.

### Các bước thêm platform mới:

1. **Copy template**:
   ```bash
   cp platforms/template-adapter.js.example platforms/claude-adapter.js
   ```

2. **Tìm selectors**: 
   - Mở trang chat của platform
   - Nhấn F12 để mở DevTools
   - Inspect input field, send button, response containers

3. **Cập nhật adapter**:
   ```javascript
   class ClaudeAdapter extends BasePlatformAdapter {
     constructor() {
       super();
       this.name = 'claude';
       this.hostPatterns = ['claude.ai'];
       this.selectors = {
         input: ['textarea[placeholder*="Message"]'],
         sendButton: ['button[aria-label*="Send"]'],
         responses: ['.assistant-message'],
         loading: ['.loading-indicator'],
       };
     }
   }
   window.ClaudeAdapter = ClaudeAdapter;
   ```

4. **Đăng ký adapter** trong `platforms/index.js`:
   ```javascript
   if (typeof ClaudeAdapter !== 'undefined') {
     PlatformRegistry.register(ClaudeAdapter);
   }
   ```

5. **Cập nhật manifest.json**:
   ```json
   "host_permissions": ["https://claude.ai/*"],
   "content_scripts": [{ 
     "matches": ["https://claude.ai/*"],
     "js": ["platforms/claude-adapter.js", ...]
   }]
   ```

6. **Test**: Reload extension và mở trang chat mới

## Troubleshooting

### Session không kết nối được
- Đảm bảo tab đang mở đúng trang chat
- Refresh trang và thử đăng ký lại
- Kiểm tra console log (F12)

### Tin nhắn không được gửi
- Platform selectors có thể đã cũ
- Cập nhật selectors trong file adapter tương ứng
- Sử dụng DevTools để tìm selectors mới

### "Extension context invalidated"
- Extension đã được cập nhật
- Refresh tất cả các tab chat

### AI không phản hồi
- Kiểm tra loading detection trong adapter
- Tăng timeout nếu cần

## Development

```bash
# 1. Clone
git clone <repo>

# 2. Load extension in Chrome
# chrome://extensions/ > Load unpacked

# 3. Make changes
# Edit files in platforms/ or content.js

# 4. Reload
# Click refresh on extension page
# Reload chat tabs
```

## License

MIT License
