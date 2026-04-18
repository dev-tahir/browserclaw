// Skill Executor — Runs skill JSON scripts step by step.
// Action steps execute directly (no AI). AI steps make one focused call.
// Condition steps branch deterministically. All templates are resolved at runtime.

import { resolveTemplates, STEP_TYPES, validateSkill } from './skill-format.js';
import { getToolsForPermissions } from './tools-definition.js';

export class SkillExecutor {
  /**
   * @param {object} toolExecutor  - ToolExecutor instance (for action steps)
   * @param {object} aiProvider    - AIProvider instance (for ai steps)
   */
  constructor(toolExecutor, aiProvider) {
    this.toolExecutor = toolExecutor;
    this.aiProvider = aiProvider;
  }

  /**
   * Execute a full skill script.
   *
   * @param {object}   skill       - Parsed skill JSON
   * @param {object}   inputValues - { inputId: value } map from user
   * @param {object}   context     - { tabId, permissions, provider, model, reasoningEffort }
   * @param {function} onProgress  - callback({ type, stepId, stepIndex, ... })
   * @param {object}   [ctrl]      - { signal: AbortSignal } for cancellation
   * @returns {Promise<{ success, variables, stepsRun, error? }>}
   */
  async run(skill, inputValues, context, onProgress, ctrl) {
    // Validate
    const validation = validateSkill(skill);
    if (!validation.valid) {
      return { success: false, error: `Invalid skill: ${validation.errors.join('; ')}`, stepsRun: 0, variables: {} };
    }

    const variables = {
      input: { ...(inputValues || {}) },
      var: {},
    };

    const steps = skill.steps;
    const stepIndexById = new Map();
    steps.forEach((s, i) => stepIndexById.set(s.id, i));

    let cursor = 0;   // current step index
    let stepsRun = 0;

    const emit = (type, extra = {}) => {
      if (onProgress) onProgress({ type, ...extra });
    };

    emit('skill_start', { name: skill.name, totalSteps: steps.length });

    try {
      while (cursor < steps.length) {
        // Check cancellation
        if (ctrl?.signal?.aborted) {
          emit('skill_cancelled', { stepsRun });
          return { success: false, error: 'Cancelled', stepsRun, variables };
        }

        const step = steps[cursor];
        emit('step_start', { stepId: step.id, stepIndex: cursor, step });
        stepsRun++;

        let result;
        try {
          switch (step.type) {
            case STEP_TYPES.ACTION:
              result = await this._runAction(step, variables, context);
              break;
            case STEP_TYPES.AI:
              result = await this._runAI(step, variables, context, emit);
              break;
            case STEP_TYPES.CONDITION:
              result = await this._runCondition(step, variables, context);
              break;
            default:
              throw new Error(`Unknown step type: ${step.type}`);
          }
        } catch (err) {
          emit('step_failed', { stepId: step.id, stepIndex: cursor, error: err.message });
          return { success: false, error: `Step "${step.label || step.id}" failed: ${err.message}`, stepsRun, variables };
        }

        emit('step_done', { stepId: step.id, stepIndex: cursor, result });

        // Determine next step
        if (result.jump) {
          if (result.jump === 'fail') {
            emit('skill_failed', { stepId: step.id, reason: result.reason || 'Condition failed' });
            return { success: false, error: result.reason || `Condition "${step.label || step.id}" routed to fail`, stepsRun, variables };
          }
          if (result.jump === 'end') {
            break;
          }
          if (result.jump === 'next') {
            cursor++;
          } else {
            const targetIdx = stepIndexById.get(result.jump);
            if (targetIdx === undefined) {
              throw new Error(`Jump target "${result.jump}" not found`);
            }
            cursor = targetIdx;
          }
        } else {
          cursor++;
        }
      }
    } catch (err) {
      emit('skill_failed', { error: err.message, stepsRun });
      return { success: false, error: err.message, stepsRun, variables };
    }

    emit('skill_done', { stepsRun, variables });
    return { success: true, stepsRun, variables };
  }

  // ─── Action step ────────────────────────────────────────────────────────

  async _runAction(step, variables, context) {
    const resolvedArgs = resolveTemplates(step.args, variables);
    const result = await this.toolExecutor.execute(step.tool, resolvedArgs, {
      tabId: context.tabId,
      permissions: context.permissions,
    });

    if (result.success === false) {
      throw new Error(result.error || result.message || `Tool "${step.tool}" failed`);
    }

    // Some tools update the tab (new_tab, switch_tab)
    if (result.tabId && (step.tool === 'new_tab' || step.tool === 'switch_tab')) {
      context.tabId = result.tabId;
    }

    return { toolResult: result };
  }

  // ─── AI step (mini agent loop with full tool access) ─────────────────────

  async _runAI(step, variables, context, emit) {
    const resolvedPrompt = resolveTemplates(step.prompt, variables);
    const tools = getToolsForPermissions(context.permissions);
    const MAX_TURNS = 15; // safety limit

    // Take a screenshot for initial context
    let screenshot = null;
    if (context.tabId) {
      try {
        const ssResult = await this.toolExecutor.execute('screenshot', {}, {
          tabId: context.tabId,
          permissions: context.permissions,
        });
        if (ssResult.success && ssResult.screenshot) {
          screenshot = ssResult.screenshot;
        }
      } catch { /* screenshot is optional */ }
    }

    const messages = [
      { role: 'system', content: 'You are a browser automation assistant. You have full access to browser tools (click, type, navigate, etc.). Complete the task described below. When you are finished, respond with a final text summary — do NOT call any more tools.' },
      {
        role: 'user',
        content: resolvedPrompt,
        ...(screenshot ? { images: [screenshot] } : {}),
      },
    ];

    let finalResponse = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let fullContent = '';
      let fullThinking = '';
      let toolCalls = [];

      emit('ai_step_thinking', { stepId: step.id });

      try {
        for await (const chunk of this.aiProvider.stream(
          context.provider, context.model, messages, tools, context.reasoningEffort || 'low'
        )) {
          if (chunk.type === 'thinking') {
            fullThinking += chunk.content;
            emit('ai_step_thinking_content', { stepId: step.id, content: chunk.content });
          } else if (chunk.type === 'text') {
            fullContent += chunk.content;
            emit('ai_step_text', { stepId: step.id, content: chunk.content, full: fullContent });
          } else if (chunk.type === 'tool_calls') {
            toolCalls = chunk.tool_calls;
            emit('ai_step_tool_calls', { stepId: step.id, tool_calls: toolCalls });
          }
          if (chunk.done) break;
        }
      } catch (err) {
        throw new Error(`AI call failed: ${err.message}`);
      }

      // Add assistant message to conversation
      const assistantMsg = { role: 'assistant', content: fullContent };
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      messages.push(assistantMsg);

      // No tool calls → AI is done, save final response
      if (toolCalls.length === 0) {
        finalResponse = fullContent.trim();
        break;
      }

      // Execute tool calls
      for (const toolCall of toolCalls) {
        const fnName = toolCall.function.name;
        let fnArgs = {};
        try { fnArgs = JSON.parse(toolCall.function.arguments); } catch {}

        emit('ai_step_tool_exec', { stepId: step.id, tool: fnName, args: fnArgs, callId: toolCall.id });

        const result = await this.toolExecutor.execute(fnName, fnArgs, {
          tabId: context.tabId,
          permissions: context.permissions,
        });

        // Sync tabId if navigation tools changed it
        if (result.tabId && (fnName === 'new_tab' || fnName === 'switch_tab')) {
          context.tabId = result.tabId;
        }

        // Handle screenshot results — send image to AI for next turn
        let toolResultContent;
        if ((fnName === 'screenshot' || fnName === 'map_buttons') && result.success && result.screenshot) {
          if (fnName === 'map_buttons') {
            const { screenshot: _ss, ...mapResult } = result;
            toolResultContent = JSON.stringify(mapResult);
          } else {
            toolResultContent = JSON.stringify({ success: true, message: 'Screenshot captured.' });
          }
          // Add tool result first
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResultContent });
          // Then add screenshot as user message for vision
          const imgContent = fnName === 'map_buttons'
            ? 'Button map screenshot — numbered red badges show interactive elements.'
            : 'Here is the screenshot of the current page:';
          messages.push({ role: 'user', content: imgContent, images: [result.screenshot] });
        } else {
          toolResultContent = JSON.stringify(result);
          if (toolResultContent.length > 10000) {
            toolResultContent = JSON.stringify({ success: result.success !== false, message: 'Result truncated.' });
          }
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResultContent });
        }

        emit('ai_step_tool_result', { stepId: step.id, tool: fnName, callId: toolCall.id, success: result.success !== false });
      }
    }

    if (!finalResponse) {
      finalResponse = '(AI step completed after max turns)';
    }

    // Save to variables
    if (step.saveAs) {
      variables.var[step.saveAs] = finalResponse;
    }
    return { aiResponse: finalResponse };
  }

  // ─── Condition step ─────────────────────────────────────────────────────

  async _runCondition(step, variables, context) {
    let passed = false;

    switch (step.check) {
      case 'variable_not_empty':
        passed = !!variables.var[step.variable];
        break;

      case 'variable_equals': {
        const resolved = resolveTemplates(step.value, variables);
        passed = variables.var[step.variable] === resolved;
        break;
      }

      case 'variable_contains': {
        const resolved = resolveTemplates(step.value, variables);
        passed = (variables.var[step.variable] || '').includes(resolved);
        break;
      }

      case 'url_contains': {
        const resolved = resolveTemplates(step.value, variables);
        if (context.tabId) {
          try {
            const tab = await chrome.tabs.get(context.tabId);
            passed = (tab.url || '').includes(resolved);
          } catch {
            passed = false;
          }
        }
        break;
      }

      case 'element_exists': {
        const resolved = resolveTemplates(step.selector, variables);
        if (context.tabId) {
          try {
            const result = await this.toolExecutor.execute('find_elements', { selector: resolved, limit: 1 }, {
              tabId: context.tabId,
              permissions: context.permissions,
            });
            passed = result.success && result.elements && result.elements.length > 0;
          } catch {
            passed = false;
          }
        }
        break;
      }

      default:
        throw new Error(`Unknown condition check: ${step.check}`);
    }

    return {
      passed,
      jump: passed ? step.onTrue : step.onFalse,
      reason: passed ? null : `Condition "${step.label || step.id}" evaluated false`,
    };
  }
}
