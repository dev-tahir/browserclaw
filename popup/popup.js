// Popup JavaScript - Quick access to tasks and dashboard

(async () => {
  const taskList = document.getElementById('taskList');
  const emptyTasks = document.getElementById('emptyTasks');

  // Open dashboard
  document.getElementById('btnOpenDashboard').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'openDashboard' });
    window.close();
  });

  // New task - opens dashboard with modal
  document.getElementById('btnNewTask').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'openDashboard' });
    window.close();
  });

  // Settings
  document.getElementById('btnSettings').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'openDashboard' });
    window.close();
  });

  // Load tasks
  const response = await chrome.runtime.sendMessage({ type: 'getAllAgents' });
  if (response?.success && response.agents.length > 0) {
    emptyTasks.style.display = 'none';

    // Sort: running first, then by updated time
    const sorted = response.agents.sort((a, b) => {
      const statusOrder = { running: 0, pending: 1, stopped: 2, error: 3, completed: 4 };
      const sa = statusOrder[a.status] ?? 5;
      const sb = statusOrder[b.status] ?? 5;
      if (sa !== sb) return sa - sb;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    for (const agent of sorted) {
      const item = document.createElement('div');
      item.className = 'task-item';

      const lastMsg = agent.lastMessage?.content?.substring(0, 50) || '';
      const model = agent.model.length > 20 ? agent.model.substring(0, 20) + '...' : agent.model;

      item.innerHTML = `
        <div class="task-dot ${agent.status}"></div>
        <div class="task-info">
          <div class="task-name">${escapeHtml(agent.name)}</div>
          <div class="task-meta">${escapeHtml(model)} · ${agent.messageCount} msgs</div>
        </div>
        <span class="task-status ${agent.status}">${agent.status}</span>
      `;

      item.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'openDashboard' });
        window.close();
      });

      taskList.appendChild(item);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
