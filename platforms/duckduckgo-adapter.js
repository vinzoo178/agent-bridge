// DuckDuckGo AI Chat (Duck.ai) Platform Adapter
// URL: https://duckduckgo.com/?ia=chat or https://duck.ai

class DuckDuckGoAdapter extends BasePlatformAdapter {
  constructor() {
    super();
    this.name = 'duckduckgo';
    this.hostPatterns = ['duckduckgo.com', 'duck.ai'];
    
    // Selectors for DuckDuckGo AI Chat
    this.selectors = {
      input: [
        'textarea[placeholder*="Ask privately"]',
        'textarea[placeholder*="privately"]',
        'textarea',
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button:has-text("Send")',
      ],
      responses: [
        '[data-testid="message-assistant"]',
        '.message-assistant',
        '[class*="assistant"]',
        '[class*="response"]',
      ],
      loading: [
        'button[aria-label*="Stop generating"]:not([disabled])',
        '.streaming',
        '[class*="loading"]',
      ],
      stopButton: [
        'button[aria-label*="Stop generating"]',
      ],
      clearButton: [
        'button[aria-label*="Clear chat"]',
      ]
    };
  }
  
  getInputField() {
    // DuckDuckGo uses a simple textarea
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      const placeholder = ta.getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('ask') || 
          placeholder.toLowerCase().includes('privately') ||
          placeholder.toLowerCase().includes('message')) {
        return ta;
      }
    }
    return this.findFirst(this.selectors.input);
  }
  
  getSendButton() {
    // Find send button - it's a button with "Send" text or aria-label
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const text = btn.textContent || '';
      
      if (ariaLabel.toLowerCase().includes('send') || 
          text.toLowerCase().trim() === 'send') {
        if (!btn.disabled) return btn;
      }
    }
    return null;
  }
  
  getResponses() {
    // DuckDuckGo response elements
    // Look for assistant messages
    let responses = [];
    
    // Try data-testid first
    responses = Array.from(document.querySelectorAll('[data-testid*="assistant"]'));
    if (responses.length > 0) return responses;
    
    // Look for message containers with assistant role
    responses = Array.from(document.querySelectorAll('[class*="assistant"]'));
    if (responses.length > 0) return responses;
    
    // Fallback: find alternating user/assistant pattern
    const allMessages = document.querySelectorAll('[class*="message"]');
    const assistantMsgs = [];
    allMessages.forEach((msg, i) => {
      // Typically, even indices are user, odd are assistant
      if (i % 2 === 1) assistantMsgs.push(msg);
    });
    
    return assistantMsgs;
  }
  
  isGenerating() {
    // Check stop button
    const stopBtn = document.querySelector('button[aria-label*="Stop generating"]');
    if (stopBtn && !stopBtn.disabled) {
      return true;
    }
    
    // Check for streaming class
    if (document.querySelector('.streaming') || document.querySelector('[class*="streaming"]')) {
      return true;
    }
    
    return false;
  }
  
  async setInputText(text) {
    const input = this.getInputField();
    if (!input) return false;
    
    input.focus();
    await this.sleep(100);
    
    // Standard textarea handling
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    return true;
  }
}

// Register adapter
window.DuckDuckGoAdapter = DuckDuckGoAdapter;

