// You.com Platform Adapter
// URL: https://you.com/?chatMode=default

class YouComAdapter extends BasePlatformAdapter {
  constructor() {
    super();
    this.name = 'youcom';
    this.hostPatterns = ['you.com', 'www.you.com'];
    
    // Selectors for You.com Chat
    this.selectors = {
      input: [
        '#search-input-textarea',
        'textarea[placeholder*="How can I help"]',
        'textarea[placeholder*="Ask"]',
        'textarea',
        'div[contenteditable="true"]',
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      responses: [
        '[data-testid*="answer-turn"]',
        '[data-testid*="youchat-answer"]',
        '[data-testid*="answer"]',
        '[data-testid="youchat-text"]',
        '[data-role="assistant"]',
        '[data-author="assistant"]',
        '.assistant-message',
        '.message-assistant',
        '[class*="assistant"]',
        '[class*="response"]',
        '[class*="you-message"]',
        '[class*="Message"]',
        '[class*="message"]',
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
    console.log('[YouComAdapter] getResponses called');
    
    // You.com uses data-testid for response containers
    // Primary selector: [data-testid*="answer-turn"] for answer containers
    const answerTurns = document.querySelectorAll('[data-testid*="answer-turn"]');
    if (answerTurns.length > 0) {
      console.log('[YouComAdapter] getResponses: Found', answerTurns.length, 'answer-turn elements');
      return Array.from(answerTurns);
    }
    
    // Fallback to youchat-text (contains the actual text)
    const youchatTexts = document.querySelectorAll('[data-testid="youchat-text"]');
    if (youchatTexts.length > 0) {
      console.log('[YouComAdapter] getResponses: Found', youchatTexts.length, 'youchat-text elements');
      // Return parent containers for youchat-text elements
      const containers = Array.from(youchatTexts).map(el => {
        // Try to find the answer container (parent with answer-turn data-testid)
        let container = el.parentElement;
        for (let i = 0; i < 5 && container; i++) {
          const testId = container.getAttribute('data-testid');
          if (testId && testId.includes('answer')) {
            return container;
          }
          container = container.parentElement;
        }
        return el.parentElement || el;
      });
      return containers;
    }
    
    // Fallback to standard selectors
    const responses = this.findAll(this.selectors.responses);
    console.log('[YouComAdapter] getResponses: Found', responses.length, 'responses with fallback selectors');
    
    return responses;
  }
  
  getLatestResponse() {
    const responses = this.getResponses();
    console.log('[YouComAdapter] getLatestResponse: Found', responses.length, 'responses');
    
    if (responses.length === 0) {
      console.log('[YouComAdapter] getLatestResponse: No responses found');
      return null;
    }
    
    const last = responses[responses.length - 1];
    const text = (last.innerText || last.textContent || '').trim();
    console.log('[YouComAdapter] getLatestResponse: Last response text length:', text.length, 'preview:', text.substring(0, 50));
    
    return text;
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
window.YouComAdapter = YouComAdapter;

