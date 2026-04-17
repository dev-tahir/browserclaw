// Service Worker - Main orchestration hub for the extension
// Handles message routing between UI, agents, and external APIs

import { AgentManager } from './agent-manager.js';
import { AIProvider } from './ai-provider.js';
import { SkillsManager } from './skills-manager.js';

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

    case 'generateSkillFromChat':
      return await generateSkillFromChat(message.taskId);

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

// ============ SKILL GENERATION ============

async function generateSkillFromChat(taskId) {
  const agent = agentManager.getAgent(taskId);
  if (!agent) return { success: false, error: 'Task not found' };

  // Build a readable conversation summary (user + assistant text only, no images)
  const lines = agent.displayMessages
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

  const systemPrompt = `You are an expert browser automation knowledge extractor.
Your job is to create a reusable skill .txt file from a browser automation conversation.

The skill file format:
name: Skill Name
domain: example.com
description: Brief description
version: 1.0
---
[Plain text automation knowledge: reliable selectors, step-by-step workflows, gotchas, URL patterns]

Be concise, practical, and specific. Focus on information that helps future automation of the same site.`;

  const userPrompt = `Extract a reusable automation skill from this conversation. Identify the domain/site being automated and document:
- Reliable CSS selectors and element identifiers that were used
- Step-by-step workflows that succeeded
- URL patterns and navigation flows
- Common gotchas encountered and how to handle them

Conversation:
${lines}

Generate the full skill file now:`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  let fullText = '';
  try {
    await aiProvider.loadSettings();
    for await (const chunk of aiProvider.stream(agent.provider, agent.model, messages, [], 'none')) {
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
