// ChatGPT Platform Adapter
// URL: https://chatgpt.com/* or https://chat.openai.com/*

class ChatGPTAdapter extends BasePlatformAdapter {
  constructor() {
    super();
    this.name = 'chatgpt';
    this.hostPatterns = ['chatgpt.com', 'chat.openai.com'];
    
    // Selectors - update these if ChatGPT UI changes
    this.selectors = {
      input: [
        '#prompt-textarea',
        'textarea[data-id="root"]',
        'div[contenteditable="true"][id="prompt-textarea"]',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="Send a message"]',
        'form textarea',
      ],
      sendButton: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'form button[type="submit"]',
        'button svg[class*="send"]',
      ],
      responses: [
        '[data-message-author-role="assistant"]',
        'div[data-message-author-role="assistant"] .markdown',
        '.agent-turn .markdown',
        '[class*="assistant-message"]',
        '.message.assistant .content',
      ],
      loading: [
        'button[aria-label*="Stop"]',
        '.result-streaming',
        '[class*="streaming"]',
        '.animate-pulse',
      ],
      stopButton: [
        'button[aria-label*="Stop generating"]',
        'button[aria-label*="Stop"]',
      ]
    };
  }
  
  getInputField() {
    return this.findFirst(this.selectors.input);
  }
  
  getSendButton() {
    // First try direct selector
    for (const selector of this.selectors.sendButton) {
      const btn = document.querySelector(selector);
      if (btn && !btn.disabled) return btn;
    }
    
    // Try finding parent button of send icon
    const svgParent = document.querySelector('button svg[class*="send"]');
    if (svgParent) {
      const btn = svgParent.closest('button');
      if (btn && !btn.disabled) return btn;
    }
    
    return null;
  }
  
  getResponses() {
    let responses = this.findAll(this.selectors.responses);
    
    // Filter to get the actual content containers
    if (responses.length > 0) {
      // Try to get the markdown content inside
      const markdownResponses = [];
      responses.forEach(r => {
        const markdown = r.querySelector('.markdown');
        if (markdown) {
          markdownResponses.push(markdown);
        } else {
          markdownResponses.push(r);
        }
      });
      return markdownResponses;
    }
    
    return responses;
  }
  
  // Override availability check - ChatGPT doesn't require login but check if input is available
  checkAvailability() {
    const baseCheck = super.checkAvailability();
    
    // ChatGPT can work without login, so if base check passes, we're good
    // But check if there's a blocking modal or error
    if (baseCheck.available) {
      // Check for blocking modals or errors
      const blockingElements = document.querySelectorAll('[role="dialog"], .modal, [class*="error"]');
      for (const el of blockingElements) {
        if (el.offsetParent !== null && el.textContent.includes('error')) {
          return {
            available: false,
            reason: 'Page error detected',
            requiresLogin: false
          };
        }
      }
    }
    
    return baseCheck;
  }
  
  isGenerating() {
    // Check stop button
    const stopBtn = this.findFirst(this.selectors.stopButton);
    if (stopBtn && stopBtn.offsetParent !== null) {
      return true;
    }
    
    // Check streaming class
    if (document.querySelector('.result-streaming')) {
      return true;
    }
    
    // Check for loading indicators
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
    
    if (input.tagName === 'TEXTAREA') {
      // For textarea input
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (input.contentEditable === 'true') {
      // For contenteditable div
      input.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      input.appendChild(p);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    return true;
  }
}

// Register adapter
window.ChatGPTAdapter = ChatGPTAdapter;

