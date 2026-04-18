// Service Worker - Main orchestration hub for the extension
// Handles message routing between UI, agents, and external APIs

import { AgentManager } from './agent-manager.js';
import { AIProvider } from './ai-provider.js';
import { SkillsManager } from './skills-manager.js';
import { TOOLS } from './tools-definition.js';
import { validateSkill } from './skill-format.js';

const agentManager = new AgentManager();
const aiProvider = new AIProvider();
const skillsManager = new SkillsManager();

// ============ INITIALIZATION ============

chrome.runtime.onInstalled.addListener(async () => {
  console.log('AI Browser Control Agent installed');
  await aiProvider.loadSettings();
  await agentManager.loadAgents();

  // Set up keepalive alarm for MV3
  chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Check if any agents are running and keep SW alive
    const running = Array.from(agentManager.agents.values()).some(a => a.status === 'running');
    if (running) {
      console.log('Keepalive: agents running');
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await aiProvider.loadSettings();
  await agentManager.loadAgents();
});

// Self-initialize
(async () => {
  await aiProvider.loadSettings();
  await agentManager.loadAgents();
})();

// ============ MESSAGE HANDLING ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    // ---- Settings ----
    case 'getSettings':
      return await getSettings();

    case 'saveSettings':
      return await saveSettings(message.settings);

    // ---- Models ----
    case 'getOllamaModels':
      await aiProvider.loadSettings();
      const models = await aiProvider.getOllamaModels();
      return { success: true, models };

    case 'getOpenRouterModels':
      await aiProvider.loadSettings();
      const orModels = await aiProvider.getOpenRouterModels();
      return { success: true, models: orModels };

    // ---- Skills ----
    case 'getSkills':
      return { success: true, skills: await skillsManager.getSkills() };

    case 'saveSkill':
      await skillsManager.saveSkill(message.id, message.content);
      return { success: true };

    case 'resetSkill':
      await skillsManager.resetSkill(message.id);
      return { success: true };

    case 'createSkill':
      await skillsManager.createSkill(message.id, message.content);
      return { success: true };

    case 'deleteSkill':
      await skillsManager.deleteSkill(message.id);
      return { success: true };

    // ---- Script Skills (.json) ----
    case 'getScriptSkills':
      return { success: true, skills: await skillsManager.getScriptSkills() };

    case 'getScriptSkill':
      return { success: true, skill: await skillsManager.getScriptSkill(message.id) };

    case 'saveScriptSkill':
      await skillsManager.saveScriptSkill(message.id, message.skill);
      return { success: true };

    case 'deleteScriptSkill':
      await skillsManager.deleteScriptSkill(message.id);
      return { success: true };

    case 'getAllSkills':
      return { success: true, skills: await skillsManager.getAllSkillsMerged() };

    case 'runSkillScript': {
      const skill = await skillsManager.getScriptSkill(message.skillId);
      if (!skill) return { success: false, error: 'Skill not found' };
      const result = await agentManager.runSkillScript(
        message.taskId, skill, message.inputValues || {},
        { provider: message.provider, model: message.model, reasoningEffort: message.reasoningEffort }
      );
      return { success: result.success, error: result.error, stepsRun: result.stepsRun };
    }

    case 'validateSkillJSON': {
      try {
        const obj = typeof message.skill === 'string' ? JSON.parse(message.skill) : message.skill;
        const v = validateSkill(obj);
        return { success: v.valid, errors: v.errors };
      } catch (e) {
        return { success: false, errors: [`JSON parse error: ${e.message}`] };
      }
    }

    case 'getToolsInfo':
      return { success: true, toolsInfo: getToolsInfoText() };

    case 'generateSkillWithAI':
      return await generateSkillWithAI(message);

    // ---- Agent Management ----
    case 'createAgent': {
      // Build skills appendix before creating the agent
      let skillsAppendix = '';
      if (message.config.skillsMode) {
        const allSkills = await skillsManager.getSkills();
        skillsAppendix = skillsManager.getSkillsForPrompt(
          allSkills,
          message.config.skills || [],
          message.config.skillsMode
        );
      }
      const taskId = await agentManager.createAgent({ ...message.config, skillsAppendix });
      return { success: true, taskId };
    }

    case 'startAgent':
      await agentManager.startAgent(message.taskId, message.message);
      return { success: true };

    case 'ensureAgentTab':
      await agentManager.ensureTab(message.taskId);
      return { success: true };

    case 'stopAgent':
      await agentManager.stopAgent(message.taskId);
      return { success: true };

    case 'addMessage':
      await agentManager.addMessage(message.taskId, message.message, message.images || []);
      return { success: true };

    case 'deleteAgent':
      await agentManager.deleteAgent(message.taskId);
      return { success: true };

    case 'getAgent':
      const agent = agentManager.getAgent(message.taskId);
      if (!agent) return { success: false, error: 'Agent not found' };
      return { success: true, agent: getAgentForUI(agent) };

    case 'getAllAgents':
      return { success: true, agents: agentManager.getAllAgents() };

    case 'getAgentMessages':
      const msgAgent = agentManager.getAgent(message.taskId);
      if (!msgAgent) return { success: false, error: 'Agent not found' };
      return { success: true, messages: msgAgent.displayMessages };

    // ---- Dashboard ----
    case 'openDashboard':
      await openDashboard();
      return { success: true };

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ============ PORT CONNECTIONS (Streaming) ============

chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('agent-stream-')) {
    const taskId = port.name.replace('agent-stream-', '');
    agentManager.registerPort(taskId, port);

    // Send current state
    const agent = agentManager.getAgent(taskId);
    if (agent) {
      port.postMessage({
        type: 'init',
        agent: getAgentForUI(agent),
        messages: agent.displayMessages
      });
    }
  } else if (port.name === 'dashboard') {
    agentManager.registerPort('__dashboard__', port);

    // Send all agents
    port.postMessage({
      type: 'init',
      agents: agentManager.getAllAgents()
    });
  }
});

// ============ TAB EVENTS ============

// Track when agent tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [taskId, agent] of agentManager.agents) {
    if (agent.tabId === tabId) {
      agent.tabId = null;
      if (agent.status === 'running') {
        agentManager.stopAgent(taskId);
      }
    }
  }
});

// ============ SETTINGS ============

async function getSettings() {
  const data = await chrome.storage.local.get([
    'ollamaBaseUrl',
    'openrouterApiKey',
    'defaultProvider',
    'defaultModel'
  ]);
  return {
    success: true,
    settings: {
      ollamaBaseUrl: data.ollamaBaseUrl || 'http://localhost:11434',
      openrouterApiKey: data.openrouterApiKey || '',
      defaultProvider: data.defaultProvider || 'ollama',
      defaultModel: data.defaultModel || ''
    }
  };
}

async function saveSettings(settings) {
  await chrome.storage.local.set(settings);
  await aiProvider.loadSettings();
  return { success: true };
}

// ============ HELPERS ============

function getToolsInfoText() {
  const skip = new Set(['task_complete', 'task_failed', 'execute_steps']);
  return TOOLS
    .filter(t => !skip.has(t.function.name))
    .map(t => {
      const f = t.function;
      const params = f.parameters?.properties || {};
      const required = f.parameters?.required || [];
      const paramLines = Object.entries(params).map(([k, v]) => {
        const req = required.includes(k) ? ' (required)' : '';
        const type = v.type || 'any';
        return `    ${k}: ${type}${req} — ${v.description || ''}`;
      });
      return `${f.name} — ${f.description}\n${paramLines.length ? paramLines.join('\n') : '    (no parameters)'}`;
    })
    .join('\n\n');
}

// ============ SKILL GENERATION ============

async function generateSkillWithAI({ provider, model, reasoningEffort, instructions, meta, taskId }) {
  const userParts = [];
  if (meta.name)        userParts.push(`Skill name: ${meta.name}`);
  if (meta.domain)      userParts.push(`Domain/site: ${meta.domain}`);
  if (meta.description) userParts.push(`Description: ${meta.description}`);

  // Include conversation context when opened from a task
  if (taskId) {
    const agent = agentManager.getAgent(taskId);
    if (agent) {
      const convoLines = agent.displayMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          if (m.role === 'user') return `User: ${m.content}`;
          let text = m.content || '';
          if (m.tool_calls && m.tool_calls.length > 0) {
            const tc = m.tool_calls.map(t => `  - ${t.function.name}(${t.function.arguments})`).join('\n');
            text += (text ? '\n' : '') + 'Tool calls:\n' + tc;
          }
          return `Assistant: ${text}`;
        })
        .join('\n\n');
      if (convoLines) {
        userParts.push(`\n=== CONVERSATION CONTEXT ===\n${convoLines}\n=== END CONVERSATION ===`);
      }
    }
  }

  const userPrompt = userParts.length > 0
    ? `Create a skill file for the following:\n${userParts.join('\n')}\n\nGenerate the full skill file now:`
    : 'Generate a skill file based on the instructions above.';

  const messages = [
    { role: 'system', content: instructions },
    { role: 'user', content: userPrompt }
  ];

  let fullText = '';
  try {
    await aiProvider.loadSettings();
    for await (const chunk of aiProvider.stream(provider, model, messages, [], reasoningEffort || 'none')) {
      if (chunk.type === 'text') fullText += chunk.content;
      if (chunk.done) break;
    }
  } catch (e) {
    return { success: false, error: e.message };
  }

  return { success: true, content: fullText.trim() };
}

async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');

  // Check if dashboard is already open
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url === dashboardUrl) {
      await chrome.tabs.update(tab.id, { active: true });
      return;
    }
  }

  await chrome.tabs.create({ url: dashboardUrl });
}

function getAgentForUI(agent) {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    provider: agent.provider,
    model: agent.model,
    tabId: agent.tabId,
    permissions: agent.permissions,
    messageCount: agent.displayMessages?.length || 0,
    displayMessages: agent.displayMessages,
    toolCallHistory: agent.toolCallHistory,
    tokens: agent.tokens || { prompt: 0, completion: 0, total: 0, cost: 0 },
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    error: agent.error,
    thinking: agent.thinking
  };
}
