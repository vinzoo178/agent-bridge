# Phân tích hệ thống logging và đề xuất cải thiện

## 1. Kiểm tra các hàm ghi log hiện tại

### Background Script (`background.js`)
- ✅ `addLog(source, level, message)` - Tạo log entry và lưu vào memory
- ✅ `bgLog(...args)` - Wrapper cho INFO logs
- ✅ `bgError(...args)` - Wrapper cho ERROR logs
- ✅ `saveLogsToStorage()` - Debounced save (500ms) vào chrome.storage.local
- ✅ `ADD_LOG` handler - Nhận logs từ content scripts và agent-registration

**Vấn đề tiềm ẩn:**
- `saveLogsToStorage()` là async nhưng không được await trong `addLog()` - OK vì debounced
- Có thể mất logs nếu service worker terminate trước khi save (500ms delay)
- Local storage có thể đầy (5MB quota)

### Content Scripts
- ✅ `content.js` - Gửi ADD_LOG message
- ✅ `agent-registration.js` - Gửi ADD_LOG message

**Vấn đề tiềm ẩn:**
- Nếu background script chưa sẵn sàng, logs sẽ bị mất (silently ignored)

## 2. So sánh Session Storage vs Local Storage

### Local Storage (hiện tại)
**Ưu điểm:**
- ✅ Persist qua extension reload
- ✅ Persist qua browser restart
- ✅ Có thể download logs sau khi reload

**Nhược điểm:**
- ❌ Có quota limit (5MB)
- ❌ Có thể đầy và gây lỗi
- ❌ Tốn storage cho data khác (conversationHistory, config, etc.)
- ❌ Debounced save có thể mất logs nếu service worker terminate sớm

### Session Storage
**Ưu điểm:**
- ✅ Không có quota limit (chỉ giới hạn bởi memory)
- ✅ Tự động xóa khi extension reload (không tích lũy)
- ✅ Nhanh hơn (không cần serialize/deserialize)
- ✅ Không ảnh hưởng đến storage quota của extension

**Nhược điểm:**
- ❌ Mất logs khi extension reload
- ❌ Không persist qua browser restart
- ❌ Không thể download logs sau khi reload

### Hybrid Approach (Đề xuất)
**Kết hợp cả hai:**
- **Session Storage**: Lưu logs hiện tại (nhanh, không lo đầy)
- **Local Storage**: Chỉ lưu logs quan trọng (ERROR, WARN) hoặc logs cuối cùng (last 100)
- **Memory**: Luôn giữ logs trong memory cho GET_LOGS request

**Ưu điểm:**
- ✅ Có logs ngay lập tức (memory + session)
- ✅ Không lo storage đầy (session storage không có quota)
- ✅ Vẫn có logs quan trọng sau reload (local storage)
- ✅ Download được logs hiện tại

## 3. Đề xuất cải thiện

### Option 1: Chuyển sang Session Storage (Đơn giản)
- Dùng `chrome.storage.session` thay vì `chrome.storage.local`
- Tự động xóa khi extension reload
- Không lo storage đầy

### Option 2: Hybrid Approach (Tốt nhất)
- Memory: Luôn giữ logs (nhanh nhất)
- Session Storage: Backup logs (tự động xóa khi reload)
- Local Storage: Chỉ lưu ERROR/WARN logs hoặc last 100 logs

### Option 3: Chỉ dùng Memory (Nhẹ nhất)
- Chỉ lưu trong memory
- Mất logs khi service worker terminate
- Nhưng không lo storage đầy

## 4. Khuyến nghị

**✅ ĐÃ TRIỂN KHAI: Hybrid Approach**
1. Memory: Primary storage (nhanh, luôn có) - MAX_LOGS = 1000
2. Session Storage: Primary backup (tự động xóa, không lo đầy) - lưu tất cả logs
3. Local Storage: Chỉ lưu ERROR/WARN + last 50 logs (quan trọng) - MAX_LOCAL_LOGS = 50

**Lý do:**
- Debug logs thường chỉ cần trong session hiện tại
- Không cần persist tất cả logs qua reload
- Quan trọng là có logs ngay khi cần debug
- Tránh làm đầy storage

**Implementation Details:**
- ✅ Memory-first: Logs luôn có sẵn trong memory ngay lập tức
- ✅ Session storage: Lưu tất cả logs (1000 logs) - primary backup
- ✅ Local storage: Chỉ lưu ERROR/WARN + last 50 logs - persist qua reload
- ✅ Debounced save: 300ms để tránh quá nhiều writes
- ✅ Auto-trim: Giữ tối đa 1000 logs trong memory/session, 50 logs trong local
- ✅ Error handling: Nếu local storage đầy, chỉ giữ ERROR logs

