// Base Platform Adapter - Interface for all platforms
// To add a new platform:
// 1. Create new file in platforms/ folder
// 2. Extend BasePlatformAdapter
// 3. Register in platforms/index.js

class BasePlatformAdapter {
  constructor() {
    this.name = 'unknown';
    this.hostPatterns = [];
  }
  
  // Check if this adapter matches the current URL
  matches(hostname) {
    return this.hostPatterns.some(pattern => hostname.includes(pattern));
  }
  
  // Get input field element
  getInputField() {
    throw new Error('Not implemented');
  }
  
  // Get send button element
  getSendButton() {
    throw new Error('Not implemented');
  }
  
  // Get all AI response elements
  getResponses() {
    throw new Error('Not implemented');
  }
  
  // Get latest response text
  getLatestResponse() {
    const responses = this.getResponses();
    if (responses.length === 0) return null;
    
    const last = responses[responses.length - 1];
    return (last.innerText || last.textContent || '').trim();
  }
  
  // Check if AI is still generating
  isGenerating() {
    return false;
  }
  
  // Set text in input field
  async setInputText(text) {
    const input = this.getInputField();
    if (!input) return false;
    
    input.focus();
    await this.sleep(100);
    
    // Clear
    input.innerHTML = '';
    input.textContent = '';
    
    // Set text - override in subclass if needed
    if (input.tagName === 'TEXTAREA') {
      input.value = text;
    } else {
      input.textContent = text;
    }
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  
  // Click send button or press Enter
  async clickSend() {
    const sendBtn = this.getSendButton();
    if (sendBtn) {
      sendBtn.click();
      return true;
    }
    
    const input = this.getInputField();
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      }));
      return true;
    }
    
    return false;
  }
  
  // Utility: find first matching element from selectors
  findFirst(selectors) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of selectorList) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }
  
  // Utility: find all matching elements from selectors
  findAll(selectors) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of selectorList) {
      const els = document.querySelectorAll(selector);
      if (els.length > 0) return Array.from(els);
    }
    return [];
  }
  
  // Utility: sleep
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in other files
window.BasePlatformAdapter = BasePlatformAdapter;

