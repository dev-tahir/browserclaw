// Content Script - Injected into web pages for DOM manipulation
// Handles all direct page interaction commands from the service worker

(() => {
  // Prevent double injection
  if (window.__browserControlAgentInjected) return;
  window.__browserControlAgentInjected = true;

  // ============ MESSAGE HANDLER ============

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleAction(message).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  });

  async function handleAction(message) {
    switch (message.action) {
      case 'ping':
        return { success: true, pong: true };
      case 'click':
        return doClick(message.selector);
      case 'type_text':
        return doTypeText(message.selector, message.text, message.clearFirst);
      case 'copy_image':
        return doCopyImage(message.selector, message.url);
      case 'press_key':
        return doPressKey(message.key, message.selector);
      case 'hover':
        return doHover(message.selector);
      case 'select_option':
        return doSelectOption(message.selector, message.value);
      case 'fill_form':
        return doFillForm(message.fields);
      case 'find_elements':
        return doFindElements(message.selector, message.limit);
      case 'find_clickable':
        return doFindClickable(message.filter);
      case 'scroll':
        return doScroll(message.direction, message.amount, message.selector);
      case 'wait_for_element':
        return doWaitForElement(message.selector, message.timeout);
      case 'get_page_info':
        return doGetPageInfo();
      case 'extract_content':
        return doExtractContent();
      case 'extract_all_text':
        return doExtractAllText();
      case 'get_element_coords':
        return doGetElementCoords(message.selector);
      case 'get_mapped_button_coords':
        return doGetMappedButtonCoords(message.n);
      case 'page_snapshot':
        return doPageSnapshot();
      case 'verify_state':
        return doVerifyState(message.checks);
      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  }

  // ============ ELEMENT COORDINATES (for debugger clicks) ============

  function doGetElementCoords(selector) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };

    el.scrollIntoView({ behavior: 'instant', block: 'center' });

    // Re-measure after scroll
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    return {
      success: true,
      x, y,
      rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      element: describeElement(el),
      selector: generateUniqueSelector(el)
    };
  }

  function doGetMappedButtonCoords(n) {
    const el = document.querySelector(`[data-bca-n="${n}"]`);
    if (!el) return { success: false, error: `Mapped button ${n} not found in DOM` };

    el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim().slice(0, 80);

    return { success: true, x, y, tag, text, n };
  }

  // ============ CLICK ============

  function doClick(selector) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };

    // Scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Simulate real click events
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    el.click();

    return {
      success: true,
      element: describeElement(el),
      message: `Clicked: ${describeElement(el).text || selector}`
    };
  }

  // ============ TYPE TEXT ============

  function doTypeText(selector, text, clearFirst = true) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();

    const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

    if (isContentEditable) {
      // ── Contenteditable (e.g. X/Twitter's Lexical tweet box, Google Docs, etc.) ──
      // execCommand('insertText') fires native DOM input events that React/Lexical
      // intercepts correctly. Plain el.value = '...' has no effect on these elements.

      if (clearFirst) {
        // Select all content then delete it before inserting
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }

      // Insert the text – this triggers the editor's internal event handlers
      document.execCommand('insertText', false, text);

      // Also fire a synthetic input event as fallback for any listeners not covered
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text }));

      return {
        success: true,
        message: `Typed "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" into contenteditable ${selector}`
      };
    }

    // ── Standard <input> / <textarea> ──
    if (clearFirst) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Use native setter so React's synthetic onChange fires correctly
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, (clearFirst ? '' : el.value) + text);
    } else {
      el.value = (clearFirst ? '' : el.value) + text;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      success: true,
      message: `Typed "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" into ${selector}`
    };
  }

  // ============ COPY IMAGE TO CLIPBOARD ============

  async function doCopyImage(selector, url) {
    try {
      let imageUrl = url;

      // Resolve URL from a DOM element if no explicit URL given
      if (!imageUrl && selector) {
        const el = findElement(selector);
        if (!el) return { success: false, error: `Element not found: ${selector}` };
        imageUrl = el.src || el.currentSrc || el.href
          || el.getAttribute('data-src') || el.getAttribute('data-original')
          || el.style.backgroundImage?.match(/url\(["']?([^"')]+)/)?.[1];
        if (!imageUrl) return { success: false, error: `No image URL found on element: ${selector}` };
      }

      if (!imageUrl) return { success: false, error: 'Provide a selector or url argument' };

      // Fetch the image (cross-origin allowed via extension host_permissions)
      const resp = await fetch(imageUrl);
      if (!resp.ok) return { success: false, error: `Fetch failed: ${resp.status} ${resp.statusText}` };
      const blob = await resp.blob();

      // Convert to PNG via canvas if not already PNG/JPEG (ClipboardItem is picky)
      let finalBlob = blob;
      if (!['image/png', 'image/jpeg'].includes(blob.type)) {
        finalBlob = await _blobToPng(blob);
      }

      await navigator.clipboard.write([
        new ClipboardItem({ [finalBlob.type]: finalBlob })
      ]);

      return {
        success: true,
        message: `Copied image to clipboard (${finalBlob.type}, ${Math.round(finalBlob.size / 1024)}KB) from ${imageUrl.substring(0, 100)}`
      };
    } catch (err) {
      return { success: false, error: `copy_image failed: ${err.message}` };
    }
  }

  function _blobToPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(pngBlob => {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('Canvas toBlob returned null'));
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Image load failed')); };
      img.src = objUrl;
    });
  }

  // ============ PRESS KEY ============

  function doPressKey(key, selector) {
    const el = selector ? findElement(selector) : document.activeElement || document.body;
    if (selector && !el) return { success: false, error: `Element not found: ${selector}` };

    if (selector) el.focus();

    const eventInit = {
      key,
      code: key,
      keyCode: getKeyCode(key),
      which: getKeyCode(key),
      bubbles: true,
      cancelable: true
    };

    el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    el.dispatchEvent(new KeyboardEvent('keyup', eventInit));

    // Special handling for Enter on forms
    if (key === 'Enter' && el.form) {
      el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    return { success: true, message: `Pressed key: ${key}` };
  }

  function getKeyCode(key) {
    const codes = {
      'Enter': 13, 'Tab': 9, 'Escape': 27, 'Backspace': 8,
      'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39,
      'Space': 32, 'Delete': 46
    };
    return codes[key] || key.charCodeAt(0);
  }

  // ============ HOVER ============

  function doHover(selector) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `Element not found: ${selector}` };

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const rect = el.getBoundingClientRect();

    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));

    return { success: true, message: `Hovered over: ${selector}` };
  }

  // ============ SELECT OPTION ============

  function doSelectOption(selector, value) {
    const el = findElement(selector);
    if (!el || el.tagName !== 'SELECT') {
      return { success: false, error: `Select element not found: ${selector}` };
    }

    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));

    return { success: true, message: `Selected value "${value}" in ${selector}` };
  }

  // ============ FILL FORM ============

  function doFillForm(fields) {
    const results = [];
    for (const field of fields) {
      const result = doTypeText(field.selector, field.value, true);
      results.push({ selector: field.selector, ...result });
    }
    const allSuccess = results.every(r => r.success);
    return {
      success: allSuccess,
      results,
      message: `Filled ${results.filter(r => r.success).length}/${fields.length} fields`
    };
  }

  // ============ FIND ELEMENTS ============

  function doFindElements(selector, limit = 20) {
    try {
      const elements = Array.from(document.querySelectorAll(selector)).slice(0, limit);
      if (elements.length === 0) {
        return { success: true, elements: [], message: `No elements found for: ${selector}` };
      }

      return {
        success: true,
        elements: elements.map((el, i) => ({
          index: i,
          ...describeElement(el),
          selector: generateUniqueSelector(el)
        })),
        count: elements.length,
        total: document.querySelectorAll(selector).length
      };
    } catch (e) {
      return { success: false, error: `Invalid selector: ${e.message}` };
    }
  }

  // ============ FIND CLICKABLE ============

  function doFindClickable(filter) {
    const clickableSelectors = [
      'a[href]', 'button', 'input[type="submit"]', 'input[type="button"]',
      '[role="button"]', '[onclick]', '[tabindex]',
      'input[type="text"]', 'input[type="email"]', 'input[type="password"]',
      'input[type="search"]', 'input[type="number"]', 'input[type="tel"]',
      'input[type="url"]', 'textarea', 'select',
      'input[type="checkbox"]', 'input[type="radio"]',
      '[contenteditable="true"]'
    ];

    const seen = new Set();
    const results = [];

    for (const sel of clickableSelectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        if (seen.has(el)) continue;
        seen.add(el);

        // Skip hidden elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

        const desc = describeElement(el);
        const uniqueSelector = generateUniqueSelector(el);

        // Apply filter
        if (filter) {
          const filterLower = filter.toLowerCase();
          const matchText = (desc.text + ' ' + desc.tag + ' ' + (desc.attributes.placeholder || '') +
            ' ' + (desc.attributes['aria-label'] || '')).toLowerCase();
          if (!matchText.includes(filterLower)) continue;
        }

        results.push({
          ...desc,
          selector: uniqueSelector,
          type: getElementType(el)
        });

        if (results.length >= 30) break;
      }
      if (results.length >= 30) break;
    }

    return {
      success: true,
      elements: results,
      count: results.length,
      message: `Found ${results.length} interactive elements`
    };
  }

  function getElementType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
    if (tag === 'input') return `input-${el.type || 'text'}`;
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    return 'interactive';
  }

  // ============ SCROLL ============

  /**
   * Find the nearest scrollable ancestor of an element.
   * Returns window if none found or no selector given.
   */
  function findScrollContainer(selector) {
    if (!selector) return null;
    const el = document.querySelector(selector);
    if (!el) return null;

    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const overflow = style.overflow + ' ' + style.overflowY;
      const canScroll = /auto|scroll/.test(overflow);
      if (canScroll && node.scrollHeight > node.clientHeight + 2) {
        return node;
      }
      node = node.parentElement;
    }

    // Check body / documentElement
    if (document.body.scrollHeight > window.innerHeight + 2) return null; // fall back to window
    return null;
  }

  function doScroll(direction, amount = 500, selector) {
    const container = findScrollContainer(selector);

    if (container) {
      // Scroll the specific element
      switch (direction) {
        case 'up':     container.scrollBy({ top: -amount, behavior: 'instant' }); break;
        case 'down':   container.scrollBy({ top:  amount, behavior: 'instant' }); break;
        case 'top':    container.scrollTo({ top: 0,                    behavior: 'instant' }); break;
        case 'bottom': container.scrollTo({ top: container.scrollHeight, behavior: 'instant' }); break;
      }
      const tag = container.tagName.toLowerCase();
      const cls = container.className ? '.' + container.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return {
        success: true,
        target: tag + cls,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        message: `Scrolled container <${tag + cls}> ${direction}${amount && direction !== 'top' && direction !== 'bottom' ? ` ${amount}px` : ''}`
      };
    }

    // No specific container — scroll window
    switch (direction) {
      case 'up':     window.scrollBy({ top: -amount, behavior: 'instant' }); break;
      case 'down':   window.scrollBy({ top:  amount, behavior: 'instant' }); break;
      case 'top':    window.scrollTo({ top: 0,                       behavior: 'instant' }); break;
      case 'bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }); break;
    }
    return {
      success: true,
      target: 'window',
      scrollY: window.scrollY,
      scrollHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      message: `Scrolled page ${direction}${amount && direction !== 'top' && direction !== 'bottom' ? ` ${amount}px` : ''}`
    };
  }

  // ============ WAIT FOR ELEMENT ============

  function doWaitForElement(selector, timeout = 10) {
    return new Promise((resolve) => {
      // Check if already exists
      const existing = document.querySelector(selector);
      if (existing) {
        resolve({ success: true, found: true, message: `Element already exists: ${selector}` });
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ success: true, found: true, message: `Element appeared: ${selector}` });
        }
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve({ success: true, found: false, message: `Element not found after ${timeout}s: ${selector}` });
      }, timeout * 1000);

      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });
  }

  // ============ PAGE INFO ============

  function doGetPageInfo() {
    return {
      success: true,
      url: window.location.href,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      scroll: {
        x: window.scrollX,
        y: window.scrollY,
        maxY: document.body.scrollHeight - window.innerHeight
      },
      readyState: document.readyState
    };
  }

  // ============ CONTENT EXTRACTION ============

  function doExtractContent() {
    // Extract main content, filtering out nav/sidebar/footer/ads
    const contentSelectors = ['article', 'main', '[role="main"]', '.content', '.post', '.entry'];
    let contentEl = null;

    for (const sel of contentSelectors) {
      contentEl = document.querySelector(sel);
      if (contentEl) break;
    }

    if (!contentEl) {
      contentEl = document.body;
    }

    const markdown = elementToMarkdown(contentEl, true);

    return {
      success: true,
      content: markdown.trim(),
      url: window.location.href,
      title: document.title
    };
  }

  function doExtractAllText() {
    const text = document.body.innerText || '';
    return {
      success: true,
      text: text.trim(),
      length: text.length,
      url: window.location.href,
      title: document.title
    };
  }

  // ============ MARKDOWN CONVERTER ============

  function elementToMarkdown(el, filterNonContent = false) {
    if (!el) return '';

    // Skip non-content elements
    if (filterNonContent) {
      const tag = el.tagName?.toLowerCase();
      const role = el.getAttribute?.('role');
      const cls = el.className || '';

      const skipTags = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'svg', 'iframe'];
      if (skipTags.includes(tag)) return '';

      const skipRoles = ['navigation', 'banner', 'contentinfo', 'complementary'];
      if (skipRoles.includes(role)) return '';

      const skipClasses = ['nav', 'menu', 'sidebar', 'footer', 'header', 'ad', 'ads', 'advertisement', 'cookie', 'popup', 'modal'];
      if (typeof cls === 'string' && skipClasses.some(c => cls.toLowerCase().includes(c))) return '';
    }

    const style = el.nodeType === 1 ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return '';

    if (el.nodeType === 3) {
      return el.textContent.replace(/\s+/g, ' ');
    }

    if (el.nodeType !== 1) return '';

    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes)
      .map(c => elementToMarkdown(c, filterNonContent))
      .join('');

    switch (tag) {
      case 'h1': return `\n# ${children.trim()}\n\n`;
      case 'h2': return `\n## ${children.trim()}\n\n`;
      case 'h3': return `\n### ${children.trim()}\n\n`;
      case 'h4': return `\n#### ${children.trim()}\n\n`;
      case 'h5': return `\n##### ${children.trim()}\n\n`;
      case 'h6': return `\n###### ${children.trim()}\n\n`;
      case 'p': return `\n${children.trim()}\n\n`;
      case 'br': return '\n';
      case 'hr': return '\n---\n\n';
      case 'strong':
      case 'b': return `**${children.trim()}**`;
      case 'em':
      case 'i': return `*${children.trim()}*`;
      case 'code': return `\`${children.trim()}\``;
      case 'pre': return `\n\`\`\`\n${el.textContent.trim()}\n\`\`\`\n\n`;
      case 'a': {
        const href = el.getAttribute('href');
        const text = children.trim();
        return href ? `[${text}](${href})` : text;
      }
      case 'img': {
        const alt = el.getAttribute('alt') || '';
        const src = el.getAttribute('src') || '';
        return `![${alt}](${src})`;
      }
      case 'ul': return `\n${children}\n`;
      case 'ol': return `\n${children}\n`;
      case 'li': {
        const parent = el.parentElement;
        const prefix = parent?.tagName?.toLowerCase() === 'ol'
          ? `${Array.from(parent.children).indexOf(el) + 1}. `
          : '- ';
        return `${prefix}${children.trim()}\n`;
      }
      case 'blockquote': return `\n> ${children.trim().replace(/\n/g, '\n> ')}\n\n`;
      case 'table': return `\n${tableToMarkdown(el)}\n\n`;
      case 'div':
      case 'section':
      case 'article':
      case 'main':
        return children;
      default:
        return children;
    }
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return '';

    const result = [];
    rows.forEach((row, i) => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const line = '| ' + cells.map(c => c.textContent.trim().replace(/\|/g, '\\|')).join(' | ') + ' |';
      result.push(line);

      // Add header separator after first row
      if (i === 0) {
        result.push('| ' + cells.map(() => '---').join(' | ') + ' |');
      }
    });

    return result.join('\n');
  }

  // ============ HELPERS ============

  function findElement(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      // Try xpath if CSS selector fails
      try {
        const result = document.evaluate(
          selector, document, null,
          XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        return result.singleNodeValue;
      } catch (xe) {
        return null;
      }
    }
  }

  function describeElement(el) {
    const tag = el.tagName?.toLowerCase() || '';
    const rect = el.getBoundingClientRect();

    const attrs = {};
    const importantAttrs = ['id', 'class', 'href', 'src', 'type', 'name', 'value',
      'placeholder', 'aria-label', 'title', 'role', 'alt'];

    for (const attr of importantAttrs) {
      const val = el.getAttribute(attr);
      if (val) {
        attrs[attr] = val.length > 100 ? val.substring(0, 100) + '...' : val;
      }
    }

    return {
      tag,
      text: (el.textContent || '').trim().substring(0, 200),
      attributes: attrs,
      visible: rect.width > 0 && rect.height > 0,
      position: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function generateUniqueSelector(el) {
    // Try ID first
    if (el.id) return `#${CSS.escape(el.id)}`;

    // Try unique class combination
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        const classSelector = el.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      }
    }

    // Try tag + attributes
    const attrs = ['name', 'data-testid', 'aria-label', 'placeholder', 'type', 'role', 'href', 'title'];
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (val) {
        const attrSelector = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
        if (document.querySelectorAll(attrSelector).length === 1) {
          return attrSelector;
        }
      }
    }

    // Build path from parent
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment = `#${CSS.escape(current.id)}`;
        path.unshift(segment);
        break;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }
      path.unshift(segment);
      current = parent;
    }

    return path.join(' > ');
  }

  // ============ PAGE SNAPSHOT (lightweight DOM fingerprint) ============

  function doPageSnapshot() {
    const url = window.location.href;
    const title = document.title;

    // Notable selectors to scan for — covers modals, dialogs, alerts, banners, forms, overlays
    const notableSelectors = [
      'dialog[open]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[role="alert"]',
      '[role="banner"]',
      '[role="status"]',
      '.modal', '.Modal',
      '.popup', '.Popup',
      '.overlay', '.Overlay',
      '.toast', '.Toast',
      '.error', '.Error', '.alert-error',
      '.success', '.alert-success',
      '.notification', '.Notification',
      '.snackbar', '.Snackbar',
      '[class*="modal"]',
      '[class*="dialog"]',
      '[class*="popup"]',
      '[class*="overlay"]',
      '[class*="toast"]',
      '[class*="error"]',
      '[class*="banner"]',
      'form',
      '[aria-modal="true"]',
      '[data-testid]'
    ];

    const notableElements = [];
    const seen = new WeakSet();

    for (const sel of notableSelectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (seen.has(el)) continue;
          seen.add(el);
          const rect = el.getBoundingClientRect();
          // Only include visible elements
          if (rect.width < 2 || rect.height < 2) continue;
          const cs = window.getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;

          const tag = el.tagName.toLowerCase();
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 120);
          const classes = (typeof el.className === 'string' ? el.className : '').trim().substring(0, 150);

          notableElements.push({
            selector: _quickSelector(el),
            tag,
            role: el.getAttribute('role') || '',
            classes,
            text,
            ariaLabel: el.getAttribute('aria-label') || '',
            visible: true
          });

          if (notableElements.length >= 40) break;
        }
      } catch {}
      if (notableElements.length >= 40) break;
    }

    return {
      success: true,
      url,
      title,
      readyState: document.readyState,
      notableElements
    };
  }

  // Quick selector for snapshot diffing — prefer id, then data-testid, then role+class, then tag path
  function _quickSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const role = el.getAttribute('role');
    if (role) {
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0];
      return cls ? `[role="${role}"].${CSS.escape(cls)}` : `[role="${role}"]`;
    }
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0];
    return cls ? `${tag}.${CSS.escape(cls)}` : tag;
  }

  // ============ VERIFY STATE (assertions for execute_steps) ============

  function doVerifyState(checks) {
    const results = [];
    let allPassed = true;

    if (checks.url_contains) {
      const passed = window.location.href.includes(checks.url_contains);
      results.push({ check: 'url_contains', expected: checks.url_contains, actual: window.location.href, passed });
      if (!passed) allPassed = false;
    }

    if (checks.url_not_contains) {
      const passed = !window.location.href.includes(checks.url_not_contains);
      results.push({ check: 'url_not_contains', expected: checks.url_not_contains, actual: window.location.href, passed });
      if (!passed) allPassed = false;
    }

    if (checks.title_contains) {
      const passed = document.title.toLowerCase().includes(checks.title_contains.toLowerCase());
      results.push({ check: 'title_contains', expected: checks.title_contains, actual: document.title, passed });
      if (!passed) allPassed = false;
    }

    if (checks.element_exists) {
      const el = document.querySelector(checks.element_exists);
      const passed = !!el;
      results.push({ check: 'element_exists', expected: checks.element_exists, passed });
      if (!passed) allPassed = false;
    }

    if (checks.element_absent) {
      const el = document.querySelector(checks.element_absent);
      const visible = el ? (() => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      })() : false;
      const passed = !visible;
      results.push({ check: 'element_absent', expected: checks.element_absent, passed });
      if (!passed) allPassed = false;
    }

    if (checks.text_contains) {
      const bodyText = document.body.innerText || '';
      const passed = bodyText.includes(checks.text_contains);
      results.push({ check: 'text_contains', expected: checks.text_contains, passed });
      if (!passed) allPassed = false;
    }

    if (checks.text_absent) {
      const bodyText = document.body.innerText || '';
      const passed = !bodyText.includes(checks.text_absent);
      results.push({ check: 'text_absent', expected: checks.text_absent, passed });
      if (!passed) allPassed = false;
    }

    return { success: true, allPassed, results };
  }

})();
