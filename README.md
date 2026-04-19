# BrowserClaw: Browser Automation for Local LLM (future)

> Enterprise-grade AI-powered browser automation with skills, scheduling, and multi-agent orchestration.

**Important:** this is project is not for openclaw. and is also not affliated with openclaw.com .

this is stand alone automation for future local llm in browser. meanign simple step for clean automation without big heasle. gemma4 or current local llm doesnt peform very well. i have used minimax 2.5  2.7 but it still sufferes in some tasks claude haiku 4.5 performs better but it burns token like crazy. 

openclaw is the  best name i could thought of and easy PR like you are reading this 😛. if you gave star it will make my day.

A Chrome extension (Manifest V3) that brings **intelligent browser automation** to life. Supports **Ollama** (local LLMs) and **OpenRouter** (cloud APIs) with advanced features:
- **Deterministic skill scripts** — JSON-based automation that runs reliably without AI per-step
- **Task scheduling** — Run skills on a schedule (once, hourly, daily, weekly, custom intervals)
- **Multi-agent orchestration** — Concurrent, independent agents controlling separate tabs
- **Batch execution** — Run complex workflows in single AI calls (execute_steps)
- **Streaming UI** — Real-time chat with agent thinking and action visibility
- **Permission-based control** — Fine-grained security for terminal, screenshots, navigation, etc.

---

## Key Features

### 🤖 Skill System (New!)
- **JSON skill scripts** — Define automated workflows with action steps, AI reasoning steps, and conditional branching
- **Template resolution** — Use `{{input.X}}` and `{{var.Y}}` to compose dynamic workflows
- **No per-step AI calls** — Action steps (click, type, navigate) execute directly; only true reasoning steps invoke the model
- **Condition branching** — Skip/repeat steps based on variable checks
- **Input parameterization** — Skills accept user inputs (text, URL, number, select)

### ⏰ Task Scheduling
- **Multiple recurrence patterns:**
  - `once` — Single run at specified time
  - `hourly` — Every hour at specified minute
  - `daily` — Same time every day
  - `weekdays` — Monday–Friday at specified time
  - `weekly` — Specific day of week at specified time
  - `custom` — Arbitrary intervals (every N minutes/hours/days/weeks)
- **Automatic execution** — Chrome alarms trigger scheduled skill runs
- **Missed run tracking** — Log and handle tasks that missed their window
- **Persistent schedule storage** — Schedules survive browser restart

### 🎯 Multi-Agent Architecture
- **Independent agents** — Each task/skill run gets its own isolated agent, tab, and state
- **Concurrent execution** — Multiple skills can run simultaneously without interfering
- **Shared AI provider** — All agents use the same configured model/provider
- **Rich conversation history** — Full chat logs per agent for debugging and continuation

### 🚀 Advanced Browser Automation
**Navigation & Tabs:**
- `navigate` — Load any URL
- `go_back`, `go_forward` — Browser history
- `new_tab`, `close_tab`, `switch_tab`, `list_tabs` — Tab management

**Element & Page Interaction:**
- `click` — Trusted mouse clicks (works on React, Lexical editors, shadow DOM)
- `type_text` — Type into inputs/textareas/contenteditable (trusted keyboard)
- `fill_form` — Batch fill multiple inputs + click submit
- `press_key` — Keyboard events (Enter, Tab, Escape, Backspace, arrows)
- `hover`, `select_option`, `press_mapped_button`

**Page Inspection:**
- `screenshot` — Visual page capture for AI analysis
- `extract_content` — Clean markdown of main page content
- `extract_all_text` — All visible text (headers, nav, footer, etc.)
- `get_page_info` — URL, title, scroll position, viewport size
- `find_elements` — CSS or text-based element discovery
- `find_clickable` — Auto-locate buttons, links, inputs
- `map_buttons` — Visual numbered overlay of interactive elements

**Workflow Control:**
- `execute_steps` — **Batch multi-step plans in one call** (FAST PATH)
- `wait`, `wait_for_element` — Synchronization
- `scroll`, `execute_javascript` — Advanced page manipulation
- `execute_terminal` — Shell commands (if permission granted)
- `task_complete`, `task_failed` — End task with summary/error

### 💬 Real-Time Streaming Chat
- **Live agent output** — See thinking, tool calls, and results as they happen
- **Inline media** — Screenshots embedded in conversation
- **Mid-task steering** — Send messages to redirect agents mid-run
- **Full history** — Chat logs with timestamps and structured tool metadata

### 📊 Dashboard
- **Task grid view** — Overview of all tasks (active, completed, failed)
- **Task detail view** — Full chat + editor when you click a task
- **Skill management** — Create, edit, view, and run skills
- **Settings UI** — Configure Ollama URL, OpenRouter API key, model selection
- **Model picker** — Browse all available Ollama/OpenRouter models
- **Reasoning effort** — Select reasoning level (low/medium/high) for models that support it

### 🔒 Permission System
- **Per-task permissions** — Grant/deny terminal access, screenshots, navigation before running
- **Tool filtering** — Only available tools are exposed to the agent
- **Audit trail** — All tool calls and permissions logged

---

## Installation

### 1. Load the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select this folder
4. Note the **Extension ID** shown below the extension name

### 2. Configure AI Provider

1. Click the extension icon in the toolbar → **Open Dashboard**
2. Click **Settings** (gear icon)
3. For **Ollama**: Enter the base URL (default: `http://localhost:11434`)
   - Make sure Ollama is running: `ollama serve`
   - [Install Ollama](https://ollama.ai)
4. For **OpenRouter**: Enter your API key from [openrouter.ai](https://openrouter.ai)

### 3. Terminal Support (Optional)

To enable `execute_terminal` for shell commands:

1. Open the `native-host/` folder
2. Edit `com.browser_control.agent.json` — replace `chrome-extension://*/` with your extension ID:
   ```json
   "allowed_origins": [
     "chrome-extension://YOUR_EXTENSION_ID_HERE/"
   ]
   ```
3. Run `install.bat` as Administrator
4. Ensure **Node.js** is installed and in PATH
5. Restart Chrome

---

## Usage Guide

### Running a Free-Form Task

1. **Open Dashboard** → Click extension icon → **Open Dashboard** (or go to extension's options page)
2. **New Task** → Select provider, model, reasoning effort
3. **Describe task** — Type your goal in natural language
4. **Set permissions** — Choose which capabilities the agent needs
5. **Create & Start** — Agent runs in real-time with live updates
6. **Steer agents** — Send messages mid-task to redirect ("click the blue button", "stop and summarize", etc.)

### Creating & Running Skills

**Create a skill:**
1. Dashboard → **Skill Editor**
2. Define inputs (e.g., search topic, number of results)
3. Build steps:
   - **Action steps** — `click`, `type_text`, `navigate`, etc. (run directly, no AI)
   - **AI steps** — Reasoning prompts that invoke the model
   - **Condition steps** — Branch on variable checks
4. Use templates: `{{input.topic}}`, `{{var.headlines}}`
5. **Save**

**Run a skill:**
1. Dashboard → **Skills** → Click skill
2. Enter inputs in the form
3. Configure agent (provider, model, permissions)
4. **Run Skill** — Watch deterministic steps execute with AI at strategic points

### Scheduling Skills

1. Dashboard → **Schedules**
2. **New Schedule**
   - Select skill
   - Set recurrence (daily at 9 AM, every 2 hours, Monday–Friday, etc.)
   - Configure inputs (use defaults or override per run)
3. **Enable** — Chrome will run the skill automatically
4. View **Missed runs** and **Next run** timestamp

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Dashboard (UI)                             │
│  - Task grid/detail view                                        │
│  - Chat interface                                               │
│  - Skill editor                                                 │
│  - Settings                                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ chrome.tabs.sendMessage
                             ↓
        ┌────────────────────────────────────────────┐
        │      Service Worker (Background)           │
        │  ┌──────────────────────────────────────┐  │
        │  │ AgentManager                         │  │
        │  │ - Orchestrates concurrent agents    │  │
        │  │ - Manages conversation loops        │  │
        │  ├──────────────────────────────────────┤  │
        │  │ SkillExecutor                        │  │
        │  │ - Runs JSON skill scripts            │  │
        │  │ - Template resolution                │  │
        │  │ - Conditional branching              │  │
        │  ├──────────────────────────────────────┤  │
        │  │ SkillsManager                        │  │
        │  │ - Loads, saves, validates skills    │  │
        │  ├──────────────────────────────────────┤  │
        │  │ ScheduleManager                      │  │
        │  │ - Computes next run times            │  │
        │  │ - Integrates with chrome.alarms      │  │
        │  ├──────────────────────────────────────┤  │
        │  │ ToolExecutor                         │  │
        │  │ - Executes browser tools             │  │
        │  │ - Calls chrome.tabs, content script  │  │
        │  ├──────────────────────────────────────┤  │
        │  │ AIProvider                           │  │
        │  │ - Ollama / OpenRouter clients        │  │
        │  │ - Streaming LLM calls                │  │
        │  ├──────────────────────────────────────┤  │
        │  │ ImageStore                           │  │
        │  │ - Screenshot caching                 │  │
        │  └──────────────────────────────────────┘  │
        └────────────────────────────────────────────┘
                │                      │
                ├─ chrome.tabs API ────┤
                ├─ chrome.storage ─────┤
                ├─ chrome.alarms ──────┤
                └─ native messaging ───┘
                        │
        ┌───────────────┼────────────────────────┐
        ↓               ↓                        ↓
   Content Script   AI Provider API         Native Host
   (Per-tab)        (Ollama/OpenRouter)      (Terminal)
```

### Key Files

```
manifest.json              — Chrome extension manifest (MV3)
                              Permissions: tabs, storage, nativeMessaging, debugger, etc.

background/
  service-worker.js        — Main extension worker. Message routing, scheduler setup
  agent-manager.js         — AgentManager: concurrent agent orchestration + event loop
  skill-executor.js        — SkillExecutor: runs JSON skill scripts deterministically
  skill-format.js          — Skill validation, template resolution, step type definitions
  skills-manager.js        — SkillsManager: CRUD for skills (load/save/validate)
  schedule-manager.js      — ScheduleManager: schedule computation, chrome.alarms integration
  tool-executor.js         — ToolExecutor: executes individual tools (click, type, etc.)
  tools-definition.js      — TOOLS array: OpenAI function-calling format definitions
  ai-provider.js           — AIProvider: Ollama + OpenRouter streaming chat clients
  image-store.js           — ImageStore: screenshot caching + UUID generation
  debugger-controller.js   — DebuggerController: CDP (Chrome DevTools Protocol) integration

content/
  content.js               — Content script (injected into every page). Handles click, type,
                              extract_content, find_elements, execute_javascript via CDP
                              
dashboard/
  dashboard.html           — Main extension UI (options page)
  dashboard.js             — Task grid/detail view, chat, skill editor, settings controller
  dashboard.css            — Styling
  skill-diagram.js         — Visual skill workflow renderer

popup/
  popup.html               — Quick access menu
  popup.js                 — Popup logic

native-host/
  bridge.js                — Node.js bridge for terminal execution
  bridge.bat               — Windows batch launcher
  com.browser_control.agent.json  — Native messaging host manifest
  install.bat              — Registers native host on Windows

icons/
  icon16.png, icon48.png, icon128.png  — Extension icons
```

### Message Flow

**UI → Service Worker:**
```javascript
// From dashboard, send a message to create a task
chrome.runtime.sendMessage({
  type: 'createTask',
  taskData: { goal, provider, model, permissions, ... }
})
```

**Service Worker → Content Script:**
```javascript
// Tool executor calls content script for page interaction
chrome.tabs.sendMessage(tabId, {
  type: 'executeTool',
  tool: 'click',
  args: { selector: '.button' }
})
```

**Service Worker → AI Provider:**
```javascript
// Agent's message loop streams from Ollama/OpenRouter
const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages, tools, model, stream: true })
})
// Stream tokens and tool calls in real-time
```

---

## Skill Script Example

See [how-skill-works.md](how-skill-works.md) for full specification.
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
