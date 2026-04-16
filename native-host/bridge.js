#!/usr/bin/env node
// Native Messaging Host - Bridge between Chrome extension and local terminal
// Protocol: 4-byte length prefix (little-endian uint32) + JSON message

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

// ============ NATIVE MESSAGING I/O ============

function readMessage() {
  return new Promise((resolve, reject) => {
    // Read 4-byte length header
    let lengthBuf = Buffer.alloc(0);

    function readLength() {
      const chunk = process.stdin.read(4 - lengthBuf.length);
      if (!chunk) {
        process.stdin.once('readable', readLength);
        return;
      }
      lengthBuf = Buffer.concat([lengthBuf, chunk]);
      if (lengthBuf.length < 4) {
        process.stdin.once('readable', readLength);
        return;
      }

      const messageLength = lengthBuf.readUInt32LE(0);
      if (messageLength === 0) {
        resolve(null);
        return;
      }
      if (messageLength > 1024 * 1024) {
        reject(new Error('Message too large'));
        return;
      }

      // Read message body
      let messageBuf = Buffer.alloc(0);

      function readBody() {
        const remaining = messageLength - messageBuf.length;
        const bodyChunk = process.stdin.read(remaining);
        if (!bodyChunk) {
          process.stdin.once('readable', readBody);
          return;
        }
        messageBuf = Buffer.concat([messageBuf, bodyChunk]);
        if (messageBuf.length < messageLength) {
          process.stdin.once('readable', readBody);
          return;
        }

        try {
          const message = JSON.parse(messageBuf.toString('utf8'));
          resolve(message);
        } catch (e) {
          reject(new Error('Invalid JSON message'));
        }
      }

      readBody();
    }

    readLength();
  });
}

function sendMessage(message) {
  const json = JSON.stringify(message);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// ============ COMMAND EXECUTION ============

function executeCommand(command, timeout = 30000) {
  return new Promise((resolve) => {
    const isWindows = os.platform() === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellFlag = isWindows ? '/c' : '-c';

    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(shell, [shellFlag, command], {
      cwd: os.homedir(),
      env: { ...process.env },
      timeout,
      windowsHide: true
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Limit output size
      if (stdout.length > 100000) {
        stdout = stdout.substring(0, 100000) + '\n... (output truncated)';
        proc.kill();
        killed = true;
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 50000) {
        stderr = stderr.substring(0, 50000) + '\n... (output truncated)';
      }
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        killed
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        killed: false
      });
    });

    // Timeout
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill();
        killed = true;
      }
    }, timeout);
  });
}

// ============ MAIN LOOP ============

async function main() {
  // Keep reading messages
  while (true) {
    try {
      const message = await readMessage();
      if (!message) break;

      let response = { id: message.id, success: false, error: 'Unknown command' };

      switch (message.type) {
        case 'execute':
          const result = await executeCommand(message.command, message.timeout || 30000);
          response = { id: message.id, ...result };
          break;
        case 'ping':
          response = { id: message.id, success: true, pong: true };
          break;
        default:
          response = { id: message.id, success: false, error: `Unknown type: ${message.type}` };
      }

      sendMessage(response);
    } catch (err) {
      sendMessage({ success: false, error: err.message });
    }
  }
}

main().catch(err => {
  sendMessage({ success: false, error: err.message });
  process.exit(1);
});
