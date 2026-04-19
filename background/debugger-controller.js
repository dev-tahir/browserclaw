// Debugger Controller - Sends trusted input events via Chrome DevTools Protocol
// Uses chrome.debugger API to dispatch real mouse/keyboard events that pass isTrusted checks

export class DebuggerController {
  constructor() {
    this._attached = new Set(); // Set of tabIds currently attached
  }

  // ============ ATTACH / DETACH ============

  async attach(tabId) {
    if (this._attached.has(tabId)) return;
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      this._attached.add(tabId);
    } catch (err) {
      // Already attached by another extension or same session
      if (err.message?.includes('Already attached')) {
        this._attached.add(tabId);
      } else {
        throw err;
      }
    }
  }

  async detach(tabId) {
    if (!this._attached.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Ignore — tab may be gone
    }
    this._attached.delete(tabId);
  }

  async _ensureAttached(tabId) {
    await this.attach(tabId);
  }

  // ============ MOUSE EVENTS (TRUSTED) ============

  /**
   * Perform a trusted click at the given page coordinates.
   * @param {number} tabId
   * @param {number} x  CSS-pixel x (relative to viewport)
   * @param {number} y  CSS-pixel y (relative to viewport)
   * @param {object} [opts]
   * @param {string} [opts.button='left']  'left' | 'right' | 'middle'
   * @param {number} [opts.clickCount=1]
   */
  async click(tabId, x, y, opts = {}) {
    await this._ensureAttached(tabId);
    const button = opts.button || 'left';
    const clickCount = opts.clickCount || 1;

    // Move mouse to position first (triggers hover/enter events)
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x, y,
      button: 'none'
    });

    // Small delay so hover/focus handlers settle
    await this._delay(50);

    // Press
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y,
      button,
      clickCount,
      buttons: 1
    });

    // Release
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y,
      button,
      clickCount,
      buttons: 0
    });
  }

  /**
   * Double-click at given coordinates.
   */
  async doubleClick(tabId, x, y) {
    await this._ensureAttached(tabId);

    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none'
    });
    await this._delay(30);

    // First click
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1
    });
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0
    });

    await this._delay(30);

    // Second click (clickCount=2)
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 2, buttons: 1
    });
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 2, buttons: 0
    });
  }

  /**
   * Right-click at given coordinates (triggers contextmenu event).
   */
  async rightClick(tabId, x, y) {
    await this._ensureAttached(tabId);

    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none'
    });
    await this._delay(30);
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'right', clickCount: 1, buttons: 2
    });
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'right', clickCount: 1, buttons: 0
    });
  }

  /**
   * Drag from (fromX, fromY) to (toX, toY) with smooth intermediate steps.
   * Holds the left mouse button down throughout the move.
   * @param {number} steps  Number of intermediate mouseMoved events (default 20)
   */
  async drag(tabId, fromX, fromY, toX, toY, steps = 20) {
    await this._ensureAttached(tabId);

    // Move to start without pressing
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: fromX, y: fromY, button: 'none'
    });
    await this._delay(40);

    // Press and hold
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1, buttons: 1
    });
    await this._delay(30);

    // Smooth move along path
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ix = Math.round(fromX + (toX - fromX) * t);
      const iy = Math.round(fromY + (toY - fromY) * t);
      await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: ix, y: iy, button: 'left', buttons: 1
      });
      await this._delay(8);
    }

    // Release
    await this._sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1, buttons: 0
    });
  }

  // ============ KEYBOARD EVENTS (TRUSTED) ============

  /**
   * Type a string of text character-by-character using trusted key events.
   * Works on whatever element currently has focus.
   * @param {number} tabId
   * @param {string} text
   */
  async typeText(tabId, text) {
    await this._ensureAttached(tabId);

    // Use Input.insertText for bulk insertion — fast and reliable
    await this._sendCommand(tabId, 'Input.insertText', { text });
  }

  /**
   * Type text character-by-character with key events (slower but more realistic).
   * Useful if insertText doesn't trigger the app's event handlers.
   */
  async typeTextCharByChar(tabId, text) {
    await this._ensureAttached(tabId);
    for (const char of text) {
      await this._sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        unmodifiedText: char,
        key: char
      });
      await this._sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        text: char,
        unmodifiedText: char,
        key: char
      });
      // Small delay between chars for realism
      await this._delay(10);
    }
  }

  /**
   * Press a special key (Enter, Tab, Escape, Backspace, etc.).
   * @param {number} tabId
   * @param {string} key  DOM key value, e.g. 'Enter', 'Tab', 'Escape'
   * @param {object} [modifiers]  { ctrl, alt, shift, meta }
   */
  async pressKey(tabId, key, modifiers = {}) {
    await this._ensureAttached(tabId);

    const keyDef = KEY_DEFINITIONS[key] || { key, code: key };
    const modifierFlags =
      (modifiers.alt ? 1 : 0) |
      (modifiers.ctrl ? 2 : 0) |
      (modifiers.meta ? 4 : 0) |
      (modifiers.shift ? 8 : 0);

    const baseEvent = {
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode || 0,
      nativeVirtualKeyCode: keyDef.keyCode || 0,
      modifiers: modifierFlags
    };

    // keyDown
    await this._sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: keyDef.text ? 'keyDown' : 'rawKeyDown',
      ...baseEvent,
      text: keyDef.text || '',
      unmodifiedText: keyDef.text || ''
    });

    // char event (only if the key produces a character)
    if (keyDef.text) {
      await this._sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'char',
        ...baseEvent,
        text: keyDef.text,
        unmodifiedText: keyDef.text
      });
    }

    // keyUp
    await this._sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...baseEvent,
      text: '',
      unmodifiedText: ''
    });
  }

  /**
   * Select all text in the currently focused element (Ctrl+A / Cmd+A).
   */
  async selectAll(tabId) {    await this._ensureAttached(tabId);
    // Send Ctrl+A directly with correct key codes so Chrome recognises this as a
    // control combination and does NOT insert the character 'a'.
    const params = {
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2, // Ctrl
      text: '',
      unmodifiedText: ''
    };
    await this._sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await this._sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',     ...params });
  }

  /**
   * Delete selected content via Backspace.
   */
  async clearField(tabId) {
    await this.selectAll(tabId);
    await this._delay(50);
    await this.pressKey(tabId, 'Backspace');
  }

  /**
   * Paste clipboard contents into the currently focused element (Ctrl+V).
   * Requires the OS clipboard to already contain the content to paste.
   */
  async pasteFromClipboard(tabId) {
    await this._ensureAttached(tabId);
    const params = {
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
      modifiers: 2, // Ctrl
      text: '',
      unmodifiedText: ''
    };
    await this._sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await this._sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',     ...params });
  }

  // ============ INTERNAL HELPERS ============

  async _sendCommand(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ============ KEY DEFINITIONS ============
// Maps DOM key names → CDP key event parameters

const KEY_DEFINITIONS = {
  'Enter':      { key: 'Enter',     code: 'Enter',       keyCode: 13, text: '\r' },
  'Tab':        { key: 'Tab',       code: 'Tab',         keyCode: 9 },
  'Escape':     { key: 'Escape',    code: 'Escape',      keyCode: 27 },
  'Backspace':  { key: 'Backspace', code: 'Backspace',   keyCode: 8 },
  'Delete':     { key: 'Delete',    code: 'Delete',      keyCode: 46 },
  'Space':      { key: ' ',         code: 'Space',       keyCode: 32, text: ' ' },
  'ArrowUp':    { key: 'ArrowUp',   code: 'ArrowUp',     keyCode: 38 },
  'ArrowDown':  { key: 'ArrowDown', code: 'ArrowDown',   keyCode: 40 },
  'ArrowLeft':  { key: 'ArrowLeft', code: 'ArrowLeft',   keyCode: 37 },
  'ArrowRight': { key: 'ArrowRight',code: 'ArrowRight',  keyCode: 39 },
  'Home':       { key: 'Home',      code: 'Home',        keyCode: 36 },
  'End':        { key: 'End',       code: 'End',         keyCode: 35 },
  'PageUp':     { key: 'PageUp',    code: 'PageUp',      keyCode: 33 },
  'PageDown':   { key: 'PageDown',  code: 'PageDown',    keyCode: 34 },
  'a':          { key: 'a',         code: 'KeyA',        keyCode: 65, text: 'a' },
  'c':          { key: 'c',         code: 'KeyC',        keyCode: 67, text: 'c' },
  'v':          { key: 'v',         code: 'KeyV',        keyCode: 86, text: 'v' },
  'x':          { key: 'x',         code: 'KeyX',        keyCode: 88, text: 'x' },
};

// Listen for tab closure to clean up attached debuggers
chrome.tabs.onRemoved.addListener((tabId) => {
  // DebuggerController instances are per-ToolExecutor, so we rely on
  // the instance's _attached set. This global listener is a safety net.
});
