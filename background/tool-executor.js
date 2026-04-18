// Tool Executor - Executes browser automation tools
// Bridges between AI tool calls and Chrome APIs / Content Scripts
// Uses chrome.debugger (CDP) for trusted mouse/keyboard input

import { DebuggerController } from './debugger-controller.js';

const NATIVE_HOST_NAME = 'com.browser_control.agent';

export class ToolExecutor {
  constructor() {
    this.nativePort = null;
    this.nativePendingCallbacks = new Map();
    this.nativeMessageId = 0;
    this._buttonMap = new Map(); // tabId -> [{n, tag, text, ariaLabel, role}]
    this.debugger = new DebuggerController();
  }

  // Execute a tool call and return the result
  async execute(toolName, args, context) {
    const { tabId, permissions } = context;
    const shouldDiff = tabId && ToolExecutor.DIFF_TOOLS.has(toolName);

    try {
      // Take before-snapshot for action tools
      let beforeSnap = null;
      if (shouldDiff) {
        beforeSnap = await this._snapPage(tabId).catch(() => null);
      }

      const result = await this._executeInner(toolName, args, tabId, permissions, context);

      // Take after-snapshot and diff
      if (shouldDiff && beforeSnap && result.success !== false) {
        // Wait for auto-wait duration first so page settles
        const autoWait = ToolExecutor.AUTO_WAITS[toolName];
        if (autoWait && !context._skipAutoWaitForDiff) {
          await new Promise(r => setTimeout(r, autoWait));
        }
        const afterSnap = await this._snapPage(tabId).catch(() => null);
        if (afterSnap) {
          const changes = this._diffSnapshots(beforeSnap, afterSnap);
          if (changes) result.pageChanges = changes;
        }
      }

      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _executeInner(toolName, args, tabId, permissions, context) {
    switch (toolName) {
        case 'navigate':
          return await this.navigate(tabId, args.url);
        case 'click':
          return await this.click(tabId, args.selector);
        case 'type_text':
          return await this.typeText(tabId, args.selector, args.text, args.clearFirst !== false);
        case 'press_key':
          return await this.pressKey(tabId, args.key, args.selector);
        case 'screenshot':
          return await this.screenshot(tabId);
        case 'map_buttons':
          return await this.mapButtons(tabId);
        case 'press_mapped_button':
          return await this.pressMappedButton(tabId, args.n);
        case 'extract_content':
          return await this.extractContent(tabId);
        case 'extract_all_text':
          return await this.extractAllText(tabId);
        case 'find_elements':
          return await this.findElements(tabId, args.selector, args.limit || 20);
        case 'find_clickable':
          return await this.findClickable(tabId, args.filter);
        case 'scroll':
          return await this.scroll(tabId, args.direction, args.amount || 500, args.selector);
        case 'select_option':
          return await this.selectOption(tabId, args.selector, args.value);
        case 'fill_form':
          return await this.fillForm(tabId, args.fields);
        case 'wait':
          return await this.wait(args.seconds, args.reason);
        case 'wait_for_element':
          return await this.waitForElement(tabId, args.selector, args.timeout || 10);
        case 'get_page_info':
          return await this.getPageInfo(tabId);
        case 'execute_javascript':
          return await this.executeJavascript(tabId, args.code);
        case 'new_tab':
          return await this.newTab(args.url);
        case 'close_tab':
          return await this.closeTab(tabId);
        case 'switch_tab':
          return await this.switchTab(args.index);
        case 'list_tabs':
          return await this.listTabs();
        case 'execute_terminal':
          if (!permissions.terminal) {
            return { success: false, error: 'Terminal permission not granted' };
          }
          return await this.executeTerminal(args.command, args.timeout || 30);
        case 'hover':
          return await this.hover(tabId, args.selector);
        case 'go_back':
          return await this.goBack(tabId);
        case 'go_forward':
          return await this.goForward(tabId);
        case 'execute_steps':
          return await this.executeSteps(args.plan, context);
        case 'task_complete':
          return { success: true, completed: true, summary: args.summary };
        case 'task_failed':
          return { success: false, failed: true, reason: args.reason };
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }

  // ============ NAVIGATION ============

  async navigate(tabId, url) {
    // Validate URL
    if (!url.match(/^https?:\/\//i)) {
      if (!url.includes('://')) url = 'https://' + url;
    }
    await chrome.tabs.update(tabId, { url });
    // Wait for page to load
    await this._waitForTabLoad(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { success: true, url: tab.url, title: tab.title };
  }

  async goBack(tabId) {
    await chrome.tabs.goBack(tabId);
    await this._waitForTabLoad(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { success: true, url: tab.url, title: tab.title };
  }

  async goForward(tabId) {
    await chrome.tabs.goForward(tabId);
    await this._waitForTabLoad(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { success: true, url: tab.url, title: tab.title };
  }

  // ============ TAB MANAGEMENT ============

  async newTab(url) {
    const createProps = {};
    if (url) createProps.url = url;
    const tab = await chrome.tabs.create(createProps);
    if (url) await this._waitForTabLoad(tab.id);
    return { success: true, tabId: tab.id, url: tab.url || url || 'about:newtab' };
  }

  async closeTab(tabId) {
    await this.debugger.detach(tabId);
    await chrome.tabs.remove(tabId);
    return { success: true, message: 'Tab closed' };
  }

  async switchTab(index) {
    const tabs = await chrome.tabs.query({});
    if (index < 0 || index >= tabs.length) {
      return { success: false, error: `Tab index ${index} out of range (0-${tabs.length - 1})` };
    }
    await chrome.tabs.update(tabs[index].id, { active: true });
    return { success: true, tabId: tabs[index].id, url: tabs[index].url, title: tabs[index].title };
  }

  async listTabs() {
    const tabs = await chrome.tabs.query({});
    return {
      success: true,
      tabs: tabs.map((t, i) => ({
        index: i,
        tabId: t.id,
        url: t.url,
        title: t.title,
        active: t.active
      }))
    };
  }

  // ============ DOM INTERACTION (TRUSTED via chrome.debugger) ============

  async click(tabId, selector) {
    // Get element coordinates from content script
    const coords = await this._sendToContent(tabId, { action: 'get_element_coords', selector });
    if (!coords.success) return coords;

    // Perform trusted click via CDP
    await this.debugger.click(tabId, coords.x, coords.y);

    return {
      success: true,
      element: coords.element,
      message: `Clicked (trusted): ${coords.element?.text || selector} at (${coords.x}, ${coords.y})`
    };
  }

  async typeText(tabId, selector, text, clearFirst) {
    // If a selector is given, trusted-click the element first to focus it
    if (selector) {
      const clickResult = await this.click(tabId, selector);
      if (!clickResult.success) return clickResult;
      // Small delay for focus/activation to settle
      await new Promise(r => setTimeout(r, 100));
    }

    // Clear existing text if requested
    if (clearFirst) {
      await this.debugger.clearField(tabId);
      await new Promise(r => setTimeout(r, 50));
    }

    // Type using trusted CDP input
    await this.debugger.typeText(tabId, text);

    return {
      success: true,
      message: `Typed (trusted) "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" into ${selector || 'focused element'}`
    };
  }

  async pressKey(tabId, key, selector) {
    // If a selector is given, trusted-click to focus first
    if (selector) {
      const clickResult = await this.click(tabId, selector);
      if (!clickResult.success) return clickResult;
      await new Promise(r => setTimeout(r, 50));
    }

    await this.debugger.pressKey(tabId, key);
    return { success: true, message: `Pressed key (trusted): ${key}` };
  }

  async hover(tabId, selector) {
    const coords = await this._sendToContent(tabId, { action: 'get_element_coords', selector });
    if (!coords.success) return coords;

    // Move mouse to element (triggers hover/mouseenter)
    await this.debugger.attach(tabId);
    await this.debugger._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: coords.x,
      y: coords.y,
      button: 'none'
    });

    return { success: true, message: `Hovered (trusted) over: ${selector} at (${coords.x}, ${coords.y})` };
  }

  async selectOption(tabId, selector, value) {
    // Click the select to focus it first, then let content script handle value setting
    await this.click(tabId, selector);
    await new Promise(r => setTimeout(r, 50));
    return await this._sendToContent(tabId, { action: 'select_option', selector, value });
  }

  async fillForm(tabId, fields) {
    const results = [];
    for (const field of fields) {
      const result = await this.typeText(tabId, field.selector, field.value, true);
      results.push({ selector: field.selector, ...result });
    }
    const allSuccess = results.every(r => r.success);
    return {
      success: allSuccess,
      results,
      message: `Filled ${results.filter(r => r.success).length}/${fields.length} fields`
    };
  }

  async findElements(tabId, selector, limit) {
    return await this._sendToContent(tabId, { action: 'find_elements', selector, limit });
  }

  async findClickable(tabId, filter) {
    return await this._sendToContent(tabId, { action: 'find_clickable', filter });
  }

  async scroll(tabId, direction, amount, selector) {
    return await this._sendToContent(tabId, { action: 'scroll', direction, amount, selector });
  }

  async waitForElement(tabId, selector, timeout) {
    return await this._sendToContent(tabId, { action: 'wait_for_element', selector, timeout });
  }

  async getPageInfo(tabId) {
    return await this._sendToContent(tabId, { action: 'get_page_info' });
  }

  async executeJavascript(tabId, code) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (codeStr) => {
          try {
            const result = eval(codeStr);
            return { success: true, result: String(result) };
          } catch (e) {
            return { success: false, error: e.message };
          }
        },
        args: [code],
        world: 'MAIN'
      });
      return results[0]?.result || { success: false, error: 'No result' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============ CONTENT EXTRACTION ============

  async extractContent(tabId) {
    return await this._sendToContent(tabId, { action: 'extract_content' });
  }

  async extractAllText(tabId) {
    return await this._sendToContent(tabId, { action: 'extract_all_text' });
  }

  // ============ SCREENSHOT ============

  async screenshot(tabId) {
    try {
      // Focus the tab first
      await chrome.tabs.update(tabId, { active: true });
      // Small delay for tab to render
      await new Promise(r => setTimeout(r, 300));
      const tab = await chrome.tabs.get(tabId);
      const rawDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      // Compress: resize to max 1280px wide, convert to JPEG at 70% quality
      const compressed = await this._compressScreenshot(rawDataUrl, 1280, 0.70);

      return { success: true, screenshot: compressed, format: 'jpeg' };
    } catch (err) {
      return { success: false, error: `Screenshot failed: ${err.message}` };
    }
  }

  /**
   * Compress a screenshot data URL using an OffscreenCanvas.
   * @param {string} dataUrl  Original PNG data URL
   * @param {number} maxWidth Max width in pixels (height is scaled proportionally)
   * @param {number} quality  JPEG quality 0–1
   * @returns {Promise<string>} Compressed JPEG data URL
   */
  async _compressScreenshot(dataUrl, maxWidth, quality) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const imageBitmap = await createImageBitmap(blob);

      const scale = imageBitmap.width > maxWidth ? maxWidth / imageBitmap.width : 1;
      const w = Math.round(imageBitmap.width * scale);
      const h = Math.round(imageBitmap.height * scale);

      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, w, h);

      const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return await this._blobToDataUrl(outBlob);
    } catch (e) {
      // Fall back to original if compression fails
      console.warn('[screenshot] Compression failed, using original:', e.message);
      return dataUrl;
    }
  }

  _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Save screenshot to user's Downloads folder via chrome.downloads.
   * Fails silently if the downloads permission isn't granted.
   */
  _saveScreenshotLocally(dataUrl, pageTitle) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = (pageTitle || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    const filename = `browser-agent/screenshots/${ts}_${safe}.jpg`;
    return chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });
  }

  // ============ MAP BUTTONS (Visual element picker) ============

  /**
   * Inject numbered red badges over every visible interactive element,
   * take a screenshot with the overlay visible, remove the visual badges
   * (but keep data-bca-n attrs for pressMappedButton), then return the
   * screenshot + structured button list.
   */
  async mapButtons(tabId) {
    try {
      await chrome.tabs.update(tabId, { active: true });
      await new Promise(r => setTimeout(r, 150));

      // Step 1: Inject badges and collect button metadata
      const injectResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Clean up any previous run
          document.querySelectorAll('[data-bca-n]').forEach(el => el.removeAttribute('data-bca-n'));
          const oldOverlay = document.getElementById('_bca_overlay');
          if (oldOverlay) oldOverlay.remove();

          const SELECTOR = [
            'button:not([disabled])',
            '[role="button"]:not([disabled])',
            'input[type="button"]:not([disabled])',
            'input[type="submit"]:not([disabled])',
            'input[type="reset"]:not([disabled])',
            'a[href]:not([href=""]):not([href^="#"])',
            'input[type="checkbox"]:not([disabled])',
            'input[type="radio"]:not([disabled])',
            'select:not([disabled])'
          ].join(',');

          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const all = [...document.querySelectorAll(SELECTOR)];

          const visible = all.filter(el => {
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) return false;
            if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
            const cs = window.getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') return false;
            if (parseFloat(cs.opacity || '1') < 0.1) return false;
            return true;
          }).slice(0, 30);

          if (visible.length === 0) return [];

          const container = document.createElement('div');
          container.id = '_bca_overlay';
          container.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;overflow:visible';

          const buttons = [];
          visible.forEach((el, i) => {
            const n = i + 1;
            el.setAttribute('data-bca-n', String(n));
            const r = el.getBoundingClientRect();

            // Slim outline box around the element
            const box = document.createElement('div');
            box.style.cssText =
              `position:fixed;left:${r.left}px;top:${r.top}px;` +
              `width:${r.width}px;height:${r.height}px;` +
              'border:2px solid #dc2626;border-radius:3px;box-sizing:border-box;' +
              'pointer-events:none;z-index:2147483646';
            container.appendChild(box);

            // Number badge: outside the box, attached to top-left corner boundary.
            // Badge sits above-left so its bottom-right corner touches the box corner.
            // Red text + red border on transparent background so the box boundary meets it.
            const badge = document.createElement('div');
            badge.textContent = String(n);
            // Measure badge size: assume ~8px per char + 8px padding, 17px tall
            const approxW = Math.max(17, String(n).length * 8 + 8);
            const badgeLeft = Math.max(0, r.left - approxW + 2); // right edge aligns to box left
            const badgeTop  = Math.max(0, r.top - 17 + 2);       // bottom edge aligns to box top
            badge.style.cssText =
              `position:fixed;left:${badgeLeft}px;top:${badgeTop}px;` +
              'background:#fff;color:#dc2626;border:2px solid #dc2626;' +
              'font:700 11px/13px monospace;padding:0 3px;border-radius:2px;' +
              'min-width:16px;text-align:center;' +
              'pointer-events:none;z-index:2147483647;white-space:nowrap';
            container.appendChild(badge);

            const tag = el.tagName.toLowerCase();
            const rawText = (el.textContent || '').trim().replace(/\s+/g, ' ');
            const text = rawText ||
              el.getAttribute('value') ||
              el.getAttribute('placeholder') ||
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              el.getAttribute('name') || '';

            buttons.push({
              n,
              tag,
              type: el.getAttribute('type') || '',
              text: text.slice(0, 80),
              ariaLabel: el.getAttribute('aria-label') || '',
              role: el.getAttribute('role') || tag
            });
          });

          document.documentElement.appendChild(container);
          return buttons;
        },
        world: 'MAIN'
      });

      const buttons = injectResults[0]?.result || [];

      if (buttons.length === 0) {
        return {
          success: true, count: 0, buttons: [], screenshot: null,
          message: 'No interactive buttons found in the current viewport.'
        };
      }

      // Step 2: Screenshot WITH badges visible (allow browser paint)
      await new Promise(r => setTimeout(r, 100));
      const tab = await chrome.tabs.get(tabId);
      const rawDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const compressed = await this._compressScreenshot(rawDataUrl, 1280, 0.75);

      // Step 3: Remove visual overlay (keep data-bca-n attrs for pressMappedButton)
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const ov = document.getElementById('_bca_overlay');
          if (ov) ov.remove();
        },
        world: 'MAIN'
      });

      // Cache button map for this tab
      this._buttonMap.set(tabId, buttons);

      return { success: true, count: buttons.length, buttons, screenshot: compressed };
    } catch (err) {
      return { success: false, error: `map_buttons failed: ${err.message}` };
    }
  }

  /**
   * Click a button by its number from the most recent map_buttons call.
   * Uses trusted debugger click on the element's coordinates.
   * Cleans up data-bca-n attributes after use.
   */
  async pressMappedButton(tabId, n) {
    try {
      if (!n || typeof n !== 'number') {
        return { success: false, error: 'n must be a number (button index from map_buttons)' };
      }

      const map = this._buttonMap.get(tabId);
      if (!map) {
        return { success: false, error: 'No button map for this tab. Call map_buttons first.' };
      }

      const entry = map.find(b => b.n === n);
      if (!entry) {
        return { success: false, error: `Button ${n} not in map. Valid range: 1–${map.length}.` };
      }

      // Get coordinates from content script via data-bca-n attribute
      const coords = await this._sendToContent(tabId, { action: 'get_mapped_button_coords', n });

      // Clean up data attributes regardless of outcome
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          document.querySelectorAll('[data-bca-n]').forEach(e => e.removeAttribute('data-bca-n'));
        },
        world: 'MAIN'
      });

      if (!coords.success) {
        this._buttonMap.delete(tabId);
        return { success: false, error: `Element ${n} no longer in DOM (page may have changed — call map_buttons again)` };
      }

      // Trusted click via CDP at the element's coordinates
      await this.debugger.click(tabId, coords.x, coords.y);

      // Invalidate map — page may change after click
      this._buttonMap.delete(tabId);

      return {
        success: true,
        message: `Button ${n} clicked (trusted): <${coords.tag}> "${coords.text}" at (${coords.x}, ${coords.y})`,
        n, tag: coords.tag, text: coords.text
      };
    } catch (err) {
      return { success: false, error: `press_mapped_button failed: ${err.message}` };
    }
  }

  // ============ WAIT ============

  async wait(seconds, reason) {
    const maxWait = 300; // 5 minute max
    const actualSeconds = Math.min(seconds, maxWait);
    await new Promise(resolve => setTimeout(resolve, actualSeconds * 1000));
    return { success: true, waited: actualSeconds, reason: reason || 'No reason given' };
  }

  // ============ EXECUTE STEPS (Batch Plan Execution) ============

  // Auto-wait durations after certain tools (ms)
  static AUTO_WAITS = {
    navigate: 500,
    click: 100,
    type_text: 50,
    press_key: 50,
    press_mapped_button: 100,
    select_option: 100,
    fill_form: 100,
    go_back: 500,
    go_forward: 500
  };

  // Tools that are NOT allowed inside execute_steps (terminal-level or meta)
  static BLOCKED_STEPS = new Set(['execute_steps', 'task_complete', 'task_failed', 'execute_terminal']);

  // Tools that trigger before/after page snapshot diffing
  static DIFF_TOOLS = new Set([
    'navigate', 'click', 'type_text', 'press_key', 'select_option',
    'fill_form', 'go_back', 'go_forward', 'hover', 'press_mapped_button',
    'scroll', 'execute_javascript'
  ]);

  /**
   * Execute a multi-section plan of tool calls sequentially.
   * Emits progress via context.onProgress(event) callback.
   * Stops on first failure and returns partial results.
   *
   * @param {Array} plan  - [{section, steps: [{tool, args}]}]
   * @param {object} context - {tabId, permissions, onProgress}
   */
  async executeSteps(plan, context) {
    const { onProgress } = context;
    const allResults = [];
    let screenshots = []; // collect screenshot data-urls for the caller

    const emit = (event) => {
      if (typeof onProgress === 'function') {
        try { onProgress(event); } catch {}
      }
    };

    emit({ type: 'plan_start', totalSections: plan.length, plan: plan.map(s => ({ section: s.section, stepCount: s.steps.length })) });

    for (let si = 0; si < plan.length; si++) {
      const section = plan[si];
      emit({ type: 'section_start', sectionIndex: si, section: section.section, stepCount: section.steps.length });

      const sectionResults = [];

      for (let ti = 0; ti < section.steps.length; ti++) {
        const step = section.steps[ti];
        const { tool, args } = step;

        // Safety: block dangerous/recursive tools
        if (ToolExecutor.BLOCKED_STEPS.has(tool)) {
          const err = { success: false, error: `Tool "${tool}" is not allowed inside execute_steps` };
          sectionResults.push({ tool, args, result: err });
          emit({ type: 'step_failed', sectionIndex: si, stepIndex: ti, tool, error: err.error });
          allResults.push({ section: section.section, steps: sectionResults, completed: false });
          return this._buildStepsPlanResult(allResults, plan, si, ti, screenshots);
        }

        emit({ type: 'step_start', sectionIndex: si, stepIndex: ti, tool, args });

        // Execute the tool via the normal execute() pathway
        // The context keeps the same tabId + permissions but we strip onProgress to avoid recursion
        const result = await this.execute(tool, args || {}, {
          tabId: context.tabId,
          permissions: context.permissions
        });

        // Run verification assertions if step has them
        let verifyResult = null;
        if (step.verify && result.success !== false) {
          verifyResult = await this._verifyState(context.tabId, step.verify).catch(() => null);
          if (verifyResult && !verifyResult.allPassed) {
            const failedChecks = (verifyResult.results || []).filter(r => !r.passed);
            const failMsg = failedChecks.map(r => `${r.check}: expected "${r.expected}", got "${r.actual || 'not found'}"`).join('; ');
            result.success = false;
            result.error = `Verification failed: ${failMsg}`;
          }
        }

        sectionResults.push({ tool, args, result, verify: verifyResult });

        // Collect screenshots
        if ((tool === 'screenshot' || tool === 'map_buttons') && result.success && result.screenshot) {
          screenshots.push(result.screenshot);
        }

        // Update tabId if a tab-switching tool was used
        if (tool === 'new_tab' && result.success && result.tabId) {
          context.tabId = result.tabId;
        }
        if (tool === 'switch_tab' && result.success && result.tabId) {
          context.tabId = result.tabId;
        }

        if (!result.success) {
          emit({ type: 'step_failed', sectionIndex: si, stepIndex: ti, tool, error: result.error });
          allResults.push({ section: section.section, steps: sectionResults, completed: false });
          return this._buildStepsPlanResult(allResults, plan, si, ti, screenshots);
        }

        emit({ type: 'step_done', sectionIndex: si, stepIndex: ti, tool, result, verify: verifyResult });

        // Auto-wait after non-diff tools (diff tools already waited inside execute())
        if (!ToolExecutor.DIFF_TOOLS.has(tool)) {
          const autoWait = ToolExecutor.AUTO_WAITS[tool];
          if (autoWait) {
            await new Promise(r => setTimeout(r, autoWait));
          }
        }
      }

      allResults.push({ section: section.section, steps: sectionResults, completed: true });
      emit({ type: 'section_done', sectionIndex: si, section: section.section });
    }

    emit({ type: 'plan_done', sectionsCompleted: allResults.length });

    return {
      success: true,
      message: `Plan completed: ${allResults.length} sections executed`,
      sections: allResults.map(s => ({
        section: s.section,
        completed: s.completed,
        steps: s.steps.map(st => {
          const step = {
            tool: st.tool,
            success: st.result.success,
            message: st.result.message || st.result.error || ''
          };
          if (st.result.pageChanges) step.pageChanges = st.result.pageChanges;
          if (st.verify) step.verify = st.verify;
          return step;
        })
      })),
      screenshots // returned for agent-manager to inject as images
    };
  }

  /**
   * Build the result object for a failed plan (partial execution).
   */
  _buildStepsPlanResult(completedSections, plan, failedSectionIdx, failedStepIdx, screenshots) {
    // Compute remaining sections/steps
    const failedSection = plan[failedSectionIdx];
    const remaining = [];
    // Remaining steps in the failed section
    const remainingStepsInSection = failedSection.steps.slice(failedStepIdx + 1).map(s => s.tool);
    if (remainingStepsInSection.length > 0) {
      remaining.push({ section: failedSection.section, remainingSteps: remainingStepsInSection });
    }
    // Remaining full sections
    for (let i = failedSectionIdx + 1; i < plan.length; i++) {
      remaining.push({ section: plan[i].section, remainingSteps: plan[i].steps.map(s => s.tool) });
    }

    const lastSection = completedSections[completedSections.length - 1];
    const failedStep = lastSection?.steps[lastSection.steps.length - 1];

    return {
      success: false,
      error: `Plan failed at section "${failedSection.section}" step ${failedStepIdx + 1} (${failedStep?.tool}): ${failedStep?.result?.error || 'unknown error'}`,
      sections: completedSections.map(s => ({
        section: s.section,
        completed: s.completed,
        steps: s.steps.map(st => {
          const step = {
            tool: st.tool,
            success: st.result.success,
            message: st.result.message || st.result.error || ''
          };
          if (st.result.pageChanges) step.pageChanges = st.result.pageChanges;
          if (st.verify) step.verify = st.verify;
          return step;
        })
      })),
      remaining,
      screenshots
    };
  }

  // ============ TERMINAL (Native Messaging) ============

  async executeTerminal(command, timeout = 30) {
    try {
      return await this._sendNativeMessage({
        type: 'execute',
        command,
        timeout: timeout * 1000
      });
    } catch (err) {
      return { success: false, error: `Terminal error: ${err.message}` };
    }
  }

  _connectNative() {
    if (this.nativePort) return;

    try {
      this.nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

      this.nativePort.onMessage.addListener((msg) => {
        if (msg.id && this.nativePendingCallbacks.has(msg.id)) {
          const { resolve } = this.nativePendingCallbacks.get(msg.id);
          this.nativePendingCallbacks.delete(msg.id);
          resolve(msg);
        }
      });

      this.nativePort.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || 'Native host disconnected';
        for (const [id, { reject }] of this.nativePendingCallbacks) {
          reject(new Error(error));
        }
        this.nativePendingCallbacks.clear();
        this.nativePort = null;
      });
    } catch (err) {
      this.nativePort = null;
      throw new Error(`Failed to connect native host: ${err.message}. Make sure the native host is installed.`);
    }
  }

  _sendNativeMessage(message) {
    return new Promise((resolve, reject) => {
      this._connectNative();
      const id = ++this.nativeMessageId;
      message.id = id;
      this.nativePendingCallbacks.set(id, { resolve, reject });
      this.nativePort.postMessage(message);

      // Timeout
      setTimeout(() => {
        if (this.nativePendingCallbacks.has(id)) {
          this.nativePendingCallbacks.delete(id);
          reject(new Error('Native message timeout'));
        }
      }, (message.timeout || 30000) + 5000);
    });
  }

  // ============ HELPERS ============

  async _sendToContent(tabId, message) {
    try {
      // Ensure content script is injected
      await this._ensureContentScript(tabId);
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response || { success: false, error: 'No response from content script' };
    } catch (err) {
      // Try injecting content script and retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/content.js']
        });
        const response = await chrome.tabs.sendMessage(tabId, message);
        return response || { success: false, error: 'No response from content script' };
      } catch (retryErr) {
        return { success: false, error: `Content script error: ${retryErr.message}` };
      }
    }
  }

  async _ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
    }
  }

  // ============ PAGE SNAPSHOT & DIFF ============

  async _snapPage(tabId) {
    return await this._sendToContent(tabId, { action: 'page_snapshot' });
  }

  _diffSnapshots(before, after) {
    if (!before?.success || !after?.success) return null;

    const changes = {};

    // URL change
    if (before.url !== after.url) {
      changes.url = { from: before.url, to: after.url };
    }

    // Title change
    if (before.title !== after.title) {
      changes.title = { from: before.title, to: after.title };
    }

    // Compare notable elements by selector key
    const beforeMap = new Map();
    for (const el of (before.notableElements || [])) {
      beforeMap.set(el.selector, el);
    }
    const afterMap = new Map();
    for (const el of (after.notableElements || [])) {
      afterMap.set(el.selector, el);
    }

    // Elements that appeared (in after but not before)
    const appeared = [];
    for (const [sel, el] of afterMap) {
      if (!beforeMap.has(sel)) {
        appeared.push({ selector: sel, tag: el.tag, role: el.role, text: el.text });
      }
    }

    // Elements that disappeared (in before but not after)
    const disappeared = [];
    for (const [sel, el] of beforeMap) {
      if (!afterMap.has(sel)) {
        disappeared.push({ selector: sel, tag: el.tag, role: el.role, text: el.text });
      }
    }

    if (appeared.length) changes.appeared = appeared;
    if (disappeared.length) changes.disappeared = disappeared;

    // Return null if nothing changed
    return Object.keys(changes).length > 0 ? changes : null;
  }

  // ============ VERIFY STATE (assertions) ============

  async _verifyState(tabId, checks) {
    return await this._sendToContent(tabId, { action: 'verify_state', checks });
  }

  _waitForTabLoad(tabId, timeout = 15000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeout);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          // Extra delay for JS rendering
          setTimeout(resolve, 500);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }
}
