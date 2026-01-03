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
        '.response-message-content',
        '.qwen-chat-message-assistant',
        '[id^="qwen-chat-message-assistant-"]',
        '.chat-response-message',
        '[id^="chat-response-message-"]',
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
    console.log('[QwenAdapter] getResponses called, URL:', window.location.href);
    
    // Qwen uses .response-message-content for the actual message content
    // This is the primary selector for response messages
    const responseContents = document.querySelectorAll('.response-message-content');
    console.log('[QwenAdapter] getResponses: querySelectorAll(.response-message-content) returned', responseContents.length, 'elements');
    if (responseContents.length > 0) {
      console.log('[QwenAdapter] getResponses: Found', responseContents.length, 'response-message-content elements');
      Array.from(responseContents).forEach((el, idx) => {
        const text = (el.textContent || el.innerText || '').trim();
        console.log('[QwenAdapter] getResponses: Element', idx, 'text length:', text.length, 'preview:', text.substring(0, 50));
      });
      return Array.from(responseContents);
    }
    
    // Fallback: try container elements
    console.log('[QwenAdapter] getResponses: No .response-message-content found, trying container elements');
    const assistantMessages = document.querySelectorAll('.qwen-chat-message-assistant, .chat-response-message');
    console.log('[QwenAdapter] getResponses: querySelectorAll(.qwen-chat-message-assistant, .chat-response-message) returned', assistantMessages.length, 'elements');
    if (assistantMessages.length > 0) {
      console.log('[QwenAdapter] getResponses: Found', assistantMessages.length, 'container elements');
      return Array.from(assistantMessages);
    }
    
    // Final fallback to standard selectors
    console.log('[QwenAdapter] getResponses: Trying fallback selectors');
    const fallbackResponses = this.findAll(this.selectors.responses);
    console.log('[QwenAdapter] getResponses: Found', fallbackResponses.length, 'responses with fallback selectors');
    return fallbackResponses;
  }
  
  getLatestResponse() {
    const responses = this.getResponses();
    console.log('[QwenAdapter] getLatestResponse: Found', responses.length, 'responses');
    
    if (responses.length === 0) {
      console.log('[QwenAdapter] getLatestResponse: No responses found');
      return null;
    }
    
    const last = responses[responses.length - 1];
    // If it's already a .response-message-content element, use it directly
    // Otherwise, try to find .response-message-content inside
    const contentEl = last.classList.contains('response-message-content') 
      ? last 
      : (last.querySelector('.response-message-content') || last);
    
    const text = (contentEl.innerText || contentEl.textContent || '').trim();
    console.log('[QwenAdapter] getLatestResponse: Text length:', text.length, 'preview:', text.substring(0, 50));
    
    return text;
  }
  
  isGenerating() {
    // Check stop button
    const stopBtn = this.findFirst(this.selectors.stopButton);
    if (stopBtn && stopBtn.offsetParent !== null && !stopBtn.disabled) {
      console.log('[QwenAdapter] isGenerating: TRUE (stop button found)');
      return true;
    }
    
    // Check loading indicators - be more specific to avoid false positives
    // Only check for actual loading/streaming indicators, not generic classes
    const specificLoadingSelectors = [
      'button[aria-label*="Stop"]',
      'button[aria-label*="Stop generating"]',
      '.streaming',
      '[class*="streaming"]'
    ];
    
    for (const selector of specificLoadingSelectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) {
        console.log('[QwenAdapter] isGenerating: TRUE (loading indicator found:', selector, ')');
        return true;
      }
    }
    
    console.log('[QwenAdapter] isGenerating: FALSE');
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

