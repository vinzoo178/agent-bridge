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
        '.send-button',
        'div.send-button',
        '.send-button-container button',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button:has-text("Send")',
      ],
      responses: [
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
    // Try button selectors first
    for (const selector of this.selectors.sendButton) {
      const btn = document.querySelector(selector);
      if (btn) {
        // If it's a button, check if it's enabled
        if (btn.tagName === 'BUTTON' && btn.offsetParent !== null && !btn.disabled) {
          console.log('[KimiAdapter] getSendButton: Found button:', selector);
          return btn;
        }
        // If it's a div with send-button class, check if it's clickable
        if (btn.tagName === 'DIV' && btn.offsetParent !== null) {
          // Check if there's a button inside
          const innerButton = btn.querySelector('button');
          if (innerButton && !innerButton.disabled) {
            console.log('[KimiAdapter] getSendButton: Found button inside div:', selector);
            return innerButton;
          }
          // If no button inside, the div itself might be clickable
          console.log('[KimiAdapter] getSendButton: Found clickable div:', selector);
          return btn;
        }
      }
    }
    
    console.log('[KimiAdapter] getSendButton: NOT FOUND (will use Enter key)');
    return null;
  }
  
  getResponses() {
    console.log('[KimiAdapter] getResponses called, URL:', window.location.href);
    
    // Try to find response messages - Kimi may use various patterns
    // First, filter out container elements like .message-list
    const allResponses = this.findAll(this.selectors.responses);
    const responses = allResponses.filter(el => {
      const className = (el.className || '').toString().toLowerCase();
      const text = (el.textContent || el.innerText || '').trim();
      // Exclude container elements (like .message-list) that have no direct text
      return !className.includes('message-list') && text.length > 0;
    });
    
    console.log('[KimiAdapter] getResponses: Found', responses.length, 'responses after filtering (from', allResponses.length, 'total)');
    
    if (responses.length === 0) {
      // Try alternative patterns specific to Kimi
      console.log('[KimiAdapter] getResponses: Trying alternative selectors');
      
      // Check for common message container patterns (but exclude .message-list)
      const altSelectors = [
        '[class*="message-item"]',
        '[class*="MessageItem"]',
        '[class*="chat-message"]',
        '[class*="ChatMessage"]'
      ];
      
      for (const selector of altSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log('[KimiAdapter] getResponses: Found', elements.length, 'with selector:', selector);
          // Filter to assistant messages (exclude user messages and containers)
          const assistantMessages = Array.from(elements).filter(el => {
            const text = (el.textContent || el.innerText || '').trim();
            const className = (el.className || '').toString().toLowerCase();
            // Exclude user messages, containers, and very short text
            return text.length > 20 && 
                   !className.includes('user') &&
                   !className.includes('human') &&
                   !className.includes('message-list') &&
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
  
  getLatestResponse() {
    const responses = this.getResponses();
    console.log('[KimiAdapter] getLatestResponse: Found', responses.length, 'responses');
    
    if (responses.length === 0) {
      console.log('[KimiAdapter] getLatestResponse: No responses found');
      return null;
    }
    
    const last = responses[responses.length - 1];
    console.log('[KimiAdapter] getLatestResponse: Last element:', {
      tagName: last.tagName,
      className: (last.className || '').toString().substring(0, 100),
      id: last.id || '',
      innerTextLength: (last.innerText || '').trim().length,
      textContentLength: (last.textContent || '').trim().length
    });
    
    // Try to find text content - check children if direct text is empty
    let text = (last.innerText || last.textContent || '').trim();
    
    if (text.length === 0) {
      // Try to find text in child elements
      const textElements = last.querySelectorAll('p, div, span, [class*="content"], [class*="text"], [class*="message"]');
      for (const el of textElements) {
        const childText = (el.innerText || el.textContent || '').trim();
        if (childText.length > text.length) {
          text = childText;
        }
      }
      console.log('[KimiAdapter] getLatestResponse: After checking children, text length:', text.length);
    }
    
    console.log('[KimiAdapter] getLatestResponse: Text length:', text.length, 'preview:', text.substring(0, 50));
    
    return text;
  }
  
  isGenerating() {
    // Check stop button
    const stopBtn = this.findFirst(this.selectors.stopButton);
    if (stopBtn && stopBtn.offsetParent !== null && !stopBtn.disabled) {
      console.log('[KimiAdapter] isGenerating: TRUE (stop button found)');
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
        console.log('[KimiAdapter] isGenerating: TRUE (loading indicator found:', selector, ')');
        return true;
      }
    }
    
    console.log('[KimiAdapter] isGenerating: FALSE');
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
      console.log('[KimiAdapter] clickSend: Found send button, clicking it', {
        tagName: sendBtn.tagName,
        className: sendBtn.className
      });
      
      // If it's a div, try clicking it directly
      if (sendBtn.tagName === 'DIV') {
        // Try mouse events for div
        sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await this.sleep(50);
        sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        await this.sleep(50);
        sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } else {
        sendBtn.click();
      }
      
      await this.sleep(200);
      
      // Check if input was cleared (message sent)
      const input = this.getInputField();
      const textAfter = input ? (input.textContent || input.innerText || '').trim() : '';
      console.log('[KimiAdapter] clickSend: After click, input text length:', textAfter.length);
      
      if (textAfter.length === 0) {
        console.log('[KimiAdapter] clickSend: Message sent successfully (input cleared)');
        return true;
      }
      
      console.log('[KimiAdapter] clickSend: Input not cleared, message may not have sent');
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

