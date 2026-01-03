// DeepSeek Platform Adapter
// URL: https://chat.deepseek.com/*
// Note: Selectors may need updating - use browser DevTools to inspect

class DeepSeekAdapter extends BasePlatformAdapter {
  constructor() {
    super();
    this.name = 'deepseek';
    this.hostPatterns = ['chat.deepseek.com', 'deepseek.com'];
    
    // Selectors - update these if DeepSeek UI changes
    // Use DevTools on DeepSeek page to find correct selectors
    this.selectors = {
      input: [
        'textarea#chat-input',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="Type"]',
        'textarea[placeholder*="Ask"]',
        '.chat-input textarea',
        'div[contenteditable="true"]',
        '#message-input',
        'textarea',
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button.send-button',
        'button[type="submit"]',
        '.send-btn',
        'button svg[class*="send"]',
        'button:has(svg[class*="send"])',
        'form button',
      ],
      responses: [
        '.assistant-message',
        '[data-role="assistant"]',
        '.message-assistant',
        '.chat-message-assistant',
        '.bot-message',
        '.response-content',
        '[class*="assistant"]',
      ],
      loading: [
        '.loading',
        '.generating',
        '.typing-indicator',
        '[class*="loading"]',
        'button[aria-label*="Stop"]',
      ],
      stopButton: [
        'button[aria-label*="Stop"]',
        '.stop-button',
        'button.stop',
      ]
    };
  }
  
  getInputField() {
    return this.findFirst(this.selectors.input);
  }
  
  getSendButton() {
    for (const selector of this.selectors.sendButton) {
      try {
        const btn = document.querySelector(selector);
        if (btn && !btn.disabled) return btn;
      } catch (e) {
        // Some selectors like :has() may not work in all browsers
      }
    }
    return null;
  }
  
  getResponses() {
    return this.findAll(this.selectors.responses);
  }
  
  isGenerating() {
    // Check stop button
    const stopBtn = this.findFirst(this.selectors.stopButton);
    if (stopBtn && stopBtn.offsetParent !== null) {
      return true;
    }
    
    // Check loading indicators
    for (const selector of this.selectors.loading) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) {
          return true;
        }
      } catch (e) {}
    }
    
    return false;
  }
  
  async setInputText(text) {
    const input = this.getInputField();
    if (!input) return false;
    
    input.focus();
    await this.sleep(100);
    
    if (input.tagName === 'TEXTAREA') {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (input.contentEditable === 'true') {
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    return true;
  }
}

// Register adapter
window.DeepSeekAdapter = DeepSeekAdapter;

