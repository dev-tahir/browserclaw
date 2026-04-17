// Dashboard JavaScript - Main UI logic
// Handles task management, chat, streaming, and settings

(() => {
  // ============ STATE ============
  let currentView = 'grid'; // 'grid' | 'detail'
  let currentTaskId = null;
  let currentFilter = 'all';
  let selectedProvider = 'ollama';
  let agents = [];
  let dashboardPort = null;
  let taskPort = null;
  let streamingContent = '';
  let streamingThinking = '';
  let isStreaming = false;
  let pendingImages = []; // { dataUrl, name } — images to attach to the next sent message

  // OpenRouter model picker state
  let orAllModels = [];       // full model list fetched from backend
  let orSelectedModel = '';   // currently chosen model id
  let orPickerOpen = false;

  // Reasoning effort (matches the active .reasoning-btn)
  let selectedReasoningEffort = 'low';

  // Skills
  let skills = [];           // all loaded skills (from service worker)
  let editingSkillId = null; // skill currently open in the viewer/editor modal

  // ============ ELEMENTS ============
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const taskGridView = $('#taskGridView');
  const taskDetailView = $('#taskDetailView');
  const taskGrid = $('#taskGrid');
  const emptyState = $('#emptyState');
  const chatMessages = $('#chatMessages');
  const chatInput = $('#chatInput');
  const newTaskModal = $('#newTaskModal');
  const settingsModal = $('#settingsModal');
  const modelSelect = $('#modelSelect');

  // ============ INITIALIZATION ============

  async function init() {
    initScreenshotModal();
    setupEventListeners();
    await loadSettings();
    await loadSkills();
    await loadAgents();
    connectDashboardPort();
  }

  function setupEventListeners() {
    // New task
    $('#btnNewTask').addEventListener('click', openNewTaskModal);
    $('#btnNewTaskEmpty')?.addEventListener('click', openNewTaskModal);
    $('#btnCloseNewTask').addEventListener('click', closeNewTaskModal);
    $('#btnCancelNewTask').addEventListener('click', closeNewTaskModal);
    $('#btnCreateTask').addEventListener('click', createAndStartTask);
    $('#btnCreateTaskRight').addEventListener('click', createAndStartTask);

    // Settings
    $('#btnSettings').addEventListener('click', openSettingsModal);
    $('#btnCloseSettings').addEventListener('click', closeSettingsModal);
    $('#btnCancelSettings').addEventListener('click', closeSettingsModal);
    $('#btnSaveSettings').addEventListener('click', saveSettings);

    // Detail view
    $('#btnBack').addEventListener('click', showGridView);
    $('#btnStopTask').addEventListener('click', () => stopCurrentTask());
    $('#btnDeleteTask').addEventListener('click', () => deleteCurrentTask());
    $('#btnSendMessage').addEventListener('click', sendMessage);

    // Event delegation for dynamically created elements (CSP-safe, no inline onclick)
    chatMessages.addEventListener('click', (e) => {
      // Screenshot / body image click — open modal
      if (e.target.classList.contains('tool-thumb') || e.target.classList.contains('tci-body-img') || e.target.classList.contains('chat-screenshot')) {
        openScreenshotModal(e.target.src);
        return;
      }
      // Tool call row click — toggle accordion
      const tciRow = e.target.closest('.tci-row');
      if (tciRow) {
        const wrap = tciRow.closest('.tci-wrap');
        if (wrap && wrap.classList.contains('has-output')) {
          wrap.classList.toggle('open');
        }
        return;
      }
    });

    // Image attachment button
    $('#btnAddImage').addEventListener('click', () => $('#imageFileInput').click());
    $('#imageFileInput').addEventListener('change', (e) => {
      for (const file of e.target.files) {
        if (!file.type.startsWith('image/')) continue;
        readImageFile(file);
      }
      e.target.value = ''; // reset so same file can be picked again
    });

    // Chat input - auto resize and Enter to send
    chatInput.addEventListener('input', autoResizeTextarea);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Clipboard paste (images)
    chatInput.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          readImageFile(item.getAsFile());
        }
      }
    });

    // Provider tabs
    $$('.provider-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.provider-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        selectedProvider = tab.dataset.provider;
        loadModels();
      });
    });

    // Filter buttons
    $$('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTaskGrid();
      });
    });

    // Refresh models
    $('#btnRefreshModels').addEventListener('click', loadModels);

    // Reasoning effort selector
    $$('#reasoningSelector .reasoning-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#reasoningSelector .reasoning-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedReasoningEffort = btn.dataset.value;
      });
    });

    // Setup OpenRouter custom model picker
    setupOrPickerListeners();

    // Skills row
    $('#btnAddSkill').addEventListener('click', () => openCreateSkillModal(null));

    // Skill viewer/editor modal
    $('#btnCloseSkillModal').addEventListener('click', closeSkillModal);
    $('#btnCancelSkillModal').addEventListener('click', closeSkillModal);
    $('#btnSaveSkillModal').addEventListener('click', saveCurrentSkill);
    $('#btnResetSkill').addEventListener('click', resetCurrentSkill);
    $('#btnDeleteSkill').addEventListener('click', deleteCurrentSkill);

    // Create skill modal
    $('#btnCloseCreateSkill').addEventListener('click', closeCreateSkillModal);
    $('#btnCancelCreateSkill').addEventListener('click', closeCreateSkillModal);
    $('#btnSaveCreateSkill').addEventListener('click', saveNewSkill);
    $('#btnGenerateSkill').addEventListener('click', generateSkillFromConversation);

    // Skill auto-mode toggle in new task modal
    $('#skillAutoMode').addEventListener('change', () => {
      const manual = !$('#skillAutoMode').checked;
      $('#skillCheckboxes').classList.toggle('visible', manual);
      $('.skill-auto-hint').style.display = manual ? 'none' : '';
    });

    // Save as skill (task detail header)
    $('#btnSaveAsSkill').addEventListener('click', () => openCreateSkillModal(currentTaskId));

    // Close modals on overlay click — newTaskModal excluded (X button / Cancel only)
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('active');
    });
    $('#skillModal').addEventListener('click', (e) => {
      if (e.target === $('#skillModal')) closeSkillModal();
    });
    $('#createSkillModal').addEventListener('click', (e) => {
      if (e.target === $('#createSkillModal')) closeCreateSkillModal();
    });
  }

  // ============ DASHBOARD PORT (Real-time updates) ============

  function connectDashboardPort() {
    dashboardPort = chrome.runtime.connect({ name: 'dashboard' });

    dashboardPort.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'init':
          agents = msg.agents || [];
          renderTaskGrid();
          break;
        case 'status':
          updateAgentStatus(msg.taskId, msg.status, msg);
          break;
        case 'message':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            appendChatMessage(msg.message);
          }
          updateAgentInList(msg.taskId);
          break;
        case 'thinking_start':
          if (msg.taskId === currentTaskId) {
            streamingThinking = '';
            isStreaming = true;
          }
          break;
        case 'thinking':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            streamingThinking = msg.full;
            updateStreamingMessage();
          }
          break;
        case 'text':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            streamingContent = msg.full;
            updateStreamingMessage();
          }
          break;
        case 'tool_calls':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            finishStreamingMessage();
            for (const tc of msg.tool_calls) {
              appendToolCall(tc);
            }
          }
          break;
        case 'tool_executing':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            updateToolCallStatus(msg.callId, 'executing', msg.tool, msg.args);
          }
          break;
        case 'tool_result':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            updateToolCallResult(msg.callId, msg.result, msg.tool);
          }
          break;
        case 'error':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            appendSystemMessage(`Error: ${msg.error}`, 'error');
          }
          break;
        case 'tokens':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            updateTokenBar(msg.totals);
          }
          break;
      }
    });

    dashboardPort.onDisconnect.addListener(() => {
      setTimeout(connectDashboardPort, 1000);
    });
  }

  function connectTaskPort(taskId) {
    if (taskPort) {
      taskPort.disconnect();
    }

    taskPort = chrome.runtime.connect({ name: `agent-stream-${taskId}` });

    taskPort.onMessage.addListener((msg) => {
      if (msg.type === 'init') {
        renderChatHistory(msg.messages || []);
      }
    });
  }

  // ============ DATA LOADING ============

  async function loadAgents() {
    const response = await chrome.runtime.sendMessage({ type: 'getAllAgents' });
    if (response?.success) {
      agents = response.agents;
      renderTaskGrid();
    }
  }

  async function loadSettings() {
    const response = await chrome.runtime.sendMessage({ type: 'getSettings' });
    if (response?.success) {
      const s = response.settings;
      $('#settOllamaUrl').value = s.ollamaBaseUrl;
      $('#settOpenRouterKey').value = s.openrouterApiKey;
      $('#settDefaultProvider').value = s.defaultProvider;
      selectedProvider = s.defaultProvider;

      // Set active provider tab
      $$('.provider-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.provider === selectedProvider);
      });

      await loadModels();
    }
  }

  async function loadModels() {
    const isOR = selectedProvider === 'openrouter';

    // Toggle which picker is visible
    modelSelect.style.display = isOR ? 'none' : '';
    $('#orModelPicker').style.display = isOR ? '' : 'none';

    if (!isOR) {
      // ---- Ollama: native <select> ----
      modelSelect.innerHTML = '<option value="">Loading models…</option>';
      const response = await chrome.runtime.sendMessage({ type: 'getOllamaModels' });
      if (response?.success && response.models.length > 0) {
        modelSelect.innerHTML = '';
        for (const model of response.models) {
          const opt = document.createElement('option');
          opt.value = model.name;
          opt.textContent = `${model.name} (${formatBytes(model.size)})`;
          modelSelect.appendChild(opt);
        }
      } else {
        modelSelect.innerHTML = '<option value="">No models found – check Ollama</option>';
      }
    } else {
      // ---- OpenRouter: custom searchable picker ----
      setOrLabel('Loading models…');
      const response = await chrome.runtime.sendMessage({ type: 'getOpenRouterModels' });
      if (response?.success && response.models.length > 0) {
        orAllModels = response.models;
        orSelectedModel = '';
        setOrLabel('Select a model…');
        renderOrList('');
      } else {
        orAllModels = [];
        setOrLabel('No models found – check API key');
      }
    }
  }

  // ---- OpenRouter picker helpers ----

  function setOrLabel(text) {
    $('#orModelLabel').textContent = text;
  }

  async function getModelUsageCounts() {
    const data = await chrome.storage.local.get('modelUsageCounts');
    return data.modelUsageCounts || {};
  }

  async function incrementModelUsage(modelId) {
    const counts = await getModelUsageCounts();
    counts[modelId] = (counts[modelId] || 0) + 1;
    await chrome.storage.local.set({ modelUsageCounts: counts });
  }

  async function renderOrList(query) {
    const listEl = $('#orModelList');
    listEl.innerHTML = '';
    const q = query.toLowerCase().trim();
    const counts = await getModelUsageCounts();

    // Favourites: top-5 most used OR models that exist in current list
    const favIds = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .filter(id => orAllModels.some(m => m.name === id))
      .slice(0, 5);

    const filtered = orAllModels.filter(m =>
      !q || m.name.toLowerCase().includes(q) || (m.displayName || '').toLowerCase().includes(q)
    );

    // Show favourites section only when not searching and there are some
    if (!q && favIds.length > 0) {
      const header = document.createElement('div');
      header.className = 'or-model-group-header';
      header.textContent = '★ Favourites';
      listEl.appendChild(header);

      for (const id of favIds) {
        const m = orAllModels.find(x => x.name === id);
        if (m) listEl.appendChild(buildOrOption(m, counts[id]));
      }

      if (filtered.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'or-model-group-header';
        sep.textContent = 'All Models';
        listEl.appendChild(sep);
      }
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'or-model-empty';
      empty.textContent = 'No models match your search';
      listEl.appendChild(empty);
      return;
    }

    for (const m of filtered) {
      listEl.appendChild(buildOrOption(m, counts[m.name]));
    }
  }

  function buildOrOption(model, usageCount) {
    const item = document.createElement('div');
    item.className = 'or-model-option' + (model.name === orSelectedModel ? ' selected' : '');
    item.dataset.value = model.name;

    const nameEl = document.createElement('div');
    nameEl.className = 'or-model-name';
    nameEl.textContent = model.displayName || model.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'or-model-meta';

    const idSpan = document.createElement('span');
    idSpan.textContent = model.name;

    metaEl.appendChild(idSpan);

    if (model.pricing?.prompt) {
      const priceSpan = document.createElement('span');
      priceSpan.className = 'or-model-price';
      const promptM = parseFloat(model.pricing.prompt) * 1_000_000;
      priceSpan.textContent = `$${promptM.toFixed(2)}/M`;
      metaEl.appendChild(priceSpan);
    }

    if (usageCount > 0) {
      const useSpan = document.createElement('span');
      useSpan.className = 'or-model-uses';
      useSpan.textContent = `used ${usageCount}×`;
      metaEl.appendChild(useSpan);
    }

    item.appendChild(nameEl);
    item.appendChild(metaEl);

    item.addEventListener('click', () => {
      orSelectedModel = model.name;
      setOrLabel(model.displayName || model.name);
      closeOrPicker();
    });

    return item;
  }

  function openOrPicker() {
    orPickerOpen = true;
    $('#orModelDropdown').classList.add('open');
    const searchInput = $('#orModelSearch');
    searchInput.value = '';
    renderOrList('');
    searchInput.focus();
  }

  function closeOrPicker() {
    orPickerOpen = false;
    $('#orModelDropdown').classList.remove('open');
  }

  function setupOrPickerListeners() {
    // Toggle on trigger click
    $('#orModelTrigger').addEventListener('click', () => {
      if (orPickerOpen) closeOrPicker(); else openOrPicker();
    });
    $('#orModelTrigger').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrPicker(); }
      if (e.key === 'Escape') closeOrPicker();
    });

    // Search input — filter list
    $('#orModelSearch').addEventListener('input', (e) => {
      renderOrList(e.target.value);
    });
    $('#orModelSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeOrPicker();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (orPickerOpen && !$('#orModelPicker').contains(e.target)) {
        closeOrPicker();
      }
    });
  }

  // ============ TASK MANAGEMENT ============

  async function createAndStartTask() {
    const name = $('#taskName').value.trim();
    // Read model from the active picker
    const model = selectedProvider === 'openrouter' ? orSelectedModel : modelSelect.value;
    const message = $('#taskMessage').value.trim();

    if (!name) { alert('Please enter a task name'); return; }
    if (!model) { alert('Please select a model'); return; }
    if (!message) { alert('Please describe the task'); return; }

    // Track model usage for favourites
    if (selectedProvider === 'openrouter') {
      incrementModelUsage(model);
    }

    const config = {
      name,
      provider: selectedProvider,
      model,
      reasoningEffort: selectedReasoningEffort,
      permissions: {
        navigation: $('#permNavigation').checked,
        interaction: $('#permInteraction').checked,
        screenshots: $('#permScreenshots').checked,
        terminal: $('#permTerminal').checked,
        javascript: $('#permJavascript').checked
      },
      skillsMode: $('#skillAutoMode').checked ? 'auto' : 'manual',
      skills: (() => {
        const ids = [];
        $$('#skillCheckboxes input:checked').forEach(cb => ids.push(cb.value));
        return ids;
      })()
    };

    // Create agent
    const createRes = await chrome.runtime.sendMessage({ type: 'createAgent', config });
    if (!createRes?.success) {
      alert('Failed to create agent: ' + (createRes?.error || 'Unknown error'));
      return;
    }

    // Start agent
    const startRes = await chrome.runtime.sendMessage({
      type: 'startAgent',
      taskId: createRes.taskId,
      message
    });

    if (!startRes?.success) {
      alert('Failed to start agent: ' + (startRes?.error || 'Unknown error'));
      return;
    }

    closeNewTaskModal();

    // Refresh and open the task
    await loadAgents();
    openTaskDetail(createRes.taskId);
  }

  async function stopCurrentTask() {
    if (!currentTaskId) return;
    await chrome.runtime.sendMessage({ type: 'stopAgent', taskId: currentTaskId });
    await loadAgents();
  }

  async function deleteCurrentTask() {
    if (!currentTaskId) return;
    if (!confirm('Delete this task? This cannot be undone.')) return;

    await chrome.runtime.sendMessage({ type: 'deleteAgent', taskId: currentTaskId });
    showGridView();
    await loadAgents();
  }

  function readImageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      pendingImages.push({ dataUrl: e.target.result, name: file.name || 'image' });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  }

  function renderImagePreviews() {
    const strip = $('#imagePreviewStrip');
    strip.innerHTML = '';
    if (pendingImages.length === 0) {
      strip.style.display = 'none';
      return;
    }
    strip.style.display = 'flex';
    pendingImages.forEach((img, idx) => {
      const item = document.createElement('div');
      item.className = 'image-preview-item';

      const imgEl = document.createElement('img');
      imgEl.src = img.dataUrl;
      imgEl.alt = img.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'image-preview-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        pendingImages.splice(idx, 1);
        renderImagePreviews();
      });

      item.appendChild(imgEl);
      item.appendChild(removeBtn);
      strip.appendChild(item);
    });
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    const hasImages = pendingImages.length > 0;
    if (!text && !hasImages) return;
    if (!currentTaskId) return;

    const messageText = text || '(image attached)';
    const images = pendingImages.map(i => i.dataUrl);

    chatInput.value = '';
    autoResizeTextarea.call(chatInput);
    pendingImages = [];
    renderImagePreviews();

    await chrome.runtime.sendMessage({
      type: 'addMessage',
      taskId: currentTaskId,
      message: messageText,
      images: images.length > 0 ? images : undefined
    });
  }

  // ============ RENDERING - TASK GRID ============

  function renderTaskGrid() {
    const filtered = agents.filter(a => {
      if (currentFilter === 'all') return true;
      return a.status === currentFilter;
    });

    // Remove existing cards (keep empty state)
    taskGrid.querySelectorAll('.task-card').forEach(c => c.remove());

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    for (const agent of filtered) {
      const card = createTaskCard(agent);
      taskGrid.appendChild(card);
    }
  }

  function createTaskCard(agent) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.taskId = agent.id;

    const lastMsg = agent.lastMessage;
    const lastMsgText = lastMsg
      ? (lastMsg.content || '').substring(0, 150) || '(tool calls)'
      : 'No messages yet';

    card.innerHTML = `
      <div class="task-card-header">
        <div class="task-card-name">${escapeHtml(agent.name)}</div>
        <span class="status-badge ${agent.status}">${agent.status}</span>
      </div>
      <div class="task-card-body">
        <div class="task-card-message">${escapeHtml(lastMsgText)}</div>
      </div>
      <div class="task-card-footer">
        <div class="task-card-meta">
          <span class="task-card-model">${escapeHtml(agent.model)}</span>
          <span>${agent.messageCount} msgs</span>
        </div>
        <span>${timeAgo(agent.updatedAt)}</span>
      </div>
    `;

    card.addEventListener('click', () => openTaskDetail(agent.id));
    return card;
  }

  function updateAgentStatus(taskId, status, extra) {
    const idx = agents.findIndex(a => a.id === taskId);
    if (idx >= 0) {
      agents[idx].status = status;
      if (extra?.error) agents[idx].error = extra.error;
    }
    renderTaskGrid();

    if (taskId === currentTaskId && currentView === 'detail') {
      const badge = $('#detailTaskStatus');
      badge.textContent = status;
      badge.className = `status-badge ${status}`;

      if (status === 'completed') {
        appendSystemMessage(extra?.summary ? `Task completed: ${extra.summary}` : 'Task completed', 'success');
      } else if (status === 'error') {
        appendSystemMessage(`Error: ${extra?.error || 'Unknown error'}`, 'error');
      } else if (status === 'stopped') {
        appendSystemMessage('Task stopped', 'warning');
      }
    }
  }

  function updateAgentInList(taskId) {
    // Refresh agent data
    chrome.runtime.sendMessage({ type: 'getAgent', taskId }).then(res => {
      if (res?.success) {
        const idx = agents.findIndex(a => a.id === taskId);
        if (idx >= 0) {
          agents[idx] = {
            ...agents[idx],
            messageCount: res.agent.messageCount,
            updatedAt: res.agent.updatedAt,
            lastMessage: res.agent.displayMessages?.[res.agent.displayMessages.length - 1]
          };
        }
        renderTaskGrid();
      }
    });
  }

  // ============ RENDERING - TASK DETAIL ============

  function openTaskDetail(taskId) {
    currentTaskId = taskId;
    currentView = 'detail';
    streamingContent = '';
    streamingThinking = '';
    isStreaming = false;

    taskGridView.classList.remove('active');
    taskDetailView.classList.add('active');

    const agent = agents.find(a => a.id === taskId);
    if (agent) {
      $('#detailTaskName').textContent = agent.name;
      const badge = $('#detailTaskStatus');
      badge.textContent = agent.status;
      badge.className = `status-badge ${agent.status}`;

      // Show/hide stop button based on status
      $('#btnStopTask').style.display = agent.status === 'running' ? '' : 'none';

      // Seed token bar from stored totals
      updateTokenBar(agent.tokens || { prompt: 0, completion: 0, total: 0, cost: 0 });
    }

    // Load messages
    chatMessages.innerHTML = '';
    connectTaskPort(taskId);

    // Also load via message API
    chrome.runtime.sendMessage({ type: 'getAgentMessages', taskId }).then(res => {
      if (res?.success) {
        renderChatHistory(res.messages);
      }
    });

    chatInput.focus();
  }

  function showGridView() {
    currentView = 'grid';
    currentTaskId = null;

    taskDetailView.classList.remove('active');
    taskGridView.classList.add('active');

    if (taskPort) {
      taskPort.disconnect();
      taskPort = null;
    }

    loadAgents();
  }

  function renderChatHistory(messages) {
    chatMessages.innerHTML = '';
    for (const msg of messages) {
      appendChatMessage(msg, false);
    }
    scrollChatToBottom();
  }

  function appendChatMessage(msg, scroll = true) {
    // Finish any streaming message first
    finishStreamingMessage();

    const div = document.createElement('div');

    if (msg.role === 'user') {
      div.className = 'chat-message user';
      const textNode = document.createTextNode(msg.content);
      div.appendChild(textNode);
      // Show any attached images below the text
      if (msg.images && msg.images.length > 0) {
        const imgRow = document.createElement('div');
        imgRow.className = 'user-images';
        for (const src of msg.images) {
          const img = document.createElement('img');
          img.src = src;
          img.alt = 'Attached image';
          img.addEventListener('click', () => window.open(src));
          imgRow.appendChild(img);
        }
        div.appendChild(imgRow);
      }
    } else if (msg.role === 'assistant') {
      div.className = 'chat-message assistant';

      let html = '';

      // Thinking block
      if (msg.thinking) {
        html += `<div class="thinking-inline"><span class="thinking-label">thinking:</span>${escapeHtml(msg.thinking)}</div>`;
      }

      // Content
      if (msg.content) {
        html += renderMarkdown(msg.content);
      }

      // Tool calls
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const argsFormatted = formatToolArgs(tc.function.arguments);
          const screenshotSrc = msg.toolScreenshotData?.[tc.id];
          const hasOutput = !!screenshotSrc;
          const thumbHtml = screenshotSrc
            ? `<img class="tool-thumb" src="${screenshotSrc}" alt="Screenshot">`
            : '';
          const bodyHtml = hasOutput
            ? `<div class="tci-body"><img class="tci-body-img" src="${screenshotSrc}" alt="Screenshot"></div>`
            : '';
          html += `<div class="tci-wrap${hasOutput ? ' has-output' : ''}" data-call-id="${tc.id}"><div class="tci-row"><span class="tci-name">${escapeHtml(tc.function.name)}</span><span class="tci-colon">:</span><span class="tci-args">${escapeHtml(argsFormatted)}</span>${thumbHtml}</div>${bodyHtml}</div>`;
        }
      }

      div.innerHTML = html;

      // Move token badge into last .tci-row so it stays on the same line
      if (msg.usage) {
        const parts = [`↑${fmtTokens(msg.usage.prompt_tokens)} ↓${fmtTokens(msg.usage.completion_tokens)}`];
        if (msg.usage.cost > 0) parts.push(`$${msg.usage.cost.toFixed(5)}`);
        const badge = document.createElement('span');
        badge.className = 'msg-token-badge';
        badge.textContent = parts.join(' · ');
        const rows = div.querySelectorAll('.tci-row');
        const lastRow = rows[rows.length - 1];
        (lastRow || div).appendChild(badge);
      }
    }

    chatMessages.appendChild(div);
    if (scroll) scrollChatToBottom();
  }

  function appendToolCall(toolCall) {
    let argsStr = '';
    try {
      const args = JSON.parse(toolCall.function.arguments);
      argsStr = JSON.stringify(args, null, 2);
    } catch {
      argsStr = toolCall.function.arguments;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'tool-call-standalone';
    wrapper.innerHTML = `
      <div class="tool-call" data-call-id="${toolCall.id}">
        <div class="tool-call-summary">
          <svg class="tool-call-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
          <span class="tool-call-name">${escapeHtml(toolCall.function.name)}</span>
          <span class="tool-call-status" id="status-${toolCall.id}">executing…</span>
          <svg class="tool-call-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="tool-call-details">
          <div class="tool-call-args">${escapeHtml(argsStr)}</div>
          <div class="tool-result" id="result-${toolCall.id}">⏳ Executing...</div>
        </div>
      </div>
    `;
    chatMessages.appendChild(wrapper);
    scrollChatToBottom();
  }

  function updateToolCallStatus(callId, status, tool, args) {
    // no-op — status shown via result
  }

  function updateToolCallResult(callId, result, tool) {
    const isSuccess = result.success !== false;
    const wrap = chatMessages.querySelector(`.tci-wrap[data-call-id="${callId}"]`);
    if (!wrap) return;

    const body = wrap.querySelector('.tci-body');
    const row = wrap.querySelector('.tci-row');

    if (tool === 'screenshot' && result.screenshot) {
      // Thumbnail in the row
      const thumb = document.createElement('img');
      thumb.className = 'tool-thumb';
      thumb.src = result.screenshot;
      thumb.alt = 'Screenshot';
      row.appendChild(thumb);
      // Full image in the body
      const fullImg = document.createElement('img');
      fullImg.className = 'tci-body-img';
      fullImg.src = result.screenshot;
      fullImg.alt = 'Screenshot';
      body.appendChild(fullImg);
      wrap.classList.add('has-output');
    } else if (result.message || !isSuccess) {
      const text = isSuccess ? result.message : (result.error || 'Failed');
      const textEl = document.createElement('div');
      textEl.className = `tci-body-text${isSuccess ? '' : ' error'}`;
      textEl.textContent = text;
      body.appendChild(textEl);
      wrap.classList.add('has-output');
    }

    scrollChatToBottom();
  }

  function appendSystemMessage(text, type = 'info') {
    const div = document.createElement('div');
    div.className = 'chat-message system-msg';
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
    div.textContent = `${icons[type] || ''} ${text}`;
    chatMessages.appendChild(div);
    scrollChatToBottom();
  }

  // ============ TOKEN BAR ============

  function updateTokenBar(totals) {
    if (!totals) return;
    $('#tokenIn').textContent = fmtTokens(totals.prompt || 0);
    $('#tokenOut').textContent = fmtTokens(totals.completion || 0);
    const costEl = $('#tokenCost');
    if (totals.cost > 0) {
      costEl.style.display = '';
      costEl.textContent = `$${totals.cost.toFixed(5)}`;
    } else {
      costEl.style.display = 'none';
    }
  }

  /** Append a small token usage badge to an assistant message element */
  function appendTokenBadge(el, usage) {
    if (!usage) return;
    const badge = document.createElement('div');
    badge.className = 'msg-token-badge';
    const parts = [`↑${fmtTokens(usage.prompt_tokens)} ↓${fmtTokens(usage.completion_tokens)}`];
    if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(5)}`);
    badge.textContent = parts.join(' · ');
    el.appendChild(badge);
  }

  function fmtTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  // ============ STREAMING MESSAGE ============

  function updateStreamingMessage() {
    let streamEl = chatMessages.querySelector('.streaming-message');

    if (!streamEl) {
      streamEl = document.createElement('div');
      streamEl.className = 'chat-message assistant streaming-message';
      chatMessages.appendChild(streamEl);
    }

    let html = '';

    if (streamingThinking) {
      html += `<div class="thinking-inline"><span class="thinking-label">thinking:</span>${escapeHtml(streamingThinking)}</div>`;
    }

    if (streamingContent) {
      html += renderMarkdown(streamingContent);
    }

    html += '<div class="streaming-indicator"><span></span><span></span><span></span></div>';

    streamEl.innerHTML = html;
    scrollChatToBottom();
  }

  function finishStreamingMessage() {
    const streamEl = chatMessages.querySelector('.streaming-message');
    if (streamEl) {
      streamEl.remove();
      streamingContent = '';
      streamingThinking = '';
      isStreaming = false;
    }
  }

  // ============ MODALS ============

  function openNewTaskModal() {
    newTaskModal.classList.add('active');
    $('#taskName').value = '';
    $('#taskMessage').value = '';
    // Reset skills section
    $('#skillAutoMode').checked = true;
    $('#skillCheckboxes').classList.remove('visible');
    $('.skill-auto-hint').style.display = '';
    renderSkillCheckboxes();
    loadModels();
    $('#taskName').focus();
  }

  function closeNewTaskModal() {
    newTaskModal.classList.remove('active');
  }

  async function openSettingsModal() {
    await loadSettings();
    settingsModal.classList.add('active');
  }

  function closeSettingsModal() {
    settingsModal.classList.remove('active');
  }

  async function saveSettings() {
    const settings = {
      ollamaBaseUrl: $('#settOllamaUrl').value.trim() || 'http://localhost:11434',
      openrouterApiKey: $('#settOpenRouterKey').value.trim(),
      defaultProvider: $('#settDefaultProvider').value
    };

    await chrome.runtime.sendMessage({ type: 'saveSettings', settings });
    closeSettingsModal();
  }

  // ============ UTILITIES ============

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return '';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  function autoResizeTextarea() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  }

  function formatToolArgs(rawArgs) {
    try {
      const args = typeof rawArgs === 'object' && rawArgs !== null
        ? rawArgs
        : JSON.parse(rawArgs);
      return Object.entries(args)
        .map(([k, v]) => {
          const val = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
          return `${k}: ${val}`;
        })
        .join('   ');
    } catch {
      return String(rawArgs || '');
    }
  }

  function initScreenshotModal() {
    const modal = document.createElement('div');
    modal.id = 'screenshotModal';
    modal.className = 'screenshot-modal';
    const img = document.createElement('img');
    img.id = 'screenshotModalImg';
    img.alt = 'Screenshot preview';
    modal.appendChild(img);
    modal.addEventListener('click', () => modal.classList.remove('active'));
    document.body.appendChild(modal);
  }

  function openScreenshotModal(src) {
    const modal = document.getElementById('screenshotModal');
    const img = document.getElementById('screenshotModalImg');
    if (modal && img) {
      img.src = src;
      modal.classList.add('active');
    }
  }

  // ============ START ============
  init();

  // ============ SKILLS ============

  async function loadSkills() {
    const res = await chrome.runtime.sendMessage({ type: 'getSkills' });
    if (res?.success) {
      skills = res.skills || [];
      renderSkillsRow();
    }
  }

  function renderSkillsRow() {
    const container = $('#skillsContainer');
    container.innerHTML = '';

    if (skills.length === 0) {
      container.innerHTML = '<div class="skills-empty">No skills yet — add one to give agents domain knowledge.</div>';
      return;
    }

    for (const skill of skills) {
      const card = document.createElement('div');
      card.className = 'skill-card';

      const info = document.createElement('div');
      info.className = 'skill-card-info';
      info.innerHTML = `
        <div class="skill-card-name">${escapeHtml(skill.name)}</div>
        ${skill.domain ? `<span class="skill-domain-chip">${escapeHtml(skill.domain)}</span>` : ''}
      `;

      const actions = document.createElement('div');
      actions.className = 'skill-card-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'skill-card-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openSkillModal(skill.id));

      actions.appendChild(editBtn);

      if (skill.bundled && skill.modified) {
        const resetBtn = document.createElement('button');
        resetBtn.className = 'skill-card-btn reset';
        resetBtn.textContent = 'Reset';
        resetBtn.addEventListener('click', (e) => { e.stopPropagation(); confirmResetSkill(skill.id); });
        actions.appendChild(resetBtn);
      }

      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    }
  }

  function renderSkillCheckboxes() {
    const container = $('#skillCheckboxes');
    container.innerHTML = '';
    if (skills.length === 0) {
      container.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">No skills available.</div>';
      return;
    }
    for (const skill of skills) {
      const label = document.createElement('label');
      label.className = 'skill-checkbox-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = skill.id;
      cb.checked = true;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = skill.name;

      label.appendChild(cb);
      label.appendChild(nameSpan);

      if (skill.domain) {
        const domainSpan = document.createElement('span');
        domainSpan.className = 'skill-checkbox-domain';
        domainSpan.textContent = skill.domain;
        label.appendChild(domainSpan);
      }

      container.appendChild(label);
    }
  }

  // ── Skill viewer / editor modal ───────────────────────────────────────────

  function openSkillModal(skillId) {
    const skill = skills.find(s => s.id === skillId);
    if (!skill) return;
    editingSkillId = skillId;

    $('#skillModalTitle').textContent = skill.name;
    const domainBadge = $('#skillModalDomain');
    domainBadge.textContent = skill.domain || '';
    domainBadge.style.display = skill.domain ? '' : 'none';

    const modifiedBadge = $('#skillModalModifiedBadge');
    modifiedBadge.style.display = (skill.bundled && skill.modified) ? '' : 'none';

    $('#skillModalContent').value = skill.rawContent || '';

    // Reset button: only for bundled+modified
    $('#btnResetSkill').style.display = (skill.bundled && skill.modified) ? '' : 'none';
    // Delete button: only for non-bundled (custom) skills
    $('#btnDeleteSkill').style.display = !skill.bundled ? '' : 'none';

    $('#skillModal').classList.add('active');
    $('#skillModalContent').focus();
  }

  function closeSkillModal() {
    $('#skillModal').classList.remove('active');
    editingSkillId = null;
  }

  async function saveCurrentSkill() {
    if (!editingSkillId) return;
    const content = $('#skillModalContent').value;
    const res = await chrome.runtime.sendMessage({ type: 'saveSkill', id: editingSkillId, content });
    if (res?.success) {
      closeSkillModal();
      await loadSkills();
    } else {
      alert('Failed to save skill: ' + (res?.error || 'Unknown error'));
    }
  }

  async function resetCurrentSkill() {
    if (!editingSkillId) return;
    if (!confirm('Reset this skill to its default content? Your changes will be lost.')) return;
    const res = await chrome.runtime.sendMessage({ type: 'resetSkill', id: editingSkillId });
    if (res?.success) {
      closeSkillModal();
      await loadSkills();
    }
  }

  async function confirmResetSkill(skillId) {
    if (!confirm('Reset this skill to its default content?')) return;
    const res = await chrome.runtime.sendMessage({ type: 'resetSkill', id: skillId });
    if (res?.success) await loadSkills();
  }

  async function deleteCurrentSkill() {
    if (!editingSkillId) return;
    if (!confirm('Delete this skill permanently?')) return;
    const res = await chrome.runtime.sendMessage({ type: 'deleteSkill', id: editingSkillId });
    if (res?.success) {
      closeSkillModal();
      await loadSkills();
    } else {
      alert('Failed to delete: ' + (res?.error || 'Unknown error'));
    }
  }

  // ── Create skill modal ────────────────────────────────────────────────────

  function openCreateSkillModal(taskId) {
    $('#newSkillName').value = '';
    $('#newSkillDomain').value = '';
    $('#newSkillDescription').value = '';
    $('#newSkillContent').value = '';
    $('#generateSkillStatus').textContent = '';

    // Pre-fill name from task if available
    if (taskId) {
      const agent = agents.find(a => a.id === taskId);
      if (agent) $('#newSkillName').value = agent.name;
    }

    // Show generate button only when opened from a task detail
    const generateBtn = $('#btnGenerateSkill');
    generateBtn.style.display = taskId ? '' : 'none';
    generateBtn.dataset.taskId = taskId || '';

    $('#createSkillModal').classList.add('active');
    $('#newSkillName').focus();
  }

  function closeCreateSkillModal() {
    $('#createSkillModal').classList.remove('active');
  }

  async function saveNewSkill() {
    const name = $('#newSkillName').value.trim();
    if (!name) { alert('Please enter a skill name.'); return; }

    const domain = $('#newSkillDomain').value.trim();
    const description = $('#newSkillDescription').value.trim();
    const body = $('#newSkillContent').value.trim();

    // Build full file content
    let content = `name: ${name}\n`;
    if (domain)      content += `domain: ${domain}\n`;
    if (description) content += `description: ${description}\n`;
    content += `version: 1.0\n---\n${body}`;

    // Generate a unique ID from the name
    const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'skill';
    const id = skills.some(s => s.id === baseId) ? `${baseId}_${Date.now()}` : baseId;

    const res = await chrome.runtime.sendMessage({ type: 'createSkill', id, content });
    if (res?.success) {
      closeCreateSkillModal();
      await loadSkills();
    } else {
      alert('Failed to create skill: ' + (res?.error || 'Unknown error'));
    }
  }

  async function generateSkillFromConversation() {
    const taskId = $('#btnGenerateSkill').dataset.taskId;
    if (!taskId) return;

    const btn = $('#btnGenerateSkill');
    const status = $('#generateSkillStatus');
    btn.disabled = true;
    status.textContent = 'Generating…';

    const res = await chrome.runtime.sendMessage({ type: 'generateSkillFromChat', taskId });

    btn.disabled = false;
    if (res?.success && res.content) {
      status.textContent = 'Done!';
      setTimeout(() => { status.textContent = ''; }, 3000);

      // Parse the generated content and fill form fields
      const lines = res.content.split('\n');
      const meta = {};
      let bodyStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '---') { bodyStart = i + 1; break; }
        const ci = lines[i].indexOf(':');
        if (ci > 0) {
          const k = lines[i].slice(0, ci).trim().toLowerCase();
          const v = lines[i].slice(ci + 1).trim();
          if (['name', 'domain', 'description'].includes(k)) meta[k] = v;
        }
      }

      if (meta.name)        $('#newSkillName').value = meta.name;
      if (meta.domain)      $('#newSkillDomain').value = meta.domain;
      if (meta.description) $('#newSkillDescription').value = meta.description;
      $('#newSkillContent').value = lines.slice(bodyStart).join('\n').trim();
    } else {
      status.textContent = 'Failed: ' + (res?.error || 'Unknown error');
    }
  }
})();
