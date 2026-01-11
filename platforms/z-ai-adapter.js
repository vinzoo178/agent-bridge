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
  
  // Check if z.ai is in deepthink mode
  isDeepthinkMode() {
    // Primary detection: Check for the Deep Think button with data-autothink="true"
    // This is the most reliable indicator
    const deepthinkButton = document.querySelector('button[data-autothink="true"]');
    if (deepthinkButton && deepthinkButton.offsetParent !== null) {
      // Check if button is enabled (has the enabled styling)
      const hasEnabledStyle = deepthinkButton.classList.contains('data-[autoThink=true]:bg-[#DAEEFF]') ||
                             deepthinkButton.getAttribute('data-autothink') === 'true' ||
                             deepthinkButton.matches('[data-autothink="true"]');
      
      if (hasEnabledStyle) {
        return true;
      }
    }
    
    // Alternative: Check aria-label for "Deep think enabled"
    const enabledButton = document.querySelector('button[aria-label*="Deep think enabled" i]');
    if (enabledButton && enabledButton.offsetParent !== null) {
      return true;
    }
    
    // Fallback: Look for deepthink indicators in the UI
    const deepthinkIndicators = [
      '[class*="deepthink"]',
      '[class*="deep-think"]',
      '[class*="thinking"]',
      '[data-mode*="think"]',
      '[data-mode*="deep"]'
    ];
    
    // Check for deepthink in class names
    for (const selector of deepthinkIndicators) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) {
          return true;
        }
      } catch (e) {
        // Some selectors may not work
      }
    }
    
    // Check for text content indicating deepthink is enabled
    const pageText = document.body?.textContent || '';
    if (pageText.includes('Deep think enabled') || 
        (pageText.includes('Deep Think') && pageText.includes('enabled'))) {
      return true;
    }
    
    // Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'deepthink' || urlParams.get('thinking') === 'true') {
      return true;
    }
    
    return false;
  }
  
  // Override availability check to warn about deepthink
  checkAvailability() {
    const baseCheck = super.checkAvailability();
    
    if (!baseCheck.available) {
      return baseCheck;
    }
    
    // Check if in deepthink mode
    if (this.isDeepthinkMode()) {
      return {
        available: true,
        reason: 'DeepThink mode active - responses may take longer',
        requiresLogin: false,
        deepthink: true
      };
    }
    
    return baseCheck;
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

