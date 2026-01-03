// Kimi Platform Adapter
// URL: https://www.kimi.com/

class KimiAdapter extends BasePlatformAdapter {
  constructor() {
    super();
    this.name = 'kimi';
    this.hostPatterns = ['kimi.com', 'www.kimi.com'];
    
    // Selectors for Kimi Chat
    this.selectors = {
      input: [
        '.chat-input-editor',
        'div[data-lexical-editor="true"]',
        'div.chat-input-editor[contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea',
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      responses: [
        '.message-list-container [class*="message"]:not([class*="user"]):not([class*="human"])',
        '[class*="message-item"]:not([class*="user"]):not([class*="human"])',
        '[class*="assistant-message"]',
        '[class*="message-assistant"]',
        '[data-role="assistant"]',
        '[data-author="assistant"]',
        '.assistant-message',
        '.message-assistant',
        '[class*="assistant"]',
        '[class*="response"]',
        '[class*="kimi-message"]',
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
    const input = this.findFirst(this.selectors.input);
    console.log('[KimiAdapter] getInputField:', input ? {
      tagName: input.tagName,
      className: input.className,
      id: input.id,
      contentEditable: input.contentEditable
    } : 'NOT FOUND');
    return input;
  }
  
  getSendButton() {
    const btn = this.findFirst(this.selectors.sendButton);
    console.log('[KimiAdapter] getSendButton:', btn ? {
      tagName: btn.tagName,
      className: btn.className,
      disabled: btn.disabled
    } : 'NOT FOUND (will use Enter key)');
    return (btn && !btn.disabled) ? btn : null;
  }
  
  getResponses() {
    console.log('[KimiAdapter] getResponses called');
    
    // Try to find response messages - Kimi may use various patterns
    const responses = this.findAll(this.selectors.responses);
    console.log('[KimiAdapter] getResponses: Found', responses.length, 'responses with standard selectors');
    
    if (responses.length === 0) {
      // Try alternative patterns specific to Kimi
      console.log('[KimiAdapter] getResponses: Trying alternative selectors');
      
      // Check for common message container patterns
      const altSelectors = [
        '[class*="message-item"]',
        '[class*="MessageItem"]',
        '[class*="chat-message"]',
        '[class*="ChatMessage"]',
        '.message-list-container [class*="message"]',
        '[class*="message-list"] [class*="message"]'
      ];
      
      for (const selector of altSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log('[KimiAdapter] getResponses: Found', elements.length, 'with selector:', selector);
          // Filter to assistant messages (exclude user messages)
          const assistantMessages = Array.from(elements).filter(el => {
            const text = (el.textContent || el.innerText || '').trim();
            const className = (el.className || '').toString().toLowerCase();
            // Exclude user messages and very short text
            return text.length > 20 && 
                   !className.includes('user') &&
                   !className.includes('human') &&
                   !el.closest('[class*="user"]');
          });
          if (assistantMessages.length > 0) {
            console.log('[KimiAdapter] getResponses: Found', assistantMessages.length, 'assistant messages');
            return assistantMessages;
          }
        }
      }
    }
    
    return responses;
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
    console.log('[KimiAdapter] setInputText called, text length:', text.length);
    const input = this.getInputField();
    if (!input) {
      console.log('[KimiAdapter] setInputText: Input field not found');
      return false;
    }
    
    input.focus();
    await this.sleep(200);
    
    // Handle different input types
    if (input.tagName === 'TEXTAREA') {
      console.log('[KimiAdapter] setInputText: Using TEXTAREA method');
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[KimiAdapter] setInputText: Text set to textarea, value:', input.value.substring(0, 50));
    } else if (input.contentEditable === 'true') {
      console.log('[KimiAdapter] setInputText: Using contentEditable (Lexical) method');
      
      // For Lexical editors, we need to use a different approach
      // Method 1: Try using document.execCommand (works for many editors)
      try {
        // Select all existing content
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Delete selected content and insert new text
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, text);
        
        console.log('[KimiAdapter] setInputText: Used execCommand method');
        await this.sleep(100);
        
        // Verify text was set
        const textContent = input.textContent || input.innerText || '';
        console.log('[KimiAdapter] setInputText: After execCommand, textContent length:', textContent.length);
        
        if (textContent.length > 0) {
          // Dispatch input events
          input.dispatchEvent(new InputEvent('input', { 
            bubbles: true, 
            cancelable: true,
            inputType: 'insertText',
            data: text
          }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      } catch (e) {
        console.log('[KimiAdapter] setInputText: execCommand failed:', e);
      }
      
      // Method 2: Try direct manipulation (fallback)
      console.log('[KimiAdapter] setInputText: Trying direct manipulation fallback');
      try {
        // Clear first
        input.textContent = '';
        // Create text node and append
        const textNode = document.createTextNode(text);
        input.appendChild(textNode);
        
        // Dispatch events
        input.dispatchEvent(new InputEvent('beforeinput', { 
          bubbles: true, 
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
        input.dispatchEvent(new InputEvent('input', { 
          bubbles: true, 
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        const textContent = input.textContent || input.innerText || '';
        console.log('[KimiAdapter] setInputText: After direct manipulation, textContent length:', textContent.length);
      } catch (e) {
        console.log('[KimiAdapter] setInputText: Direct manipulation failed:', e);
      }
    } else {
      console.log('[KimiAdapter] setInputText: Unknown input type, tagName:', input.tagName);
    }
    
    return true;
  }
  
  // Override clickSend for Kimi - uses Enter key since no visible send button
  async clickSend() {
    console.log('[KimiAdapter] clickSend called');
    
    // First, try to find a send button again (might appear after text is entered)
    const sendBtn = this.getSendButton();
    if (sendBtn) {
      console.log('[KimiAdapter] clickSend: Found send button, clicking it');
      sendBtn.click();
      await this.sleep(100);
      console.log('[KimiAdapter] clickSend: Send button clicked');
      return true;
    }
    
    const input = this.getInputField();
    if (!input) {
      console.log('[KimiAdapter] clickSend: Input field not found');
      return false;
    }
    
    console.log('[KimiAdapter] clickSend: No send button found, using Enter key method');
    
    // For Lexical editor, ensure input is focused and has content
    input.focus();
    await this.sleep(150);
    console.log('[KimiAdapter] clickSend: Input focused');
    
    // Check if input has content
    const textContent = input.textContent || input.innerText || '';
    const hasContent = textContent.trim().length > 0;
    console.log('[KimiAdapter] clickSend: Input has content:', hasContent, 'textContent length:', textContent.length);
    
    if (!hasContent) {
      console.log('[KimiAdapter] clickSend: WARNING - No content in input, cannot send');
      return false;
    }
    
    // For Lexical editors, programmatic keyboard events often don't work
    // Try multiple methods to trigger send
    
    // Method 1: Dispatch events on the input element with all properties
    console.log('[KimiAdapter] clickSend: Method 1 - Dispatch on input element');
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false
    });
    const dispatched = input.dispatchEvent(enterEvent);
    console.log('[KimiAdapter] clickSend: keydown on input, defaultPrevented:', enterEvent.defaultPrevented);
    
    await this.sleep(30);
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true
    }));
    
    // Method 2: Also try dispatching on document/window (sometimes Lexical listens at higher level)
    await this.sleep(50);
    console.log('[KimiAdapter] clickSend: Method 2 - Dispatch on document');
    const docEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    document.dispatchEvent(docEvent);
    
    // Method 3: Try finding and clicking a send button that might appear
    await this.sleep(100);
    console.log('[KimiAdapter] clickSend: Method 3 - Check for send button again');
    const sendBtnAfter = this.getSendButton();
    if (sendBtnAfter && sendBtnAfter.offsetParent !== null) {
      console.log('[KimiAdapter] clickSend: Send button appeared, clicking it');
      sendBtnAfter.click();
      return true;
    }
    
    // Method 4: Try to find a parent form and submit it
    await this.sleep(50);
    const form = input.closest('form');
    if (form) {
      console.log('[KimiAdapter] clickSend: Method 4 - Found form, trying submit event');
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(submitEvent);
    }
    
    console.log('[KimiAdapter] clickSend: Completed all methods');
    
    // Wait and check if message was sent
    await this.sleep(300);
    const textContentAfter = input.textContent || input.innerText || '';
    const wasSent = textContentAfter.trim().length === 0;
    console.log('[KimiAdapter] clickSend: After 300ms, input cleared:', wasSent, 'textContent length:', textContentAfter.length);
    
    return true;
  }
}

// Register adapter
window.KimiAdapter = KimiAdapter;

