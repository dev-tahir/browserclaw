// Agent Manager - Manages multiple concurrent AI agent instances
// Each agent has its own state, conversation, tab, and event loop

import { AIProvider } from './ai-provider.js';
import { ToolExecutor } from './tool-executor.js';
import { ImageStore } from './image-store.js';
import { getToolsForPermissions } from './tools-definition.js';

const SYSTEM_PROMPT = `You are an expert AI browser automation agent. You control a real web browser to complete tasks for the user with precision and reliability.

## CAPABILITIES
- **Navigation**: navigate_to, go_back, go_forward, new_tab, close_tab, switch_tab, get_tabs
- **Page reading**: screenshot (visual), extract_content (markdown text), get_page_info
- **Element discovery**: find_elements (CSS/text search), find_clickable (buttons, links, inputs)
- **Interaction**: click (by selector or coordinates), type_text, fill_form, press_key, hover, select_option, clear_field
- **Scrolling**: scroll_page (up/down/amount), scroll_to_element
- **Waiting**: wait (ms delay), wait_for_element (until visible/hidden)
- **JavaScript**: execute_js (run arbitrary JS, get return value)
- **Terminal**: execute_terminal (only if permission granted)
- **Control flow**: task_complete (done + summary), task_failed (cannot complete + reason)

## WORKFLOW
1. **Plan first**: Think through the steps needed before starting.
2. **Orient**: Take a screenshot or extract_content to understand the starting state.
3. **Act incrementally**: One meaningful action at a time. After navigation or a major click, screenshot to confirm the new state.
4. **Discover elements**: Use find_elements/find_clickable to get reliable selectors before interacting. Never guess selectors.
5. **Verify**: After filling forms, clicking buttons, or typing, confirm the result via screenshot or extract_content.
6. **Handle failures**: If a selector doesn't work, try scrolling, waiting, or using a different selector strategy. Try coordinates as a fallback. Never repeat the same failing action more than twice.
7. **Wait for loads**: After navigation or async actions, use wait (500-2000ms) or wait_for_element before interacting.
8. **Complete decisively**: Call task_complete with a clear summary when done, or task_failed with a specific reason if truly blocked.

## RULES
- **Screenshots are snapshots**: A screenshot shows the page AT THAT MOMENT. Do not assume the same state persists — always screenshot again after an action if you need to verify.
- **Be specific with selectors**: Prefer data attributes, IDs, or unique classes. Avoid overly broad selectors like 'div' or 'button'.
- **Scroll to find content**: Pages may have content off-screen. Scroll down or to elements before assuming they don't exist.
- **One tool per reasoning step**: Don't chain multiple actions blindly. Reason → act → verify.
- **User-provided images**: If the user attaches a screenshot or image, examine it carefully to understand the task context.
- **Sensitive data**: Never store passwords or personal data beyond what's needed for the immediate task.

## EXAMPLE FLOW
Task: "Search for MacBook on Amazon"
1. navigate_to https://amazon.com
2. screenshot → see search bar
3. find_elements #twotabsearchtextbox → get selector
4. click #twotabsearchtextbox
5. type_text "MacBook"
6. press_key Enter
7. wait 1000
8. screenshot → verify results page loaded
9. extract_content → get product list
10. task_complete "Found X results for MacBook on Amazon"

Think step by step. Be methodical. Verify each step.`;

export class AgentManager {
  constructor() {
    this.agents = new Map(); // taskId -> AgentState
    this.aiProvider = new AIProvider();
    this.toolExecutor = new ToolExecutor();
    this.imageStore = new ImageStore(); // OPFS-backed image persistence
    this.ports = new Map(); // taskId -> Set<Port> (for streaming to UI)
  }

  // ============ AGENT LIFECYCLE ============

  async createAgent(taskConfig) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const agent = {
      id: taskId,
      name: taskConfig.name || 'Unnamed Task',
      status: 'pending', // pending, running, paused, completed, stopped, error
      provider: taskConfig.provider || 'ollama',
      model: taskConfig.model || 'llama3',
      reasoningEffort: taskConfig.reasoningEffort || 'low',
      tabId: null,
      permissions: {
        terminal: taskConfig.permissions?.terminal || false,
        screenshots: taskConfig.permissions?.screenshots !== false,
        navigation: taskConfig.permissions?.navigation !== false,
        interaction: taskConfig.permissions?.interaction !== false,
        javascript: taskConfig.permissions?.javascript || false
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT }
      ],
      displayMessages: [], // Messages shown in UI (without system prompt)
      pendingMessagesForAI: [], // One-shot messages (with images) — sent once then discarded from history
      thinking: '', // Current thinking text
      tokens: { prompt: 0, completion: 0, total: 0, cost: 0 }, // Lifetime token totals
      createdAt: Date.now(),
      updatedAt: Date.now(),
      abortController: null,
      isProcessing: false,
      toolCallHistory: [],
      error: null
    };

    this.agents.set(taskId, agent);
    await this._persistAgent(agent);

    return taskId;
  }

  async startAgent(taskId, initialMessage) {
    const agent = this.agents.get(taskId);
    if (!agent) throw new Error(`Agent ${taskId} not found`);
    if (agent.status === 'running') throw new Error('Agent already running');

    // Create a new tab for the agent
    if (!agent.tabId) {
      const tab = await chrome.tabs.create({ active: false });
      agent.tabId = tab.id;
    }

    agent.status = 'running';
    agent.updatedAt = Date.now();

    // Add the initial user message
    if (initialMessage) {
      agent.messages.push({ role: 'user', content: initialMessage });
      agent.displayMessages.push({
        role: 'user',
        content: initialMessage,
        timestamp: Date.now()
      });
    }

    this._broadcastToUI(taskId, { type: 'status', status: 'running' });
    await this._persistAgent(agent);

    // Start the agent loop
    this._runAgentLoop(taskId);

    return agent;
  }

  async stopAgent(taskId) {
    const agent = this.agents.get(taskId);
    if (!agent) return;

    if (agent.abortController) {
      agent.abortController.abort();
    }
    agent.status = 'stopped';
    agent.isProcessing = false;
    agent.updatedAt = Date.now();

    this._broadcastToUI(taskId, { type: 'status', status: 'stopped' });
    await this._persistAgent(agent);
  }

  async addMessage(taskId, message, images = []) {
    const agent = this.agents.get(taskId);
    if (!agent) throw new Error(`Agent ${taskId} not found`);

    if (images.length > 0) {
      // Save images to OPFS so they survive extension restarts
      const imageRefs = await Promise.all(
        images.map(img => this.imageStore.save(agent.id, img).catch(() => null))
      ).then(refs => refs.filter(Boolean));

      // Messages with images are one-shot: images sent to AI once, then history stores text only.
      // This prevents 404 errors on non-vision models in future loop iterations.
      agent.pendingMessagesForAI.push({ role: 'user', content: message, images });
      // displayMessages keeps imageRefs (persistent) + images (in-memory)
      agent.displayMessages.push({ role: 'user', content: message, imageRefs, images, timestamp: Date.now() });
    } else {
      agent.messages.push({ role: 'user', content: message });
      agent.displayMessages.push({ role: 'user', content: message, timestamp: Date.now() });
    }

    agent.updatedAt = Date.now();

    this._broadcastToUI(taskId, {
      type: 'message',
      message: { role: 'user', content: message, images: images.length > 0 ? images : undefined, timestamp: Date.now() }
    });

    // If agent is completed or stopped, restart the loop
    if (['completed', 'stopped', 'error'].includes(agent.status)) {
      agent.status = 'running';
      this._broadcastToUI(taskId, { type: 'status', status: 'running' });
      this._runAgentLoop(taskId);
    }

    await this._persistAgent(agent);
  }

  async deleteAgent(taskId) {
    const agent = this.agents.get(taskId);
    if (agent) {
      if (agent.abortController) agent.abortController.abort();
      // Don't close the tab - user might want to keep it
    }
    this.agents.delete(taskId);
    await chrome.storage.local.remove(`agent_${taskId}`);

    // Delete all OPFS images for this task
    this.imageStore.deleteTask(taskId).catch(() => {});

    // Update task list
    const data = await chrome.storage.local.get('taskList');
    const taskList = (data.taskList || []).filter(id => id !== taskId);
    await chrome.storage.local.set({ taskList });
  }

  getAgent(taskId) {
    return this.agents.get(taskId);
  }

  getAllAgents() {
    return Array.from(this.agents.values()).map(a => this._getAgentSummary(a));
  }

  // ============ PORT MANAGEMENT (Streaming to UI) ============

  registerPort(taskId, port) {
    if (!this.ports.has(taskId)) {
      this.ports.set(taskId, new Set());
    }
    this.ports.get(taskId).add(port);

    port.onDisconnect.addListener(() => {
      const ports = this.ports.get(taskId);
      if (ports) {
        ports.delete(port);
        if (ports.size === 0) this.ports.delete(taskId);
      }
    });
  }

  _broadcastToUI(taskId, message) {
    const ports = this.ports.get(taskId);
    if (!ports) return;
    for (const port of ports) {
      try {
        port.postMessage(message);
      } catch (e) {
        ports.delete(port);
      }
    }

    // Also broadcast general updates for dashboard
    const allPorts = this.ports.get('__dashboard__');
    if (allPorts) {
      for (const port of allPorts) {
        try {
          port.postMessage({ ...message, taskId });
        } catch (e) {
          allPorts.delete(port);
        }
      }
    }
  }

  // ============ AGENT LOOP ============

  async _runAgentLoop(taskId) {
    const agent = this.agents.get(taskId);
    if (!agent || agent.isProcessing) return;

    agent.isProcessing = true;
    agent.abortController = new AbortController();

    try {
      while (agent.status === 'running') {
        // Get AI response
        const tools = getToolsForPermissions(agent.permissions);
        let fullContent = '';
        let fullThinking = '';
        let toolCalls = [];
        let callUsage = null; // token usage for this single AI call

        this._broadcastToUI(taskId, { type: 'thinking_start' });

        // Build messages for this AI call.
        // Pending messages (screenshots, user-uploaded images) are injected WITH their images
        // for THIS call only. Text-only stubs are added to agent.messages so history stays
        // clean on subsequent iterations — prevents 404 on non-vision models.
        let messagesForAI = agent.messages;
        if (agent.pendingMessagesForAI.length > 0) {
          const pending = agent.pendingMessagesForAI;
          agent.pendingMessagesForAI = [];
          // Persist text-only versions in conversation history
          for (const pm of pending) {
            agent.messages.push({ role: pm.role, content: pm.content });
          }
          // For this call: history BEFORE the stubs + full (with-images) pending messages
          messagesForAI = [
            ...agent.messages.slice(0, agent.messages.length - pending.length),
            ...pending
          ];
        }

        try {
          for await (const chunk of this.aiProvider.stream(
            agent.provider, agent.model, messagesForAI, tools, agent.reasoningEffort
          )) {
            // Check if aborted
            if (agent.status !== 'running') break;

            if (chunk.type === 'thinking') {
              fullThinking += chunk.content;
              agent.thinking = fullThinking;
              this._broadcastToUI(taskId, {
                type: 'thinking',
                content: chunk.content,
                full: fullThinking
              });
            } else if (chunk.type === 'text') {
              fullContent += chunk.content;
              this._broadcastToUI(taskId, {
                type: 'text',
                content: chunk.content,
                full: fullContent
              });
            } else if (chunk.type === 'tool_calls') {
              toolCalls = chunk.tool_calls;
              this._broadcastToUI(taskId, {
                type: 'tool_calls',
                tool_calls: toolCalls
              });
            } else if (chunk.type === 'usage') {
              callUsage = chunk.usage;
            }

            if (chunk.done) break;
          }
        } catch (streamErr) {
          if (agent.status !== 'running') break;
          throw streamErr;
        }

        if (agent.status !== 'running') break;

        // Add assistant message to history
        const assistantMsg = { role: 'assistant', content: fullContent };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        agent.messages.push(assistantMsg);

        const displayMsg = {
          role: 'assistant',
          content: fullContent,
          thinking: fullThinking || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
          usage: callUsage,
          timestamp: Date.now()
        };
        agent.displayMessages.push(displayMsg);

        // Accumulate lifetime token totals
        if (callUsage) {
          agent.tokens.prompt += callUsage.prompt_tokens || 0;
          agent.tokens.completion += callUsage.completion_tokens || 0;
          agent.tokens.total += callUsage.total_tokens || 0;
          agent.tokens.cost += callUsage.cost || 0;
          this._broadcastToUI(taskId, {
            type: 'tokens',
            call: callUsage,
            totals: { ...agent.tokens }
          });
        }

        this._broadcastToUI(taskId, { type: 'message', message: displayMsg });

        // If no tool calls, the agent is done thinking - wait for user input or end
        if (toolCalls.length === 0) {
          // Agent gave a text response without tools - it's in chat mode
          // or waiting for more instructions
          if (fullContent.trim() === '') {
            // Empty response, still mark as pause
          }
          // Keep running state but stop the loop - user can add messages
          break;
        }

        // Execute tool calls
        for (const toolCall of toolCalls) {
          if (agent.status !== 'running') break;

          const fnName = toolCall.function.name;
          let fnArgs = {};
          try {
            fnArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            fnArgs = {};
          }

          this._broadcastToUI(taskId, {
            type: 'tool_executing',
            tool: fnName,
            args: fnArgs,
            callId: toolCall.id
          });

          const result = await this.toolExecutor.execute(fnName, fnArgs, {
            tabId: agent.tabId,
            permissions: agent.permissions
          });

          // Handle special results
          if (result.completed) {
            agent.status = 'completed';
            agent.updatedAt = Date.now();
            this._broadcastToUI(taskId, {
              type: 'status',
              status: 'completed',
              summary: result.summary
            });
          }

          if (result.failed) {
            agent.status = 'error';
            agent.error = result.reason;
            agent.updatedAt = Date.now();
            this._broadcastToUI(taskId, {
              type: 'status',
              status: 'error',
              error: result.reason
            });
          }

          // Tool results must be plain text — images go through pendingMessagesForAI instead
          let toolResultContent;
          if ((fnName === 'screenshot' || fnName === 'map_buttons') && result.success && result.screenshot) {
            if (fnName === 'map_buttons') {
              // Include button list in tool result; screenshot is sent separately as a vision message
              const { screenshot: _ss, ...mapResult } = result;
              toolResultContent = JSON.stringify(mapResult);
            } else {
              toolResultContent = JSON.stringify({ success: true, message: 'Screenshot captured.' });
            }

            // Persist screenshot to OPFS and attach ref to the last assistant displayMsg
            const imageRef = await this.imageStore.save(taskId, result.screenshot).catch(() => null);
            if (imageRef) {
              const lastDisplayMsg = agent.displayMessages[agent.displayMessages.length - 1];
              if (lastDisplayMsg?.role === 'assistant') {
                if (!lastDisplayMsg.toolScreenshots) lastDisplayMsg.toolScreenshots = {};
                lastDisplayMsg.toolScreenshots[toolCall.id] = imageRef;
                // In-memory resolved data for immediate rendering
                if (!lastDisplayMsg.toolScreenshotData) lastDisplayMsg.toolScreenshotData = {};
                lastDisplayMsg.toolScreenshotData[toolCall.id] = result.screenshot;
              }
            }

            // One-shot: attach image to next AI call only (avoids 404 on non-vision models)
            const imgContent = fnName === 'map_buttons'
              ? 'Button map screenshot — numbered red badges show interactive elements. Use press_mapped_button with a number to click.'
              : 'Here is the screenshot of the current page:';
            agent.pendingMessagesForAI.push({
              role: 'user',
              content: imgContent,
              images: [result.screenshot]
            });
          } else {
            toolResultContent = JSON.stringify(result);
            if (toolResultContent.length > 10000) {
              toolResultContent = toolResultContent.substring(0, 10000) + '... (truncated)';
            }
          }

          agent.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent
          });

          // Update tool call history
          agent.toolCallHistory.push({
            tool: fnName,
            args: fnArgs,
            result: result.success ? 'success' : 'error',
            timestamp: Date.now()
          });

          this._broadcastToUI(taskId, {
            type: 'tool_result',
            tool: fnName,
            callId: toolCall.id,
            result: result
          });

          // If new tab was created, update agent's tabId
          if (fnName === 'new_tab' && result.success && result.tabId) {
            agent.tabId = result.tabId;
          }
          if (fnName === 'switch_tab' && result.success && result.tabId) {
            agent.tabId = result.tabId;
          }
        } // end for (toolCall)

        agent.updatedAt = Date.now();
        await this._persistAgent(agent);

        // If agent completed or failed via tool, stop the loop
        if (agent.status !== 'running') break;
      }
    } catch (err) {
      console.error(`Agent ${taskId} error:`, err);
      agent.status = 'error';
      agent.error = err.message;
      this._broadcastToUI(taskId, {
        type: 'error',
        error: err.message
      });
      this._broadcastToUI(taskId, {
        type: 'status',
        status: 'error',
        error: err.message
      });
    } finally {
      agent.isProcessing = false;
      agent.abortController = null;
      await this._persistAgent(agent);
    }
  }

  // ============ PERSISTENCE ============

  async _persistAgent(agent) {
    const serializable = {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      provider: agent.provider,
      model: agent.model,
      tabId: agent.tabId,
      permissions: agent.permissions,
      messages: agent.messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id
        // images are never persisted to storage — they live in OPFS only
      })),
      // Strip in-memory blob fields; keep only OPFS ref keys
      displayMessages: agent.displayMessages.map(dm => {
        const out = { ...dm };
        delete out.images;             // resolved from imageRefs at load time
        delete out.toolScreenshotData; // resolved from toolScreenshots at load time
        return out;
      }),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      toolCallHistory: agent.toolCallHistory.slice(-50), // Keep last 50
      error: agent.error
    };

    await chrome.storage.local.set({ [`agent_${agent.id}`]: serializable });

    // Update task list
    const data = await chrome.storage.local.get('taskList');
    const taskList = data.taskList || [];
    if (!taskList.includes(agent.id)) {
      taskList.push(agent.id);
      await chrome.storage.local.set({ taskList });
    }
  }

  async loadAgents() {
    const data = await chrome.storage.local.get('taskList');
    const taskList = data.taskList || [];

    for (const taskId of taskList) {
      const agentData = await chrome.storage.local.get(`agent_${taskId}`);
      const saved = agentData[`agent_${taskId}`];
      if (!saved) continue;

      // Restore agent state (but not running state)
      const agent = {
        ...saved,
        isProcessing: false,
        abortController: null,
        thinking: '',
        pendingMessagesForAI: [], // Always start fresh — images were one-shot
        tokens: saved.tokens || { prompt: 0, completion: 0, total: 0, cost: 0 },
        reasoningEffort: saved.reasoningEffort || 'low',
        // If was running, mark as stopped
        status: saved.status === 'running' ? 'stopped' : saved.status
      };

      // Restore images from OPFS refs (imageRefs → images, toolScreenshots → toolScreenshotData)
      await this.imageStore.resolveRefs(agent.displayMessages);

      this.agents.set(taskId, agent);
    }
  }

  _getAgentSummary(agent) {
    return {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      provider: agent.provider,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort || 'low',
      tabId: agent.tabId,
      permissions: agent.permissions,
      messageCount: agent.displayMessages.length,
      lastMessage: agent.displayMessages.length > 0
        ? agent.displayMessages[agent.displayMessages.length - 1]
        : null,
      toolCallCount: agent.toolCallHistory.length,
      tokens: agent.tokens || { prompt: 0, completion: 0, total: 0, cost: 0 },
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      error: agent.error
    };
  }
}
