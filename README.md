# BrowserClaw

> AI-powered browser automation as a Chrome extension.

A Chrome extension (Manifest V3) that uses AI to automate browser tasks. Supports **Ollama** (local) and **OpenRouter** (cloud) models with streaming, multi-tab control, tool calling, and terminal access.

## Features

- **Multi-tab AI agents** — Each task controls its own browser tab independently
- **Ollama & OpenRouter support** — Use local models or cloud APIs, all available models listed
- **Full browser automation toolkit:**
  - Navigate, click, type, fill forms, press keys, hover
  - Take screenshots with visual AI analysis
  - Extract page content as clean markdown
  - Find interactive elements automatically
  - Scroll, wait, poll for changes
  - Open/close/switch between tabs
- **Terminal access** — Execute shell commands via native messaging bridge
- **Streaming chat UI** — Watch the agent think and act in real-time
- **Task dashboard** — Grid of task cards, click to expand into full chat view
- **Steer agents** — Add messages mid-task to redirect the AI
- **Permission control** — Grant/deny capabilities (terminal, screenshots, navigation, etc.) before each task

## Installation

### 1. Load the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select this folder
4. Note the **Extension ID** shown below the extension name

### 2. Configure AI Provider

1. Click the extension icon in the toolbar → **Open Dashboard**
2. Click **Settings** (gear icon)
3. For **Ollama**: Enter the base URL (default: `http://localhost:11434`). Make sure Ollama is running.
4. For **OpenRouter**: Enter your API key from [openrouter.ai](https://openrouter.ai)

### 3. Terminal Support (Optional)

To enable terminal/shell command execution:

1. Open the `native-host/` folder
2. Edit `com.browser_control.agent.json`:
   - Replace `chrome-extension://*/` with your actual extension ID:
     ```json
     "allowed_origins": [
       "chrome-extension://YOUR_EXTENSION_ID_HERE/"
     ]
     ```
3. Run `install.bat` as Administrator
4. Make sure **Node.js** is installed and available in PATH
5. Restart Chrome

## Usage

### Creating a Task

1. Open the dashboard (click extension icon → Open Dashboard, or go to the extension's options page)
2. Click **New Task**
3. Select AI provider and model
4. Describe what you want the agent to do
5. Set permissions (terminal, screenshots, navigation, etc.)
6. Click **Create & Start Task**

### During a Task

- Watch the agent's thinking and actions stream in real-time
- Tool calls are shown with their arguments and results
- Screenshots are displayed inline
- **Send messages** to steer the agent ("now click the buy button", "stop and summarize what you found", etc.)
- **Stop** the task at any time

### After a Task

- Chat with the agent about what it did
- The full conversation history is preserved
- Restart by sending a new message

## Architecture

```
Dashboard UI ←port→ Service Worker ←fetch/stream→ AI Provider (Ollama/OpenRouter)
                          ├→ chrome.tabs API (navigate, screenshot, create)
                          ├→ Content Script (click, type, extract, scroll)
                          └→ Native Messaging Host (terminal commands)
```

### Files

```
manifest.json              — Chrome extension manifest (MV3)
background/
  service-worker.js        — Main orchestration hub
  agent-manager.js         — Multi-agent lifecycle management
  ai-provider.js           — Ollama & OpenRouter API with streaming
  tool-executor.js         — Browser automation tool execution
  tools-definition.js      — Tool schemas (OpenAI function calling format)
content/
  content.js               — DOM interaction & content extraction
dashboard/
  dashboard.html/css/js    — Full task management dashboard
popup/
  popup.html/js            — Quick-access popup
native-host/
  bridge.js                — Node.js native messaging host
  bridge.bat               — Windows launcher
  install.bat              — Registry installer
  com.browser_control.agent.json — Native host manifest
icons/
  icon16/48/128.png        — Extension icons
```

## Supported Tools

| Tool | Description |
|------|-------------|
| `navigate` | Navigate to a URL |
| `click` | Click elements by CSS selector |
| `type_text` | Type into input fields |
| `press_key` | Press keyboard keys |
| `screenshot` | Capture page screenshot |
| `extract_content` | Get page content as markdown |
| `extract_all_text` | Get all visible text |
| `find_elements` | Find elements by selector |
| `find_clickable` | Discover interactive elements |
| `scroll` | Scroll page up/down/top/bottom |
| `wait` | Timed delay (up to 5 min) |
| `wait_for_element` | Wait for element to appear |
| `fill_form` | Fill multiple form fields |
| `select_option` | Select dropdown option |
| `hover` | Hover over element |
| `new_tab` / `close_tab` / `switch_tab` / `list_tabs` | Tab management |
| `go_back` / `go_forward` | Browser history navigation |
| `execute_javascript` | Run JS in page context |
| `execute_terminal` | Run shell commands (needs permission) |
| `get_page_info` | Get URL, title, dimensions |
| `task_complete` / `task_failed` | Mark task status |

## Requirements

- Chrome 110+ (Manifest V3 support)
- Ollama running locally, OR an OpenRouter API key
- Node.js (only for terminal bridge feature)
