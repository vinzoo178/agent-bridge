// DuckDuckGo AI Chat (Duck.ai) Platform Adapter
// URL: https://duckduckgo.com/?ia=chat or https://duckduckgo.com/?duckai=1 or https://duck.ai

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
    
    // First, try ID-based selectors (most specific for DuckDuckGo)
    // DuckDuckGo uses IDs like: #uuid-assistant-message-0-1
    // But we need to find the actual content container, not heading elements
    const allElementsWithId = Array.from(document.querySelectorAll('[id*="assistant-message"]'));
    
    if (allElementsWithId.length > 0) {
      // Filter out heading elements and find elements with actual content
      const contentContainers = [];
      
      allElementsWithId.forEach(el => {
        const text = (el.innerText || el.textContent || '').trim();
        const hasParagraphs = el.querySelectorAll('p').length > 0;
        
        // Skip heading elements - they only contain "GPT-4o mini" or similar
        if (el.id.includes('heading-')) {
          // Look for a sibling or parent that contains the actual message
          // Try next sibling first
          let sibling = el.nextElementSibling;
          if (sibling) {
            const siblingText = (sibling.innerText || sibling.textContent || '').trim();
            if (siblingText.length > 50) {
              contentContainers.push(sibling);
              return;
            }
          }
          
          // Try parent container
          let parent = el.parentElement;
          if (parent && parent !== document.body) {
            const parentText = (parent.innerText || parent.textContent || '').trim();
            // Check if parent has more content than just the heading
            if (parentText.length > text.length + 20) {
              contentContainers.push(parent);
              return;
            }
          }
        } else {
          // Not a heading - check if it has substantial content
          if (text.length > 50 || hasParagraphs) {
            contentContainers.push(el);
          }
        }
      });
      
      // Remove duplicates
      const uniqueContainers = Array.from(new Set(contentContainers));
      if (uniqueContainers.length > 0) {
        return uniqueContainers;
      }
      
      // Fallback: use non-heading elements
      const nonHeadingElements = allElementsWithId.filter(el => !el.id.includes('heading-'));
      if (nonHeadingElements.length > 0) {
        return nonHeadingElements;
      }
      
      // Last resort: use all elements but we'll handle them in getLatestResponse
      return allElementsWithId;
    }
    
    // Try data-testid
    responses = Array.from(document.querySelectorAll('[data-testid*="assistant"]'));
    if (responses.length > 0) {
      return responses;
    }
    
    // Look for message containers with assistant role
    responses = Array.from(document.querySelectorAll('[class*="assistant"]'));
    if (responses.length > 0) {
      return responses;
    }
    
    // Fallback: find alternating user/assistant pattern
    const allMessages = document.querySelectorAll('[class*="message"]');
    const assistantMsgs = [];
    allMessages.forEach((msg, i) => {
      // Typically, even indices are user, odd are assistant
      if (i % 2 === 1) assistantMsgs.push(msg);
    });
    
    return assistantMsgs;
  }
  
  getLatestResponse() {
    // Override to handle nested p elements properly
    const responses = this.getResponses();
    if (responses.length === 0) {
      return null;
    }
    
    const last = responses[responses.length - 1];
    
    // If this is a heading element, try to find the actual content
    let contentElement = last;
    if (last.id && last.id.includes('heading-')) {
      // Try next sibling
      let sibling = last.nextElementSibling;
      if (sibling) {
        const siblingText = (sibling.innerText || sibling.textContent || '').trim();
        if (siblingText.length > 50) {
          contentElement = sibling;
        }
      }
      
      // If sibling didn't work, try parent
      if (contentElement === last) {
        let parent = last.parentElement;
        if (parent && parent !== document.body) {
          const parentText = (parent.innerText || parent.textContent || '').trim();
          const lastText = (last.innerText || last.textContent || '').trim();
          // Parent should have significantly more text
          if (parentText.length > lastText.length + 30) {
            contentElement = parent;
          }
        }
      }
    }
    
    // DuckDuckGo structures content in <p> elements inside the container
    // Try to get text from nested p elements first
    const paragraphs = contentElement.querySelectorAll?.('p') || [];
    
    if (paragraphs.length > 0) {
      const textParts = Array.from(paragraphs).map(p => 
        (p.innerText || p.textContent || '').trim()
      ).filter(t => t.length > 0 && !t.match(/^GPT-4o mini$/i)); // Filter out author names
      if (textParts.length > 0) {
        return textParts.join('\n\n').trim();
      }
    }
    
    // Fallback to standard extraction
    let result = (contentElement.innerText || contentElement.textContent || '').trim();
    // Remove author name if it's at the start
    result = result.replace(/^GPT-4o mini\s*[.\n]*/i, '').trim();
    return result;
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

