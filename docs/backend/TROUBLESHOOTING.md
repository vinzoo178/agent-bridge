# Troubleshooting Backend Connection

## Lỗi: "503 No extension available"

Lỗi này có nghĩa là backend server đang chạy nhưng không có extension nào kết nối đến.

### Các bước kiểm tra:

#### 1. Kiểm tra Backend Server
```bash
# Backend server có đang chạy không?
curl http://localhost:3000/api/v1/health

# Kiểm tra extensions đã kết nối
curl http://localhost:3000/api/v1/extensions
```

#### 2. Kiểm tra Extension
1. Mở Chrome → `chrome://extensions/`
2. Tìm "AI Chat Bridge" extension
3. Đảm bảo extension đã được **Enabled**
4. Click **Reload** nếu cần

#### 3. Kiểm tra Backend Connection Status
1. Mở **Side Panel** (click icon extension)
2. Xem badge **"Backend"** ở header:
   - 🟢 **Xanh** = Connected ✅
   - 🟡 **Vàng** = Connecting...
   - 🔴 **Đỏ/Xám** = Not Connected ❌

3. Nếu **Not Connected**:
   - Click vào badge "Backend" để reconnect
   - Hoặc reload extension

#### 4. Kiểm tra Backend Client Page
1. Mở Chrome DevTools (F12)
2. Vào tab **Application** → **Service Workers**
3. Tìm "AI Chat Bridge" service worker
4. Kiểm tra console logs có lỗi không

#### 5. Kiểm tra Backend Server Logs
```bash
# Xem logs của backend server
# Bạn sẽ thấy:
# [WS] Extension connected: <extension-id>
```

Nếu không thấy log này, extension chưa kết nối.

### Cách fix:

#### Option 1: Reload Extension
1. `chrome://extensions/`
2. Click **Reload** trên AI Chat Bridge
3. Đợi vài giây
4. Kiểm tra lại badge "Backend" trong Side Panel

#### Option 2: Restart Backend Server
```bash
# Stop backend (Ctrl+C)
# Start lại
cd backend
npm start
```

#### Option 3: Manual Connect
1. Mở Side Panel
2. Click vào badge "Backend" (nếu disconnected)
3. Đợi vài giây để reconnect

#### Option 4: Check Backend URL
Đảm bảo backend client đang kết nối đúng URL:
- Default: `ws://localhost:3000/ws/extension`
- Nếu backend chạy trên port khác, cần update `backend-client.js`

### Debug Commands

#### Kiểm tra extension connections:
```bash
curl http://localhost:3000/api/v1/extensions
```

Response sẽ cho biết:
- `total`: Tổng số connections
- `connected`: Số connections đang active
- `extensions[]`: Danh sách extensions với status

#### Test connection:
```bash
# Test health
curl http://localhost:3000/api/v1/health

# Test chat (sẽ fail nếu không có extension)
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}'
```

### Common Issues

#### Issue 1: Backend server không chạy
**Symptom**: Badge "Backend" luôn hiển thị "No Backend"

**Fix**: 
```bash
cd backend
npm start
```

#### Issue 2: Extension chưa load backend client
**Symptom**: Extension loaded nhưng backend client không kết nối

**Fix**:
1. Reload extension
2. Check console logs trong Service Worker
3. Đảm bảo `backend-page.html` được tạo

#### Issue 3: Port conflict
**Symptom**: Backend server không start được

**Fix**:
```bash
# Check port 3000 đang được dùng bởi process nào
lsof -i :3000

# Hoặc dùng port khác
PORT=8080 npm start
```

#### Issue 4: CORS issues
**Symptom**: API calls bị block

**Fix**: Backend đã có CORS enabled, nhưng nếu vẫn lỗi, check:
- Backend server đang chạy
- URL đúng (http://localhost:3000)

### Still Not Working?

1. **Check all logs**:
   - Backend server console
   - Chrome Service Worker console (chrome://extensions → Service Worker)
   - Side Panel console (F12 trong Side Panel)

2. **Restart everything**:
   - Stop backend server
   - Reload extension
   - Start backend server
   - Wait 5 seconds
   - Check badge status

3. **Verify setup**:
   - Extension version: 1.2.0+
   - Backend server: latest code
   - Node.js version: 16+

