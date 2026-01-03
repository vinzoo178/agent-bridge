// Qwen Platform Adapter
// URL: https://chat.qwen.ai/

class QwenAdapter extends BasePlatformAdapter {
  constructor() {
    super();
    this.name = 'qwen';
    this.hostPatterns = ['chat.qwen.ai', 'qwen.ai'];
    
    // Selectors for Qwen Chat
    this.selectors = {
      input: [
        '#chat-input',
        'textarea.chat-input',
        'textarea[placeholder*="How can I help you today"]',
        'textarea[placeholder*="How can I help"]',
        'textarea',
        'div[contenteditable="true"]',
      ],
      sendButton: [
        '.send-button',
        'button.send-button',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      responses: [
        '.qwen-chat-message-assistant',
        '[id^="qwen-chat-message-assistant-"]',
        '.chat-response-message',
        '[id^="chat-response-message-"]',
        '.response-message-content',
        '[data-role="assistant"]',
        '[data-author="assistant"]',
        '.assistant-message',
        '.message-assistant',
        '[class*="assistant"]',
        '[class*="response"]',
      ],
      loading: [
        'button[aria-label*="Stop"]',
        '.loading',
        '.streaming',
        '[class*="loading"]',
        '[class*="streaming"]',
      ],
      stopButton: [
        'button[aria-label*="Stop"]',
        'button[aria-label*="Stop generating"]',
      ]
    };
  }
  
  getInputField() {
    return this.findFirst(this.selectors.input);
  }
  
  getSendButton() {
    // Try selectors in order
    for (const selector of this.selectors.sendButton) {
      const btn = document.querySelector(selector);
      if (btn && !btn.disabled && btn.offsetParent !== null) {
        return btn;
      }
    }
    return null;
  }
  
  getResponses() {
    // Qwen uses specific classes for assistant messages
    // Primary: .qwen-chat-message-assistant or .chat-response-message
    const assistantMessages = document.querySelectorAll('.qwen-chat-message-assistant, .chat-response-message');
    if (assistantMessages.length > 0) {
      return Array.from(assistantMessages);
    }
    
    // Fallback to standard selectors
    return this.findAll(this.selectors.responses);
  }
  
  getLatestResponse() {
    const responses = this.getResponses();
    if (responses.length === 0) return null;
    
    const last = responses[responses.length - 1];
    // For Qwen, the text is usually in .response-message-content or directly in the container
    const contentEl = last.querySelector('.response-message-content') || last;
    return (contentEl.innerText || contentEl.textContent || '').trim();
  }
  
  isGenerating() {
    // Check stop button
    const stopBtn = this.findFirst(this.selectors.stopButton);
    if (stopBtn && stopBtn.offsetParent !== null && !stopBtn.disabled) {
      return true;
    }
    
    // Check loading indicators
    for (const selector of this.selectors.loading) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) {
        return true;
      }
    }
    
    return false;
  }
  
  async setInputText(text) {
    const input = this.getInputField();
    if (!input) return false;
    
    input.focus();
    await this.sleep(100);
    
    // Handle different input types
    if (input.tagName === 'TEXTAREA') {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input.contentEditable === 'true') {
      // For contenteditable divs
      input.innerHTML = '';
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // Wait a bit for send button to become enabled (if it was disabled)
    await this.sleep(200);
    
    return true;
  }
  
  async clickSend() {
    // Qwen has a send button, try to find and click it
    const sendBtn = this.getSendButton();
    if (sendBtn) {
      sendBtn.click();
      await this.sleep(100);
      return true;
    }
    
    // Fallback: try Enter key
    const input = this.getInputField();
    if (input) {
      input.focus();
      await this.sleep(100);
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      return true;
    }
    
    return false;
  }
}

// Register adapter
window.QwenAdapter = QwenAdapter;

