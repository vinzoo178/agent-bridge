// Z.ai Platform Adapter
// URL: https://chat.z.ai/

class ZAIAdapter extends BasePlatformAdapter {
  constructor() {
    super();
    this.name = 'zai';
    this.hostPatterns = ['chat.z.ai', 'z.ai'];
    
    // Selectors for Z.ai Chat
    // Note: These may need to be updated based on actual DOM structure
    this.selectors = {
      input: [
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="message"]',
        'div[contenteditable="true"]',
        'textarea',
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      responses: [
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
    const btn = this.findFirst(this.selectors.sendButton);
    return (btn && !btn.disabled) ? btn : null;
  }
  
  getResponses() {
    return this.findAll(this.selectors.responses);
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
    
    return true;
  }
}

// Register adapter
window.ZAIAdapter = ZAIAdapter;

