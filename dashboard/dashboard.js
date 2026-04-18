// Dashboard JavaScript - Main UI logic
// Handles task management, chat, streaming, and settings

(() => {
  // ============ STATE ============
  let currentView = 'grid'; // 'grid' | 'detail'
  let currentTaskId = null;
  let currentFilter = 'all';
  let agents = [];
  let dashboardPort = null;
  let taskPort = null;
  let streamingContent = '';
  let streamingThinking = '';
  let isStreaming = false;
  let pendingImages = []; // { dataUrl, name } — images to attach to the next sent message

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

  // ============ MODEL PICKER CONTROLLER (shared by New Task & Create Skill) ============

  class ModelPickerController {
    constructor(opts) {
      this.providerTabsEl = $(opts.providerTabs);
      this.modelSelectEl = $(opts.modelSelect);
      this.orPickerEl = $(opts.orPicker);
      this.orTriggerEl = $(opts.orTrigger);
      this.orLabelEl = $(opts.orLabel);
      this.orDropdownEl = $(opts.orDropdown);
      this.orSearchEl = $(opts.orSearch);
      this.orListEl = $(opts.orList);
      this.reasoningSelectorEl = $(opts.reasoningSelector);

      this.selectedProvider = 'ollama';
      this.orAllModels = [];
      this.orSelectedModel = '';
      this.orPickerOpen = false;
      this.selectedReasoningEffort = opts.defaultReasoning || 'low';

      this._setupListeners();
    }

    _setupListeners() {
      // Provider tabs
      if (this.providerTabsEl) {
        this.providerTabsEl.querySelectorAll('.provider-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            this.providerTabsEl.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            this.selectedProvider = tab.dataset.provider;
            this.loadModels();
          });
        });
      }

      // Reasoning buttons
      if (this.reasoningSelectorEl) {
        this.reasoningSelectorEl.querySelectorAll('.reasoning-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            this.reasoningSelectorEl.querySelectorAll('.reasoning-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedReasoningEffort = btn.dataset.value;
          });
        });
      }

      // OpenRouter picker
      if (this.orTriggerEl) {
        this.orTriggerEl.addEventListener('click', () => {
          if (this.orPickerOpen) this._closeOrPicker(); else this._openOrPicker();
        });
        this.orTriggerEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._openOrPicker(); }
          if (e.key === 'Escape') this._closeOrPicker();
        });
      }
      if (this.orSearchEl) {
        this.orSearchEl.addEventListener('input', (e) => this._renderOrList(e.target.value));
        this.orSearchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._closeOrPicker(); });
      }
      // Close on outside click
      document.addEventListener('click', (e) => {
        if (this.orPickerOpen && this.orPickerEl && !this.orPickerEl.contains(e.target)) {
          this._closeOrPicker();
        }
      });
    }

    setProvider(provider) {
      this.selectedProvider = provider;
      if (this.providerTabsEl) {
        this.providerTabsEl.querySelectorAll('.provider-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.provider === provider);
        });
      }
    }

    getModel() {
      return this.selectedProvider === 'openrouter' ? this.orSelectedModel : this.modelSelectEl?.value || '';
    }

    getProvider() {
      return this.selectedProvider;
    }

    getReasoning() {
      return this.selectedReasoningEffort;
    }

    async loadModels() {
      const isOR = this.selectedProvider === 'openrouter';
      if (this.modelSelectEl) this.modelSelectEl.style.display = isOR ? 'none' : '';
      if (this.orPickerEl) this.orPickerEl.style.display = isOR ? '' : 'none';

      if (!isOR) {
        if (this.modelSelectEl) this.modelSelectEl.innerHTML = '<option value="">Loading models…</option>';
        const response = await chrome.runtime.sendMessage({ type: 'getOllamaModels' });
        if (response?.success && response.models.length > 0 && this.modelSelectEl) {
          this.modelSelectEl.innerHTML = '';
          for (const model of response.models) {
            const opt = document.createElement('option');
            opt.value = model.name;
            opt.textContent = `${model.name} (${formatBytes(model.size)})`;
            this.modelSelectEl.appendChild(opt);
          }
        } else {
          if (this.modelSelectEl) this.modelSelectEl.innerHTML = '<option value="">No models found – check Ollama</option>';
        }
      } else {
        this._setOrLabel('Loading models…');
        const response = await chrome.runtime.sendMessage({ type: 'getOpenRouterModels' });
        if (response?.success && response.models.length > 0) {
          this.orAllModels = response.models;
          this.orSelectedModel = '';
          this._setOrLabel('Select a model…');
          this._renderOrList('');
        } else {
          this.orAllModels = [];
          this._setOrLabel('No models found – check API key');
        }
      }
    }

    _setOrLabel(text) {
      if (this.orLabelEl) this.orLabelEl.textContent = text;
    }

    _openOrPicker() {
      this.orPickerOpen = true;
      if (this.orDropdownEl) this.orDropdownEl.classList.add('open');
      if (this.orSearchEl) { this.orSearchEl.value = ''; this.orSearchEl.focus(); }
      this._renderOrList('');
    }

    _closeOrPicker() {
      this.orPickerOpen = false;
      if (this.orDropdownEl) this.orDropdownEl.classList.remove('open');
    }

    async _renderOrList(query) {
      if (!this.orListEl) return;
      this.orListEl.innerHTML = '';
      const q = query.toLowerCase().trim();
      const counts = await getModelUsageCounts();

      const favIds = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id)
        .filter(id => this.orAllModels.some(m => m.name === id))
        .slice(0, 5);

      const filtered = this.orAllModels.filter(m =>
        !q || m.name.toLowerCase().includes(q) || (m.displayName || '').toLowerCase().includes(q)
      );

      if (!q && favIds.length > 0) {
        const header = document.createElement('div');
        header.className = 'or-model-group-header';
        header.textContent = '★ Favourites';
        this.orListEl.appendChild(header);
        for (const id of favIds) {
          const m = this.orAllModels.find(x => x.name === id);
          if (m) this.orListEl.appendChild(this._buildOrOption(m, counts[id]));
        }
        if (filtered.length > 0) {
          const sep = document.createElement('div');
          sep.className = 'or-model-group-header';
          sep.textContent = 'All Models';
          this.orListEl.appendChild(sep);
        }
      }

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'or-model-empty';
        empty.textContent = 'No models match your search';
        this.orListEl.appendChild(empty);
        return;
      }

      for (const m of filtered) {
        this.orListEl.appendChild(this._buildOrOption(m, counts[m.name]));
      }
    }

    _buildOrOption(model, usageCount) {
      const item = document.createElement('div');
      item.className = 'or-model-option' + (model.name === this.orSelectedModel ? ' selected' : '');
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
        this.orSelectedModel = model.name;
        this._setOrLabel(model.displayName || model.name);
        this._closeOrPicker();
      });

      return item;
    }
  }

  // Instantiate model pickers
  const taskPicker = new ModelPickerController({
    providerTabs: '.modal-col-left .provider-tabs',
    modelSelect: '#modelSelect',
    orPicker: '#orModelPicker',
    orTrigger: '#orModelTrigger',
    orLabel: '#orModelLabel',
    orDropdown: '#orModelDropdown',
    orSearch: '#orModelSearch',
    orList: '#orModelList',
    reasoningSelector: '#reasoningSelector',
    defaultReasoning: 'low'
  });

  const skillPicker = new ModelPickerController({
    providerTabs: '#csProviderTabs',
    modelSelect: '#csModelSelect',
    orPicker: '#csOrModelPicker',
    orTrigger: '#csOrModelTrigger',
    orLabel: '#csOrModelLabel',
    orDropdown: '#csOrModelDropdown',
    orSearch: '#csOrModelSearch',
    orList: '#csOrModelList',
    reasoningSelector: '#csReasoningSelector',
    defaultReasoning: 'medium'
  });

  // ============ INITIALIZATION ============

  async function init() {
    initScreenshotModal();
    setupEventListeners();
    await loadSettings();
    await loadSkills();
    await loadSchedules();
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

    // Provider tabs — handled by ModelPickerController instances

    // Filter buttons
    $$('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTaskGrid();
      });
    });

    // Refresh models (uses taskPicker)
    $('#btnRefreshModels').addEventListener('click', () => taskPicker.loadModels());

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
    $('#btnGenerateSkillAI').addEventListener('click', generateSkillWithAI);
    $('#btnResetCsInstructions').addEventListener('click', () => loadDefaultSkillInstructions(true));
    $('#csAiToggle').addEventListener('click', toggleCsAiSection);

    // Script skill modal
    $('#btnAddScriptSkill').addEventListener('click', () => openCreateScriptSkillModal(null));
    $('#btnCloseCreateScript').addEventListener('click', closeCreateScriptSkillModal);
    $('#btnCancelCreateScript').addEventListener('click', closeCreateScriptSkillModal);
    $('#btnSaveCreateScript').addEventListener('click', saveNewScriptSkill);
    $('#btnGenerateScriptAI').addEventListener('click', generateScriptSkillWithAI);
    $('#btnResetSsInstructions').addEventListener('click', () => loadScriptSkillInstructions(true));
    $('#ssAiToggle').addEventListener('click', toggleSsAiSection);
    $('#ssJsonEditor').addEventListener('input', debounce(previewScriptSkillDiagram, 500));

    // Run skill modal
    $('#btnCloseRunSkill').addEventListener('click', closeRunSkillModal);
    $('#btnCancelRunSkill').addEventListener('click', closeRunSkillModal);
    $('#btnConfirmRunSkill').addEventListener('click', confirmRunSkill);

    // Skill auto-mode toggle in new task modal
    $('#skillAutoMode').addEventListener('change', () => {
      const manual = !$('#skillAutoMode').checked;
      $('#skillCheckboxes').classList.toggle('visible', manual);
      $('.skill-auto-hint').style.display = manual ? 'none' : '';
    });

    // Save as skill (task detail header) — opens JSON script skill modal with conversation context
    $('#btnSaveAsSkill').addEventListener('click', () => openCreateScriptSkillModal(currentTaskId));

    // Schedule modal
    $('#btnAddSchedule').addEventListener('click', () => openScheduleModal(null));
    $('#btnCloseSchedule').addEventListener('click', closeScheduleModal);
    $('#btnCancelSchedule').addEventListener('click', closeScheduleModal);
    $('#btnSaveSchedule').addEventListener('click', saveSchedule);
    $('#schedRepeat').addEventListener('change', updateScheduleRepeatUI);

    // Close modals on overlay click — newTaskModal excluded (X button / Cancel only)
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('active');
    });
    $('#skillModal').addEventListener('click', (e) => {
      if (e.target === $('#skillModal')) closeSkillModal();
    });
    // Create Skill modal intentionally does NOT close on outside click

    $('#scheduleModal').addEventListener('click', (e) => {
      if (e.target === $('#scheduleModal')) closeScheduleModal();
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
            const liveContainer = chatMessages.querySelector('.live-tool-container');
            if (liveContainer && msg.message.tool_calls) {
              // Tool calls are already live in the DOM with feedback —
              // merge text/thinking into the container instead of duplicating
              finishStreamingMessage();
              let preHtml = '';
              if (msg.message.thinking) {
                preHtml += `<div class="thinking-inline"><span class="thinking-label">thinking:</span>${escapeHtml(msg.message.thinking)}</div>`;
              }
              if (msg.message.content) {
                preHtml += renderMarkdown(msg.message.content);
              }
              if (preHtml) {
                liveContainer.insertAdjacentHTML('afterbegin', preHtml);
              }
              liveContainer.classList.remove('live-tool-container');
              // Token badge on last tci-row
              if (msg.message.usage) {
                const parts = [`↑${fmtTokens(msg.message.usage.prompt_tokens)} ↓${fmtTokens(msg.message.usage.completion_tokens)}`];
                if (msg.message.usage.cost > 0) parts.push(`$${msg.message.usage.cost.toFixed(5)}`);
                const badge = document.createElement('span');
                badge.className = 'msg-token-badge';
                badge.textContent = parts.join(' · ');
                const rows = liveContainer.querySelectorAll('.tci-row');
                const lastRow = rows[rows.length - 1];
                (lastRow || liveContainer).appendChild(badge);
              }
            } else {
              appendChatMessage(msg.message);
            }
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
        case 'plan_progress':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            updatePlanProgress(msg.callId, msg.event);
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
        case 'skill_script_start':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            appendSystemMessage(`Running skill script: **${msg.skill?.name}** (${msg.skill?.steps} steps)`, 'info');
          }
          break;
        case 'skill_progress':
          if (msg.taskId === currentTaskId && currentView === 'detail') {
            handleSkillProgressEvent(msg.event);
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

      // Set both pickers to the default provider
      taskPicker.setProvider(s.defaultProvider);
      skillPicker.setProvider(s.defaultProvider);

      await taskPicker.loadModels();
    }
  }

  // ---- Shared model usage helpers ----

  async function getModelUsageCounts() {
    const data = await chrome.storage.local.get('modelUsageCounts');
    return data.modelUsageCounts || {};
  }

  async function incrementModelUsage(modelId) {
    const counts = await getModelUsageCounts();
    counts[modelId] = (counts[modelId] || 0) + 1;
    await chrome.storage.local.set({ modelUsageCounts: counts });
  }

  // ============ TASK MANAGEMENT ============

  async function createAndStartTask() {
    const name = $('#taskName').value.trim();
    const model = taskPicker.getModel();
    const message = $('#taskMessage').value.trim();

    if (!name) { alert('Please enter a task name'); return; }
    if (!model) { alert('Please select a model'); return; }
    if (!message) { alert('Please describe the task'); return; }

    // Track model usage for favourites
    if (taskPicker.getProvider() === 'openrouter') {
      incrementModelUsage(model);
    }

    const config = {
      name,
      provider: taskPicker.getProvider(),
      model,
      reasoningEffort: taskPicker.getReasoning(),
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
          const argsFormatted = _formatToolCallHeader(tc.function.name, tc.function.arguments);
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
    const fnName = toolCall.function.name;
    const argsFormatted = _formatToolCallHeader(fnName, toolCall.function.arguments);

    // Group all live tool calls into a single assistant message container
    let container = chatMessages.querySelector('.live-tool-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'chat-message assistant live-tool-container';
      chatMessages.appendChild(container);
    }

    container.insertAdjacentHTML('beforeend',
      `<div class="tci-wrap" data-call-id="${toolCall.id}">` +
      `<div class="tci-row">` +
        `<span class="tci-exec-icon"></span>` +
        `<span class="tci-name">${escapeHtml(fnName)}</span>` +
        `<span class="tci-status">executing…</span>` +
        `<span class="tci-args">${escapeHtml(argsFormatted)}</span>` +
      `</div>` +
      `<div class="tci-body"></div>` +
    `</div>`);
    scrollChatToBottom();
  }

  /** Build a readable one-line summary for tool call args */
  function _formatToolCallHeader(fnName, rawArgs) {
    let args;
    try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; } catch { return String(rawArgs || ''); }
    if (!args || typeof args !== 'object') return '';

    if (fnName === 'execute_steps' && args.plan) {
      const sections = args.plan;
      const totalSteps = sections.reduce((n, s) => n + (s.steps?.length || 0), 0);
      const names = sections.map(s => s.section).join(' → ');
      return `${sections.length} section${sections.length > 1 ? 's' : ''}, ${totalSteps} steps: ${names}`;
    }

    return formatToolArgs(rawArgs);
  }

  function updateToolCallStatus(callId, status, tool, args) {
    // no-op — status shown via result
  }

  function updateToolCallResult(callId, result, tool) {
    const isSuccess = result.success !== false;
    const wrap = chatMessages.querySelector(`.tci-wrap[data-call-id="${callId}"]`);
    if (!wrap) return;

    // Remove executing indicator, show result status
    const statusEl = wrap.querySelector('.tci-status');
    if (statusEl) {
      statusEl.textContent = isSuccess ? '' : 'failed';
      statusEl.className = 'tci-status' + (isSuccess ? '' : ' error');
    }
    const execIcon = wrap.querySelector('.tci-exec-icon');
    if (execIcon) execIcon.remove();

    // Add result token badge
    const nameEl = wrap.querySelector('.tci-name');
    if (nameEl && isSuccess) {
      nameEl.classList.add('done');
    }

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
    } else if (tool === 'execute_steps' && result.sections) {
      // Render full plan result as section/step breakdown
      const planEl = document.createElement('div');
      planEl.className = 'plan-result';
      for (const section of result.sections) {
        const secEl = document.createElement('div');
        secEl.className = `plan-section ${section.completed ? 'done' : 'failed'}`;
        secEl.innerHTML = `<div class="plan-section-title">${section.completed ? '✅' : '❌'} ${escapeHtml(section.section)}</div>`;
        const stepsEl = document.createElement('div');
        stepsEl.className = 'plan-steps';
        for (const step of section.steps) {
          const stepEl = document.createElement('div');
          stepEl.className = `plan-step ${step.success ? 'done' : 'failed'}`;
          let stepText = `${step.success ? '✓' : '✗'} ${step.tool}${step.message ? ' — ' + step.message : ''}`;
          stepEl.textContent = stepText;

          // Show page changes inline
          if (step.pageChanges) {
            const changesEl = _renderPageChanges(step.pageChanges);
            stepEl.appendChild(changesEl);
          }

          // Show verification results
          if (step.verify && step.verify.results) {
            const verifyEl = _renderVerifyResults(step.verify);
            stepEl.appendChild(verifyEl);
          }

          stepsEl.appendChild(stepEl);
        }
        secEl.appendChild(stepsEl);
        planEl.appendChild(secEl);
      }
      // Show remaining sections if plan failed
      if (result.remaining && result.remaining.length > 0) {
        const remEl = document.createElement('div');
        remEl.className = 'plan-remaining';
        remEl.innerHTML = '<div class="plan-remaining-title">⏭ Remaining (not executed)</div>';
        for (const rem of result.remaining) {
          const rEl = document.createElement('div');
          rEl.className = 'plan-remaining-section';
          rEl.textContent = `${rem.section}: ${rem.remainingSteps.join(', ')}`;
          remEl.appendChild(rEl);
        }
        planEl.appendChild(remEl);
      }
      body.appendChild(planEl);
      wrap.classList.add('has-output');
    } else {
      // Text-based result display
      if (result.message || !isSuccess) {
        const text = isSuccess ? result.message : (result.error || 'Failed');
        const textEl = document.createElement('div');
        textEl.className = `tci-body-text${isSuccess ? '' : ' error'}`;
        textEl.textContent = text;
        body.appendChild(textEl);
        wrap.classList.add('has-output');
      }

      // Show extract_content / extract_all_text results
      if (tool === 'extract_content' && result.content) {
        const contentEl = document.createElement('div');
        contentEl.className = 'tci-body-text tci-content-preview';
        const preview = result.content.length > 500 ? result.content.substring(0, 500) + '…' : result.content;
        contentEl.textContent = preview;
        body.appendChild(contentEl);
        wrap.classList.add('has-output');
      } else if (tool === 'extract_all_text' && result.text) {
        const textEl = document.createElement('div');
        textEl.className = 'tci-body-text tci-content-preview';
        const preview = result.text.length > 500 ? result.text.substring(0, 500) + '…' : result.text;
        textEl.textContent = preview;
        body.appendChild(textEl);
        wrap.classList.add('has-output');
      }

      // Show page changes for any action tool
      if (result.pageChanges) {
        const changesEl = _renderPageChanges(result.pageChanges);
        body.appendChild(changesEl);
        wrap.classList.add('has-output');
      }
    }

    scrollChatToBottom();
  }

  function _renderPageChanges(changes) {
    const el = document.createElement('div');
    el.className = 'page-changes';
    let html = '';
    if (changes.url) {
      html += `<div class="pc-row pc-url"><span class="pc-label">URL:</span> <span class="pc-from">${escapeHtml(changes.url.from)}</span> → <span class="pc-to">${escapeHtml(changes.url.to)}</span></div>`;
    }
    if (changes.title) {
      html += `<div class="pc-row pc-title"><span class="pc-label">Title:</span> <span class="pc-from">${escapeHtml(changes.title.from)}</span> → <span class="pc-to">${escapeHtml(changes.title.to)}</span></div>`;
    }
    if (changes.appeared && changes.appeared.length) {
      for (const item of changes.appeared) {
        const desc = item.text ? `${item.tag} — "${escapeHtml(item.text.substring(0, 60))}"` : item.tag;
        html += `<div class="pc-row pc-appeared"><span class="pc-badge pc-badge-new">+ appeared</span> <code>${escapeHtml(item.selector)}</code> <span class="pc-desc">${desc}</span></div>`;
      }
    }
    if (changes.disappeared && changes.disappeared.length) {
      for (const item of changes.disappeared) {
        const desc = item.text ? `${item.tag} — "${escapeHtml(item.text.substring(0, 60))}"` : item.tag;
        html += `<div class="pc-row pc-disappeared"><span class="pc-badge pc-badge-gone">− disappeared</span> <code>${escapeHtml(item.selector)}</code> <span class="pc-desc">${desc}</span></div>`;
      }
    }
    el.innerHTML = html;
    return el;
  }

  function _renderVerifyResults(verify) {
    const el = document.createElement('div');
    el.className = 'verify-results';
    let html = '';
    for (const r of (verify.results || [])) {
      const icon = r.passed ? '✓' : '✗';
      const cls = r.passed ? 'pass' : 'fail';
      let detail = r.check;
      if (r.expected) detail += ` = "${escapeHtml(r.expected)}"`;
      if (!r.passed && r.actual) detail += ` (got "${escapeHtml(r.actual.substring(0, 80))}")`;
      html += `<div class="vr-row vr-${cls}"><span class="vr-icon">${icon}</span> ${detail}</div>`;
    }
    el.innerHTML = html;
    return el;
  }

  // ============ PLAN PROGRESS (live updates for execute_steps) ============

  function updatePlanProgress(callId, event) {
    // Find or create the plan progress container inside the tool call wrapper
    let wrap = chatMessages.querySelector(`.tci-wrap[data-call-id="${callId}"]`);
    if (!wrap) return;

    let progressEl = wrap.querySelector('.plan-progress');
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'plan-progress';
      const body = wrap.querySelector('.tci-body');
      if (body) {
        body.appendChild(progressEl);
        wrap.classList.add('has-output');
        wrap.classList.add('open');
      }
    }

    switch (event.type) {
      case 'plan_start': {
        progressEl.innerHTML = '';
        for (const sec of event.plan) {
          const secEl = document.createElement('div');
          secEl.className = 'plan-progress-section pending';
          secEl.dataset.sectionIndex = event.plan.indexOf(sec);
          secEl.innerHTML = `<div class="plan-progress-section-title"><span class="plan-progress-icon">⏳</span> ${escapeHtml(sec.section)} <span class="plan-progress-count">(${sec.stepCount} steps)</span></div><div class="plan-progress-steps"></div>`;
          progressEl.appendChild(secEl);
        }
        break;
      }
      case 'section_start': {
        const secEl = progressEl.querySelectorAll('.plan-progress-section')[event.sectionIndex];
        if (secEl) {
          secEl.classList.remove('pending');
          secEl.classList.add('running');
          const icon = secEl.querySelector('.plan-progress-icon');
          if (icon) icon.textContent = '▶';
        }
        break;
      }
      case 'step_start': {
        const secEl = progressEl.querySelectorAll('.plan-progress-section')[event.sectionIndex];
        if (!secEl) break;
        const stepsContainer = secEl.querySelector('.plan-progress-steps');
        const stepEl = document.createElement('div');
        stepEl.className = 'plan-progress-step running';
        stepEl.dataset.stepIndex = event.stepIndex;
        const argsStr = event.args ? Object.entries(event.args).map(([k, v]) => {
          const val = typeof v === 'string' ? `"${v.length > 40 ? v.slice(0, 40) + '...' : v}"` : JSON.stringify(v);
          return `${k}: ${val}`;
        }).join('  ') : '';
        stepEl.innerHTML = `<span class="plan-step-icon">⏳</span> <span class="plan-step-tool">${escapeHtml(event.tool)}</span>${argsStr ? ' <span class="plan-step-args">' + escapeHtml(argsStr) + '</span>' : ''}`;
        stepsContainer.appendChild(stepEl);
        break;
      }
      case 'step_done': {
        const secEl = progressEl.querySelectorAll('.plan-progress-section')[event.sectionIndex];
        if (!secEl) break;
        const steps = secEl.querySelectorAll('.plan-progress-step');
        const stepEl = steps[event.stepIndex];
        if (stepEl) {
          stepEl.classList.remove('running');
          stepEl.classList.add('done');
          const icon = stepEl.querySelector('.plan-step-icon');
          if (icon) icon.textContent = '✓';
        }
        break;
      }
      case 'step_failed': {
        const secEl = progressEl.querySelectorAll('.plan-progress-section')[event.sectionIndex];
        if (!secEl) break;
        const steps = secEl.querySelectorAll('.plan-progress-step');
        const stepEl = steps[event.stepIndex];
        if (stepEl) {
          stepEl.classList.remove('running');
          stepEl.classList.add('failed');
          const icon = stepEl.querySelector('.plan-step-icon');
          if (icon) icon.textContent = '✗';
          if (event.error) {
            const errEl = document.createElement('span');
            errEl.className = 'plan-step-error';
            errEl.textContent = ` — ${event.error}`;
            stepEl.appendChild(errEl);
          }
        }
        break;
      }
      case 'section_done': {
        const secEl = progressEl.querySelectorAll('.plan-progress-section')[event.sectionIndex];
        if (secEl) {
          secEl.classList.remove('running');
          secEl.classList.add('done');
          const icon = secEl.querySelector('.plan-progress-icon');
          if (icon) icon.textContent = '✅';
        }
        break;
      }
      case 'plan_done': {
        // All sections completed — add a summary
        const summary = document.createElement('div');
        summary.className = 'plan-progress-summary done';
        summary.textContent = `✅ Plan completed — ${event.sectionsCompleted} sections executed`;
        progressEl.appendChild(summary);
        break;
      }
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
    taskPicker.loadModels();
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

  let scriptSkills = [];

  async function loadSkills() {
    const res = await chrome.runtime.sendMessage({ type: 'getSkills' });
    if (res?.success) {
      skills = res.skills || [];
    }
    const ssRes = await chrome.runtime.sendMessage({ type: 'getScriptSkills' });
    scriptSkills = ssRes?.success ? (ssRes.skills || []) : [];
    renderSkillsRow();
  }

  function renderSkillsRow() {
    const container = $('#skillsContainer');
    container.innerHTML = '';

    if (skills.length === 0 && scriptSkills.length === 0) {
      container.innerHTML = '<div class="skills-empty">No skills yet — add one to give agents domain knowledge.</div>';
      return;
    }

    // Prompt-based (.txt) skills
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

    // Script (.json) skills
    for (const ss of scriptSkills) {
      const card = document.createElement('div');
      card.className = 'skill-card skill-card-script';

      const info = document.createElement('div');
      info.className = 'skill-card-info';
      info.innerHTML = `
        <div class="skill-card-name">${escapeHtml(ss.name || ss._id)}</div>
        <span class="skill-type-chip">script</span>
        <span class="skill-summary-chip">${escapeHtml(ss._summary || '')}</span>
      `;

      const actions = document.createElement('div');
      actions.className = 'skill-card-actions';

      const runBtn = document.createElement('button');
      runBtn.className = 'skill-card-btn run';
      runBtn.textContent = 'Run';
      runBtn.addEventListener('click', () => openRunSkillModal(ss._id));
      actions.appendChild(runBtn);

      const editBtn = document.createElement('button');
      editBtn.className = 'skill-card-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEditScriptSkillModal(ss._id));
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'skill-card-btn delete';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete script skill "${ss.name || ss._id}"?`)) {
          await chrome.runtime.sendMessage({ type: 'deleteScriptSkill', id: ss._id });
          await loadSkills();
        }
      });
      actions.appendChild(delBtn);

      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    }
  }

  function renderSkillCheckboxes() {
    const container = $('#skillCheckboxes');
    container.innerHTML = '';
    const allItems = [
      ...skills.map(s => ({ id: s.id, name: s.name, domain: s.domain, type: 'txt' })),
      ...scriptSkills.map(s => ({ id: s._id, name: s.name || s._id, domain: '', type: 'json' })),
    ];
    if (allItems.length === 0) {
      container.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">No skills available.</div>';
      return;
    }
    for (const skill of allItems) {
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
      if (skill.type === 'json') {
        const chip = document.createElement('span');
        chip.className = 'skill-type-chip';
        chip.textContent = 'script';
        label.appendChild(chip);
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

  // Default instructions template (cached after first fetch)
  let cachedToolsInfo = null;
  let defaultSkillInstructions = '';

  function buildDefaultSkillInstructions(toolsInfo) {
    return `You are an expert browser automation skill creator.

Your job is to create a skill file that is essentially a PROGRAMMATIC SEQUENCE OF TOOL CALLS — the same tools the agent uses at runtime. A skill is a pre-planned, deterministic multi-tool-call recipe. The agent should be able to follow it step-by-step with minimal reasoning or improvisation.

CORE PRINCIPLE: A skill = a series of tool calls with exact parameters, written out so the agent can execute them nearly verbatim.

Each step in the skill body should map directly to one tool call. Write them like this:

  Step 1: navigate({ url: "https://example.com/login" })
  Step 2: wait_for_element({ selector: "#username", timeout: 5000 })
  Step 3: type_text({ selector: "#username", text: "{{username}}" })
  Step 4: type_text({ selector: "#password", text: "{{password}}" })
  Step 5: click({ selector: "#login-btn" })
  Step 6: wait_for_element({ selector: ".dashboard", timeout: 10000 })

Use {{placeholder}} for dynamic values the agent fills at runtime.

Include:
- Exact CSS selectors (be specific: prefer [data-testid], #id, or unique class paths)
- Exact tool name and parameters for each step
- wait / wait_for_element calls between steps that need them
- Conditional notes only where truly needed (e.g., "If element not found, try fallback selector X")
- Known gotchas: cookie banners, redirects, dynamic IDs, SPAs that need waits

Do NOT include vague instructions like "find the button and click it". Every step must name the tool and its arguments.

The output format:
name: Skill Name
domain: example.com
description: Brief description
version: 1.0
---
(Numbered tool-call steps below. One tool call per step. Use exact selectors and parameters.)

=== AVAILABLE TOOLS (use these exact names and parameters) ===
${toolsInfo}

=== END TOOLS ===

Generate the skill file based on the user's description. If conversation context is provided, extract the exact selectors and tool calls that worked.`;
  }

  function buildScriptSkillInstructions(toolsInfo) {
    return `You are an expert browser automation skill-script creator.

Your job: create a JSON skill script that automates browser tasks. Action steps execute directly (no AI cost). AI steps get full browser control and can click, type, navigate — like a real user.

=== OUTPUT FORMAT ===
Output ONLY valid JSON (no markdown fences, no explanation). The JSON must follow this structure:
{
  "name": "Skill Name",
  "description": "What this skill does",
  "inputs": [
    { "id": "paramName", "type": "text|url|number|select", "label": "User-facing label", "required": true }
  ],
  "steps": [ ... ]
}

=== STEP TYPES ===
1. "action" — Direct tool call, NO AI. Fields: id, type, label, tool, args
   - args can use {{input.X}} for user inputs and {{var.X}} for variables from previous steps
   - Cheapest step type — use for deterministic operations

2. "ai" — AI agent with full browser tool access + screenshot. Fields: id, type, label, prompt, saveAs
   - The AI sees a screenshot of the current page and can call ANY browser tool (click, type, navigate, etc.)
   - It runs a mini agent loop: think → use tools → think → finish with a text response
   - The final text response is saved to {{var.saveAs}}
   - Use for: interacting with complex/dynamic UIs, reading page content, adaptive workflows

3. "condition" — Deterministic branching. Fields: id, type, label, check, variable, value?, selector?, onTrue, onFalse
   - check types: "variable_not_empty", "variable_equals", "variable_contains", "url_contains", "element_exists"
   - onTrue/onFalse: "next" (continue), "end" (finish), "fail" (abort), or a step ID to jump to

=== KEY RULES ===

**Prefer URL navigation over form filling:**
- GOOD: navigate to "https://www.google.com/search?q=my+query&tbm=nws"
- BAD: navigate to google.com → find search box → type query → press enter
- GOOD: navigate to "https://x.com/compose/post"  
- BAD: navigate to x.com → find compose button → click it
- Apply this to Google, YouTube, Amazon, X/Twitter, Reddit, etc.

**Use AI steps for complex/dynamic interactions:**
- Sites like X/Twitter, Instagram etc. change their DOM frequently — don't hardcode selectors
- Instead, use an AI step: it sees the screenshot and uses tools to interact adaptively
- Example: composing and posting a tweet should be ONE ai step, not multiple action steps with fragile selectors

**Use action steps for simple deterministic operations:**
- Navigation to URLs, waiting, pressing keys, simple clicks on stable selectors
- JavaScript execution for reliable DOM operations

**Template variables:**
- {{input.X}} for user-provided inputs
- {{var.X}} for values saved by previous AI steps (saveAs)

**Error resilience:**
- Prefer fewer, smarter steps over many fragile ones
- Combine related interactions into a single AI step when selectors are unstable
- Add wait steps (2-4 seconds) after navigation for page rendering

=== EXAMPLE: Search and Post ===
{
  "name": "Search and Post to X",
  "description": "Search Google and post results to X",
  "inputs": [{ "id": "query", "type": "text", "label": "Search query", "required": true }],
  "steps": [
    { "id": "search", "type": "action", "label": "Google search", "tool": "navigate", "args": { "url": "https://www.google.com/search?q={{input.query}}" } },
    { "id": "wait", "type": "action", "label": "Wait for results", "tool": "wait", "args": { "seconds": 3 } },
    { "id": "extract", "type": "ai", "label": "Extract results", "prompt": "Extract the top 3 search result titles and URLs. Return a brief summary.", "saveAs": "results" },
    { "id": "goto_x", "type": "action", "label": "Open X", "tool": "navigate", "args": { "url": "https://x.com" } },
    { "id": "wait_x", "type": "action", "label": "Wait for X", "tool": "wait", "args": { "seconds": 3 } },
    { "id": "post", "type": "ai", "label": "Compose and post", "prompt": "Post a tweet with this content: {{var.results}}. Click the compose area, type the tweet, and click Post.", "saveAs": "postResult" }
  ]
}

=== AVAILABLE TOOLS ===
${toolsInfo}

=== END ===

Generate ONLY the JSON. Extract tool calls, selectors, and patterns from the conversation when available.`;
  }

  async function loadDefaultSkillInstructions(force) {
    if (!cachedToolsInfo || force) {
      const res = await chrome.runtime.sendMessage({ type: 'getToolsInfo' });
      cachedToolsInfo = res?.success ? res.toolsInfo : '(Failed to load tools)';
    }
    defaultSkillInstructions = buildDefaultSkillInstructions(cachedToolsInfo);
    $('#csInstructions').value = defaultSkillInstructions;
  }

  function toggleCsAiSection() {
    const body = $('#csAiBody');
    const chevron = $('#csAiToggle').querySelector('.cs-ai-chevron');
    const isOpen = body.classList.toggle('open');
    chevron.classList.toggle('open', isOpen);
    if (isOpen && !$('#csInstructions').value) {
      loadDefaultSkillInstructions(false);
      skillPicker.loadModels();
    }
  }

  function openCreateSkillModal(taskId) {
    $('#newSkillName').value = '';
    $('#newSkillDomain').value = '';
    $('#newSkillDescription').value = '';
    $('#newSkillContent').value = '';
    $('#generateSkillStatus').textContent = '';

    // Reset AI section to collapsed
    $('#csAiBody').classList.remove('open');
    $('#csAiToggle').querySelector('.cs-ai-chevron').classList.remove('open');

    // Pre-fill name from task if available
    if (taskId) {
      const agent = agents.find(a => a.id === taskId);
      if (agent) $('#newSkillName').value = agent.name;
    }

    // Store taskId so AI generation can include conversation context
    $('#btnGenerateSkillAI').dataset.taskId = taskId || '';

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

  async function generateSkillWithAI() {
    const model = skillPicker.getModel();
    if (!model) { alert('Please select a model'); return; }

    const instructions = $('#csInstructions').value.trim();
    if (!instructions) { alert('Instructions cannot be empty'); return; }

    const name = $('#newSkillName').value.trim();
    const domain = $('#newSkillDomain').value.trim();
    const description = $('#newSkillDescription').value.trim();
    const taskId = $('#btnGenerateSkillAI').dataset.taskId || '';

    if (!name && !domain && !description && !taskId) {
      alert('Please fill in at least a skill name or domain so the AI knows what to generate.');
      return;
    }

    const btn = $('#btnGenerateSkillAI');
    const status = $('#generateSkillStatus');
    btn.disabled = true;
    status.textContent = 'Generating…';

    // Track usage
    if (skillPicker.getProvider() === 'openrouter') {
      incrementModelUsage(model);
    }

    const res = await chrome.runtime.sendMessage({
      type: 'generateSkillWithAI',
      provider: skillPicker.getProvider(),
      model,
      reasoningEffort: skillPicker.getReasoning(),
      instructions,
      meta: { name, domain, description },
      taskId: taskId || undefined
    });

    btn.disabled = false;
    if (res?.success && res.content) {
      status.textContent = 'Done!';
      setTimeout(() => { status.textContent = ''; }, 3000);
      parseAndFillSkillContent(res.content);
    } else {
      status.textContent = 'Failed: ' + (res?.error || 'Unknown error');
    }
  }

  function parseAndFillSkillContent(raw) {
    const lines = raw.split('\n');
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
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SCRIPT SKILL (JSON) — Create / Run / Diagram
  // ═══════════════════════════════════════════════════════════════════════════

  let scriptSkillDiagram = null;
  let ssDefaultInstructions = '';
  let pendingRunSkill = null;
  let runDiagram = null;

  function handleSkillProgressEvent(event) {
    if (!event) return;
    switch (event.type) {
      case 'step_start':
        appendSystemMessage(`Step ${event.stepIndex + 1}: ${event.step?.label || event.stepId} — running`, 'info');
        break;
      case 'step_done':
        finishStreamingMessage(); // flush any AI step streaming
        appendSystemMessage(`Step ${event.stepIndex + 1}: ${event.stepId} — done`, 'success');
        break;
      case 'step_failed':
        finishStreamingMessage();
        appendSystemMessage(`Step ${event.stepIndex + 1}: ${event.stepId} — failed: ${event.error}`, 'error');
        break;
      case 'skill_done':
        appendSystemMessage(`Skill completed (${event.stepsRun} steps)`, 'success');
        break;
      case 'skill_failed':
        appendSystemMessage(`Skill failed at step: ${event.stepId || '?'} — ${event.reason || event.error || 'unknown'}`, 'error');
        break;
      case 'skill_cancelled':
        appendSystemMessage(`Skill cancelled after ${event.stepsRun} steps`, 'warning');
        break;

      // ── AI step mini-loop events (show like normal chat) ──
      case 'ai_step_thinking':
        streamingThinking = '';
        isStreaming = true;
        break;
      case 'ai_step_thinking_content':
        streamingThinking += event.content;
        updateStreamingMessage();
        break;
      case 'ai_step_text':
        streamingContent = event.full;
        updateStreamingMessage();
        break;
      case 'ai_step_tool_calls':
        finishStreamingMessage();
        for (const tc of event.tool_calls) {
          appendToolCall(tc);
        }
        break;
      case 'ai_step_tool_exec':
        updateToolCallStatus(event.callId, 'executing', event.tool, event.args);
        break;
      case 'ai_step_tool_result':
        updateToolCallResult(event.callId, { success: event.success }, event.tool);
        break;
    }
  }

  // Lazy-init diagram renderer
  async function getSkillDiagram(container) {
    const { SkillDiagram } = await import('./skill-diagram.js');
    return new SkillDiagram(container);
  }

  // ── Script skill model picker ─────────────────────────────────────────────
  // Reuse the same ModelPickerController class as for taskPicker / skillPicker
  const ssPicker = new ModelPickerController({
    providerTabs: '#ssProviderTabs',
    modelSelect: '#ssModelSelect',
    orPicker: '#ssOrModelPicker',
    orTrigger: '#ssOrModelTrigger',
    orLabel: '#ssOrModelLabel',
    orDropdown: '#ssOrModelDropdown',
    orSearch: '#ssOrModelSearch',
    orList: '#ssOrModelList',
    reasoningSelector: '#ssReasoningSelector',
    defaultReasoning: 'medium',
  });

  const runPicker = new ModelPickerController({
    providerTabs: '#rsProviderTabs',
    modelSelect: '#rsModelSelect',
    orPicker: '#rsOrModelPicker',
    orTrigger: '#rsOrModelTrigger',
    orLabel: '#rsOrModelLabel',
    orDropdown: '#rsOrModelDropdown',
    orSearch: '#rsOrModelSearch',
    orList: '#rsOrModelList',
    reasoningSelector: '#rsReasoningSelector',
    defaultReasoning: 'low',
  });

  // ── Open / Close ──────────────────────────────────────────────────────────

  function openCreateScriptSkillModal(taskId) {
    $('#ssId').value = '';
    $('#ssJsonEditor').value = '';
    $('#ssJsonErrors').textContent = '';
    $('#generateScriptStatus').textContent = '';
    // Collapse AI section by default
    $('#ssAiBody').classList.remove('open');
    const chev = $('#ssAiToggle')?.querySelector('.cs-ai-chevron');
    if (chev) chev.classList.remove('open');
    // Clear diagram preview
    const preview = $('#ssDiagramPreview');
    preview.innerHTML = '<div class="sd-empty">Enter JSON to see diagram</div>';
    scriptSkillDiagram = null;

    // Store taskId for AI generation with conversation context
    $('#btnGenerateScriptAI').dataset.taskId = taskId || '';

    // Pre-fill ID from agent name if creating from conversation
    if (taskId) {
      const agent = agents.find(a => a.taskId === taskId);
      if (agent?.name) {
        $('#ssId').value = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      }
      // Auto-open AI section when creating from conversation
      $('#ssAiBody').classList.add('open');
      if (chev) chev.classList.add('open');
      loadScriptSkillInstructions(false);
      ssPicker.loadModels();
    }

    $('#createScriptSkillModal').classList.add('active');
  }

  async function openEditScriptSkillModal(skillId) {
    const res = await chrome.runtime.sendMessage({ type: 'getScriptSkill', id: skillId });
    if (!res?.skill) { alert('Skill not found'); return; }
    const skill = res.skill;

    // Open modal in "create" mode but pre-fill with existing data
    $('#ssId').value = skillId;
    $('#ssJsonEditor').value = JSON.stringify(skill, null, 2);
    $('#ssJsonErrors').textContent = '';
    $('#generateScriptStatus').textContent = '';
    // Collapse AI section
    $('#ssAiBody').classList.remove('open');
    const chev = $('#ssAiToggle')?.querySelector('.cs-ai-chevron');
    if (chev) chev.classList.remove('open');
    // Render diagram preview
    previewScriptSkillDiagram();
    $('#btnGenerateScriptAI').dataset.taskId = '';

    $('#createScriptSkillModal').classList.add('active');
  }

  function closeCreateScriptSkillModal() {
    $('#createScriptSkillModal').classList.remove('active');
  }

  function toggleSsAiSection() {
    const body = $('#ssAiBody');
    const chevron = $('#ssAiToggle').querySelector('.cs-ai-chevron');
    const isOpen = body.classList.toggle('open');
    chevron.classList.toggle('open', isOpen);
    if (isOpen && !$('#ssInstructions').value) {
      loadScriptSkillInstructions(false);
      ssPicker.loadModels();
    }
  }

  async function loadScriptSkillInstructions(force) {
    if (!cachedToolsInfo || force) {
      const res = await chrome.runtime.sendMessage({ type: 'getToolsInfo' });
      cachedToolsInfo = res?.success ? res.toolsInfo : '(Failed to load tools)';
    }
    ssDefaultInstructions = buildScriptSkillInstructions(cachedToolsInfo);
    $('#ssInstructions').value = ssDefaultInstructions;
  }

  // ── Live diagram preview ──────────────────────────────────────────────────

  async function previewScriptSkillDiagram() {
    const raw = $('#ssJsonEditor').value.trim();
    const errorEl = $('#ssJsonErrors');
    const preview = $('#ssDiagramPreview');

    if (!raw) {
      errorEl.textContent = '';
      preview.innerHTML = '<div class="sd-empty">Enter JSON to see diagram</div>';
      return;
    }

    let skill;
    try {
      skill = JSON.parse(raw);
    } catch (e) {
      errorEl.textContent = `JSON Error: ${e.message}`;
      return;
    }

    // Validate via service worker
    const vRes = await chrome.runtime.sendMessage({ type: 'validateSkillJSON', skill });
    if (!vRes.success) {
      errorEl.textContent = vRes.errors.join('\n');
      return;
    }
    errorEl.textContent = '';

    // Render diagram
    if (!scriptSkillDiagram) {
      scriptSkillDiagram = await getSkillDiagram(preview);
    }
    scriptSkillDiagram.render(skill);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function saveNewScriptSkill() {
    const id = $('#ssId').value.trim().replace(/\s+/g, '_').toLowerCase();
    if (!id) { alert('Skill ID is required.'); return; }

    const raw = $('#ssJsonEditor').value.trim();
    if (!raw) { alert('Skill JSON is required.'); return; }

    let skill;
    try { skill = JSON.parse(raw); } catch (e) { alert(`Invalid JSON: ${e.message}`); return; }

    try {
      await chrome.runtime.sendMessage({ type: 'saveScriptSkill', id, skill });
      closeCreateScriptSkillModal();
      await loadSkills();
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
  }

  // ── AI Generation ─────────────────────────────────────────────────────────

  async function generateScriptSkillWithAI() {
    const btn = $('#btnGenerateScriptAI');
    const status = $('#generateScriptStatus');
    btn.disabled = true;
    status.textContent = 'Generating…';

    const instructions = $('#ssInstructions').value || ssDefaultInstructions;
    const model = ssPicker.getModel();
    if (!model) { status.textContent = 'Select a model first'; btn.disabled = false; return; }

    const taskId = $('#btnGenerateScriptAI').dataset.taskId || undefined;

    const res = await chrome.runtime.sendMessage({
      type: 'generateSkillWithAI',
      provider: ssPicker.getProvider(),
      model,
      reasoningEffort: ssPicker.getReasoning(),
      instructions,
      meta: { name: $('#ssId').value || 'script_skill' },
      taskId,
    });

    btn.disabled = false;
    if (res?.success && res.content) {
      status.textContent = 'Done!';
      setTimeout(() => { status.textContent = ''; }, 3000);
      // Try to extract JSON from the response (may have markdown fences)
      let json = res.content.trim();
      const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) json = fenceMatch[1].trim();
      $('#ssJsonEditor').value = json;
      previewScriptSkillDiagram();
    } else {
      status.textContent = 'Failed: ' + (res?.error || 'Unknown error');
    }
  }

  // ── Run Skill ─────────────────────────────────────────────────────────────

  async function openRunSkillModal(skillId) {
    const res = await chrome.runtime.sendMessage({ type: 'getScriptSkill', id: skillId });
    if (!res?.success || !res.skill) { alert('Skill not found'); return; }

    const skill = res.skill;
    pendingRunSkill = { id: skillId, skill };

    $('#runSkillTitle').textContent = `Run: ${skill.name}`;

    // Build input form
    const inputsDiv = $('#runSkillInputs');
    inputsDiv.innerHTML = '';
    if (skill.inputs && skill.inputs.length > 0) {
      for (const inp of skill.inputs) {
        const fg = document.createElement('div');
        fg.className = 'form-group';
        fg.innerHTML = `
          <label>${inp.label || inp.id}${inp.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
          ${inp.type === 'select' && inp.options
            ? `<select class="form-select run-skill-input" data-id="${inp.id}">${inp.options.map(o => `<option value="${o}">${o}</option>`).join('')}</select>`
            : `<input type="${inp.type === 'number' ? 'number' : 'text'}" class="form-input run-skill-input" data-id="${inp.id}" placeholder="${inp.placeholder || ''}" ${inp.defaultValue ? `value="${inp.defaultValue}"` : ''}>`
          }
        `;
        inputsDiv.appendChild(fg);
      }
    } else {
      inputsDiv.innerHTML = '<p class="form-hint">This skill has no inputs — it will run directly.</p>';
    }

    // Load model picker
    await runPicker.loadModels();

    // Render mini diagram
    const diagDiv = $('#runSkillDiagram');
    runDiagram = await getSkillDiagram(diagDiv);
    runDiagram.render(skill);

    $('#runSkillModal').classList.add('active');
  }

  function closeRunSkillModal() {
    $('#runSkillModal').classList.remove('active');
    pendingRunSkill = null;
    runDiagram = null;
  }

  async function confirmRunSkill() {
    if (!pendingRunSkill) return;

    // Collect inputs
    const inputValues = {};
    document.querySelectorAll('.run-skill-input').forEach(el => {
      inputValues[el.dataset.id] = el.value;
    });

    // Check required
    const skill = pendingRunSkill.skill;
    if (skill.inputs) {
      for (const inp of skill.inputs) {
        if (inp.required && !inputValues[inp.id]) {
          alert(`"${inp.label || inp.id}" is required.`);
          return;
        }
      }
    }

    const runModel = runPicker.getModel();
    if (!runModel) { alert('Select a model first.'); return; }

    // Auto-create a task if none is active
    let taskId = currentTaskId;
    if (!taskId) {
      const skillName = skill.name || pendingRunSkill.id;
      const createRes = await chrome.runtime.sendMessage({
        type: 'createAgent',
        config: {
          name: `Skill: ${skillName}`,
          provider: runPicker.getProvider(),
          model: runModel,
          reasoningEffort: runPicker.getReasoning(),
          permissions: { navigation: true, interaction: true, screenshots: true, terminal: false, javascript: false },
        }
      });
      if (!createRes?.success) {
        alert('Failed to create task: ' + (createRes?.error || 'Unknown'));
        return;
      }
      taskId = createRes.taskId;
      // Just ensure the agent has a tab — don't start the chat loop
      await chrome.runtime.sendMessage({ type: 'ensureAgentTab', taskId });
      await loadAgents();
      openTaskDetail(taskId);
    }

    const runProvider = runPicker.getProvider();
    const runReasoning = runPicker.getReasoning();
    const skillId = pendingRunSkill.id;

    closeRunSkillModal();

    // Send run command with explicit model selection
    const res = await chrome.runtime.sendMessage({
      type: 'runSkillScript',
      taskId,
      skillId,
      inputValues,
      provider: runProvider,
      model: runModel,
      reasoningEffort: runReasoning,
    });

    if (!res?.success) {
      appendChatMessage('assistant', `Skill failed: ${res?.error || 'Unknown error'}`);
    }
  }

  // ── Debounce helper ───────────────────────────────────────────────────────

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── Update loadSkills to include script skills ────────────────────────────
  // (Already integrated into loadSkills/renderSkillsRow above)

  // ═══════════════════════════════════════════════════════════════════════════
  //  SCHEDULED TASKS
  // ═══════════════════════════════════════════════════════════════════════════

  let schedules = [];
  let editingScheduleId = null;

  const schedPicker = new ModelPickerController({
    providerTabs: '#schProviderTabs',
    modelSelect: '#schModelSelect',
    orPicker: '#schOrModelPicker',
    orTrigger: '#schOrModelTrigger',
    orLabel: '#schOrModelLabel',
    orDropdown: '#schOrModelDropdown',
    orSearch: '#schOrModelSearch',
    orList: '#schOrModelList',
    reasoningSelector: '#schReasoningSelector',
    defaultReasoning: 'low',
  });

  async function loadSchedules() {
    const res = await chrome.runtime.sendMessage({ type: 'getSchedules' });
    schedules = res?.schedules || [];
    renderScheduledRow();
  }

  function renderScheduledRow() {
    const container = $('#scheduledContainer');
    container.innerHTML = '';

    if (schedules.length === 0) {
      container.innerHTML = '<div class="skills-empty">No scheduled tasks yet.</div>';
      return;
    }

    for (const sched of schedules) {
      const card = document.createElement('div');
      card.className = `sched-card${sched.enabled ? '' : ' disabled'}`;

      const info = document.createElement('div');
      info.className = 'sched-card-info';

      const repeatLabel = {
        once: 'Once', hourly: 'Hourly', daily: 'Daily',
        weekdays: 'Weekdays', weekly: 'Weekly', custom: 'Custom',
      }[sched.repeat] || sched.repeat;

      const timeStr = sched.time || '';
      const nextStr = sched.nextRun ? formatRelativeTime(sched.nextRun) : '—';

      info.innerHTML = `
        <div class="sched-card-name">${escapeHtml(sched.name)}</div>
        <div class="sched-card-meta">
          <span class="sched-chip repeat">${repeatLabel}</span>
          ${timeStr ? `<span class="sched-chip time">${timeStr}</span>` : ''}
          <span class="sched-chip next">Next: ${escapeHtml(nextStr)}</span>
          ${!sched.enabled ? '<span class="sched-chip missed">paused</span>' : ''}
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'sched-card-actions';

      const runBtn = document.createElement('button');
      runBtn.className = 'skill-card-btn run';
      runBtn.textContent = 'Run Now';
      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        runBtn.textContent = 'Running…';
        await chrome.runtime.sendMessage({ type: 'runScheduleNow', id: sched.id });
        await loadSchedules();
        await loadAgents();
        runBtn.disabled = false;
        runBtn.textContent = 'Run Now';
      });
      actions.appendChild(runBtn);

      const editBtn = document.createElement('button');
      editBtn.className = 'skill-card-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openScheduleModal(sched.id));
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'skill-card-btn delete';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (confirm(`Delete schedule "${sched.name}"?`)) {
          await chrome.runtime.sendMessage({ type: 'deleteSchedule', id: sched.id });
          await loadSchedules();
        }
      });
      actions.appendChild(delBtn);

      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    }
  }

  function formatRelativeTime(ts) {
    const diff = ts - Date.now();
    if (diff < 0) return 'overdue';
    if (diff < 60000) return 'in <1m';
    if (diff < 3600000) return `in ${Math.round(diff / 60000)}m`;
    if (diff < 86400000) return `in ${Math.round(diff / 3600000)}h`;
    return `in ${Math.round(diff / 86400000)}d`;
  }

  async function openScheduleModal(scheduleId) {
    editingScheduleId = scheduleId || null;
    const sched = scheduleId ? schedules.find(s => s.id === scheduleId) : null;

    $('#scheduleModalTitle').textContent = sched ? 'Edit Schedule' : 'New Schedule';
    $('#schedName').value = sched?.name || '';
    $('#schedRepeat').value = sched?.repeat || 'daily';
    $('#schedTime').value = sched?.time || '09:00';
    $('#schedDay').value = sched?.day || '1';
    $('#schedCatchUp').checked = sched?.catchUp !== false;
    $('#schedEnabled').checked = sched?.enabled !== false;

    if (sched?.repeat === 'custom') {
      $('#schedCustomValue').value = sched.customValue || 2;
      $('#schedCustomUnit').value = sched.customUnit || 'hours';
    }

    // Populate skill dropdown
    await populateScheduleSkillSelect(sched?.skillId, sched?.skillType);

    // Load models
    await schedPicker.loadModels();
    if (sched) {
      schedPicker.setProvider(sched.provider || 'ollama');
      // Try to pre-select model after a short delay for list to render
      setTimeout(() => {
        try {
          const sel = $('#schModelSelect');
          if (sel && sched.model) sel.value = sched.model;
        } catch {}
      }, 200);
    }

    updateScheduleRepeatUI();
    $('#scheduleModal').classList.add('active');
  }

  async function populateScheduleSkillSelect(selectedSkillId, selectedType) {
    const sel = $('#schedSkillSelect');
    sel.innerHTML = '<option value="">— Select a skill —</option>';

    // Script skills
    for (const ss of scriptSkills) {
      const opt = document.createElement('option');
      opt.value = `script:${ss._id}`;
      opt.textContent = `[Script] ${ss.name || ss._id}`;
      if (selectedType === 'script' && ss._id === selectedSkillId) opt.selected = true;
      sel.appendChild(opt);
    }

    // Text skills
    for (const sk of skills) {
      const opt = document.createElement('option');
      opt.value = `text:${sk.id}`;
      opt.textContent = `[Skill] ${sk.name}`;
      if (selectedType === 'text' && sk.id === selectedSkillId) opt.selected = true;
      sel.appendChild(opt);
    }

    // Render skill inputs if script skill selected
    sel.addEventListener('change', () => renderScheduleSkillInputs());
    renderScheduleSkillInputs();
  }

  function renderScheduleSkillInputs() {
    const val = $('#schedSkillSelect').value;
    const div = $('#schedSkillInputs');
    div.innerHTML = '';

    if (!val || !val.startsWith('script:')) return;

    const skillId = val.replace('script:', '');
    const ss = scriptSkills.find(s => s._id === skillId);
    if (!ss || !ss.inputs || ss.inputs.length === 0) return;

    for (const inp of ss.inputs) {
      const fg = document.createElement('div');
      fg.className = 'form-group';
      fg.innerHTML = `
        <label>${inp.label || inp.id}${inp.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
        <input type="${inp.type === 'number' ? 'number' : 'text'}" class="form-input sched-skill-input" data-id="${inp.id}" placeholder="${inp.placeholder || ''}" ${inp.defaultValue ? `value="${inp.defaultValue}"` : ''}>
      `;
      div.appendChild(fg);
    }
  }

  function updateScheduleRepeatUI() {
    const repeat = $('#schedRepeat').value;
    $('#schedCustomInterval').style.display = repeat === 'custom' ? '' : 'none';
    $('#schedTimeGroup').style.display = ['daily', 'weekdays', 'weekly', 'once'].includes(repeat) ? '' : 'none';
    $('#schedDayGroup').style.display = repeat === 'weekly' ? '' : 'none';
  }

  function closeScheduleModal() {
    $('#scheduleModal').classList.remove('active');
    editingScheduleId = null;
  }

  async function saveSchedule() {
    const name = $('#schedName').value.trim();
    if (!name) { alert('Enter a schedule name.'); return; }

    const skillVal = $('#schedSkillSelect').value;
    if (!skillVal) { alert('Select a skill.'); return; }

    const model = schedPicker.getModel();
    if (!model) { alert('Select a model.'); return; }

    const [skillType, skillId] = skillVal.split(':');

    // Collect skill inputs
    const inputValues = {};
    document.querySelectorAll('.sched-skill-input').forEach(el => {
      inputValues[el.dataset.id] = el.value;
    });

    const schedule = {
      id: editingScheduleId || undefined,
      name,
      skillType,
      skillId,
      inputValues,
      provider: schedPicker.getProvider(),
      model,
      reasoningEffort: schedPicker.getReasoning(),
      repeat: $('#schedRepeat').value,
      time: $('#schedTime').value,
      day: $('#schedDay').value,
      customValue: parseInt($('#schedCustomValue').value) || 2,
      customUnit: $('#schedCustomUnit').value,
      catchUp: $('#schedCatchUp').checked,
      enabled: $('#schedEnabled').checked,
    };

    const res = await chrome.runtime.sendMessage({ type: 'saveSchedule', schedule });
    if (res?.success) {
      closeScheduleModal();
      await loadSchedules();
    } else {
      alert('Failed to save: ' + (res?.error || 'Unknown'));
    }
  }

})();
