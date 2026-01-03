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
        '.ds-markdown-paragraph',  // DeepSeek markdown paragraph elements
        '[class*="ds-markdown"]',  // Any element with ds-markdown in class
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
    // First try to find markdown paragraph elements (most specific for DeepSeek)
    const markdownParas = document.querySelectorAll('.ds-markdown-paragraph');
    if (markdownParas.length > 0) {
      // Find unique parent containers for each message
      // Messages are typically grouped in containers, we need to find those containers
      const containers = new Map();
      
      markdownParas.forEach(para => {
        // Try to find a container that groups paragraphs together
        // Look for common parent elements that might contain multiple paragraphs
        let container = para.closest('[class*="message"]') ||
                       para.closest('[class*="chat-item"]') ||
                       para.closest('[class*="response"]') ||
                       para.closest('[class*="assistant"]') ||
                       para.parentElement?.parentElement ||
                       para.parentElement;
        
        // Use a key based on container's position/index to group paragraphs from same message
        const key = container === document.body ? para.parentElement : container;
        if (!containers.has(key)) {
          containers.set(key, container);
        }
      });
      
      if (containers.size > 0) {
        return Array.from(containers.values());
      }
      
      // If we can't find containers, try to group paragraphs by their direct parent
      const parentGroups = new Set();
      markdownParas.forEach(para => {
        parentGroups.add(para.parentElement);
      });
      return Array.from(parentGroups);
    }
    
    // Fallback: try to find containers with ds-markdown class
    const markdownContainers = document.querySelectorAll('[class*="ds-markdown"]:not(.ds-markdown-paragraph)');
    if (markdownContainers.length > 0) {
      return Array.from(markdownContainers);
    }
    
    // Fallback to standard selectors
    return this.findAll(this.selectors.responses);
  }
  
  getLatestResponse() {
    // Override to handle ds-markdown-paragraph elements properly
    const responses = this.getResponses();
    if (responses.length === 0) return null;
    
    const last = responses[responses.length - 1];
    
    // If it's a container, look for markdown paragraphs inside
    const markdownParas = last.querySelectorAll?.('.ds-markdown-paragraph') || [];
    if (markdownParas.length > 0) {
      const textParts = Array.from(markdownParas).map(p => 
        (p.innerText || p.textContent || '').trim()
      ).filter(t => t.length > 0);
      if (textParts.length > 0) {
        return textParts.join('\n\n').trim();
      }
    }
    
    // If the element itself is a paragraph, get its text
    if (last.classList?.contains('ds-markdown-paragraph')) {
      return (last.innerText || last.textContent || '').trim();
    }
    
    // Standard extraction
    return (last.innerText || last.textContent || '').trim();
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

