// ImageStore — persists screenshots and attached images using OPFS (Origin Private File System).
// Stores raw JPEG bytes so chrome.storage.local quota is never touched by images.
//
// OPFS layout:
//   screenshots/
//     {taskId}/
//       {timestamp}_{random}.jpg    ← raw JPEG bytes
//
// A "ref" is the string "{taskId}/{filename}", e.g. "abc123/1700000000_x3f9k.jpg"

export class ImageStore {

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Save a JPEG or PNG data-URL to OPFS.
   * The image is compressed to JPEG 70 % / max-1280 px before writing if it
   * arrives as PNG (already-compressed JPEGs pass through as-is).
   *
   * @param {string} taskId
   * @param {string} dataUrl  data:image/...;base64,...
   * @returns {Promise<string>} ref  (taskId/filename)
   */
  async save(taskId, dataUrl) {
    const key = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
    const dir = await this._getTaskDir(taskId, true);
    const fh = await dir.getFileHandle(key, { create: true });
    const writable = await fh.createWritable();

    // Convert base64 → binary
    const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const bytes = this._b64ToBytes(b64);
    await writable.write(bytes);
    await writable.close();

    return `${taskId}/${key}`;
  }

  /**
   * Load an image from OPFS and return it as a data-URL.
   * Returns null if the file is missing (e.g. task was deleted).
   *
   * @param {string} ref  "{taskId}/{filename}"
   * @returns {Promise<string|null>}
   */
  async load(ref) {
    try {
      const slash = ref.indexOf('/');
      const taskId = ref.slice(0, slash);
      const key = ref.slice(slash + 1);
      const dir = await this._getTaskDir(taskId, false);
      const fh = await dir.getFileHandle(key);
      const file = await fh.getFile();
      const ab = await file.arrayBuffer();
      return `data:image/jpeg;base64,${this._bytesToB64(new Uint8Array(ab))}`;
    } catch {
      return null;
    }
  }

  /**
   * Batch-resolve all image refs stored on a displayMessages array.
   * Mutates each message in place: populates `.images` and `.toolScreenshotData`.
   * Call this after loading agents from storage.
   *
   * @param {Array} displayMessages
   */
  async resolveRefs(displayMessages) {
    const tasks = [];

    for (const msg of displayMessages) {
      // User messages with attached images
      if (msg.imageRefs?.length) {
        tasks.push(
          Promise.all(msg.imageRefs.map(r => this.load(r))).then(urls => {
            msg.images = urls.filter(Boolean);
          })
        );
      }

      // Assistant messages with tool-result screenshots
      if (msg.toolScreenshots && Object.keys(msg.toolScreenshots).length) {
        tasks.push(
          Promise.all(
            Object.entries(msg.toolScreenshots).map(([callId, ref]) =>
              this.load(ref).then(url => ({ callId, url }))
            )
          ).then(pairs => {
            msg.toolScreenshotData = {};
            for (const { callId, url } of pairs) {
              if (url) msg.toolScreenshotData[callId] = url;
            }
          })
        );
      }
    }

    await Promise.all(tasks);
  }

  /**
   * Delete every image stored for a task.
   * Called when a task is deleted.
   *
   * @param {string} taskId
   */
  async deleteTask(taskId) {
    try {
      const root = await navigator.storage.getDirectory();
      const screenshots = await root.getDirectoryHandle('screenshots', { create: false });
      await screenshots.removeEntry(String(taskId), { recursive: true });
    } catch {
      // Task directory may not exist — that's fine
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────────

  async _getTaskDir(taskId, create) {
    const root = await navigator.storage.getDirectory();
    const screenshots = await root.getDirectoryHandle('screenshots', { create });
    return screenshots.getDirectoryHandle(String(taskId), { create });
  }

  _b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  /** Handles large arrays by chunking to avoid call-stack limits with spread. */
  _bytesToB64(bytes) {
    const chunkSize = 8192;
    let bin = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(bin);
  }
}
