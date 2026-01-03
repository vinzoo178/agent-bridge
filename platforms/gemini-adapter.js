// Gemini Platform Adapter
// URL: https://gemini.google.com/*

class GeminiAdapter extends BasePlatformAdapter {
  
  // Log to centralized logger
  _log(...args) {
    const message = args.join(' ');
    console.log('[GeminiAdapter]', ...args);
    if (window.logAIBridge) {
      window.logAIBridge('GeminiAdapter', 'INFO', message);
    }
  }
  constructor() {
    super();
    this.name = 'gemini';
    this.hostPatterns = ['gemini.google.com'];
    
    // Selectors - update these if Gemini UI changes
    this.selectors = {
      input: [
        'rich-textarea .ql-editor',
        'rich-textarea div[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        '.text-input-field_textarea-wrapper .ql-editor',
        'div[contenteditable="true"][aria-label*="prompt"]',
        // New Gemini selectors
        '.ql-editor.textarea',
        'p[data-placeholder]',
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button[aria-label*="Gửi"]', // Vietnamese
        'button.send-button',
        '.send-button-container button',
        'button[data-test-id="send-button"]',
        // Icon button
        'button mat-icon[data-mat-icon-name="send"]',
      ],
      responses: [
        // Try multiple selectors for Gemini responses
        'model-response .response-content',
        'model-response message-content',
        'message-content.model-response-text',
        '.model-response-text',
        '[data-message-author-role="model"]',
        'model-response',
        // Alternative: look for response container
        '.response-container-content',
        '.conversation-container model-response',
      ],
      loading: [
        '.loading-indicator',
        '[data-loading="true"]',
        'mat-progress-bar',
        '.thinking-indicator',
        'model-response[is-loading="true"]',
        '.streaming-indicator',
        // Cursor blinking while typing
        '.response-streaming',
        'model-response .loading',
      ],
      stopButton: [
        'button[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        'button[aria-label*="Dừng"]', // Vietnamese
      ]
    };
  }
  
  getInputField() {
    const input = this.findFirst(this.selectors.input);
    this._log('getInputField:', input ? 'FOUND' : 'NOT FOUND');
    return input;
  }
  
  getSendButton() {
    // Try standard selectors first
    for (const selector of this.selectors.sendButton) {
      const btn = document.querySelector(selector);
      if (btn && !btn.disabled) {
        this._log('getSendButton: FOUND with', selector);
        return btn;
      }
    }
    
    // Fallback: find button containing send icon
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      if ((ariaLabel.toLowerCase().includes('send') || ariaLabel.includes('Gửi')) && !btn.disabled) {
        this._log('getSendButton: FOUND via aria-label');
        return btn;
      }
    }
    
    this._log('getSendButton: NOT FOUND');
    return null;
  }
  
  getResponses() {
    this._log('getResponses called');
    
    // Try each selector
    for (const selector of this.selectors.responses) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        this._log('Found', elements.length, 'responses with selector:', selector);
        return Array.from(elements);
      }
    }
    
    // Fallback: find message-content inside model-response
    const modelResponses = document.querySelectorAll('model-response');
    this._log('Found', modelResponses.length, 'model-response elements');
    
    if (modelResponses.length > 0) {
      const responses = [];
      modelResponses.forEach(mr => {
        // Try to find the content inside
        const content = mr.querySelector('message-content') || 
                       mr.querySelector('.response-content') ||
                       mr.querySelector('.markdown-content') ||
                       mr;
        responses.push(content);
      });
      this._log('Extracted', responses.length, 'content elements');
      return responses;
    }
    
    this._log('NO responses found!');
    return [];
  }
  
  getLatestResponse() {
    const responses = this.getResponses();
    if (responses.length === 0) {
      this._log('getLatestResponse: No responses');
      return null;
    }
    
    const last = responses[responses.length - 1];
    const text = (last.innerText || last.textContent || '').trim();
    this._log('getLatestResponse: Got', text.length, 'chars');
    this._log('Preview:', text.substring(0, 80) + '...');
    return text;
  }
  
  isGenerating() {
    // Check loading indicators
    for (const selector of this.selectors.loading) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) {
        this._log('isGenerating: TRUE (found:', selector, ')');
        return true;
      }
    }
    
    // Check stop button visibility
    for (const selector of this.selectors.stopButton) {
      const stopBtn = document.querySelector(selector);
      if (stopBtn && stopBtn.offsetParent !== null && !stopBtn.disabled) {
        this._log('isGenerating: TRUE (stop button visible)');
        return true;
      }
    }
    
    // Check if model-response is still being streamed
    const activeResponse = document.querySelector('model-response:last-child');
    if (activeResponse) {
      const isLoading = activeResponse.getAttribute('is-loading');
      if (isLoading === 'true' || isLoading === '') {
        this._log('isGenerating: TRUE (is-loading attribute)');
        return true;
      }
    }
    
    this._log('isGenerating: FALSE');
    return false;
  }
  
  async setInputText(text) {
    const input = this.getInputField();
    if (!input) {
      this._log('setInputText: Input not found!');
      return false;
    }
    
    input.focus();
    await this.sleep(100);
    
    // Gemini uses contenteditable with paragraphs
    input.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    input.appendChild(p);
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    this._log('setInputText: SUCCESS');
    return true;
  }
}

// Register adapter
window.GeminiAdapter = GeminiAdapter;
