// Skill Diagram — Visual flowchart renderer for script skills.
// Draws an SVG-based vertical flow diagram showing all steps with color-coded
// nodes, connection lines, and live execution state highlighting.
// Used by the dashboard to display a visual preview of a skill script.

import { STEP_COLORS } from '../background/skill-format.js';

const NODE_W = 220;
const NODE_H = 56;
const NODE_GAP = 40;
const PADDING = 24;
const CONN_COLOR = 'rgba(255,255,255,0.18)';
const CONN_ACTIVE = 'var(--accent, #818cf8)';

export class SkillDiagram {
  /**
   * @param {HTMLElement} container — div to render the diagram into
   */
  constructor(container) {
    this.container = container;
    this.skill = null;
    this.nodes = [];       // { el, stepId, x, y }
    this.svg = null;
    this._activeId = null;
    this._doneIds = new Set();
    this._failedIds = new Set();
  }

  // ─── Render entire diagram ────────────────────────────────────────────

  render(skill) {
    this.skill = skill;
    this.nodes = [];
    this._activeId = null;
    this._doneIds.clear();
    this._failedIds.clear();
    this.container.innerHTML = '';

    if (!skill || !skill.steps || skill.steps.length === 0) {
      this.container.innerHTML = '<div class="sd-empty">No steps defined</div>';
      return;
    }

    // Wrapper — relative positioning for absolute-placed nodes
    const wrapper = document.createElement('div');
    wrapper.className = 'sd-wrapper';

    // Input block (if skill has inputs)
    let startY = PADDING;
    if (skill.inputs && skill.inputs.length > 0) {
      const inputNode = this._createInputNode(skill.inputs);
      inputNode.style.left = `${PADDING}px`;
      inputNode.style.top = `${startY}px`;
      wrapper.appendChild(inputNode);
      this.nodes.push({ el: inputNode, stepId: '__inputs__', x: PADDING + NODE_W / 2, y: startY + NODE_H / 2 });
      startY += NODE_H + NODE_GAP;
    }

    // Step nodes
    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      const y = startY + i * (NODE_H + NODE_GAP);
      const node = this._createStepNode(step, i);
      node.style.left = `${PADDING}px`;
      node.style.top = `${y}px`;
      wrapper.appendChild(node);
      this.nodes.push({ el: node, stepId: step.id, x: PADDING + NODE_W / 2, y: y + NODE_H / 2 });
    }

    // SVG for connection lines
    const totalH = startY + skill.steps.length * (NODE_H + NODE_GAP) + PADDING;
    const totalW = NODE_W + PADDING * 2;
    wrapper.style.width = `${totalW}px`;
    wrapper.style.height = `${totalH}px`;
    wrapper.style.position = 'relative';

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', totalW);
    this.svg.setAttribute('height', totalH);
    this.svg.style.position = 'absolute';
    this.svg.style.top = '0';
    this.svg.style.left = '0';
    this.svg.style.pointerEvents = 'none';
    wrapper.insertBefore(this.svg, wrapper.firstChild);

    this._drawConnections();
    this.container.appendChild(wrapper);
  }

  // ─── Create nodes ─────────────────────────────────────────────────────

  _createInputNode(inputs) {
    const colors = STEP_COLORS.input;
    const el = document.createElement('div');
    el.className = 'sd-node sd-node-input';
    el.style.cssText = `
      width:${NODE_W}px; height:${NODE_H}px;
      background:${colors.bg}; border:1.5px solid ${colors.border};
      border-radius:10px; display:flex; align-items:center; padding:0 12px;
      position:absolute; cursor:default;
    `;
    el.innerHTML = `
      <span class="sd-icon">${colors.icon}</span>
      <span class="sd-label" style="color:${colors.text}">
        Inputs: ${inputs.map(i => i.label || i.id).join(', ')}
      </span>
    `;
    return el;
  }

  _createStepNode(step, index) {
    const colors = STEP_COLORS[step.type] || STEP_COLORS.action;
    const el = document.createElement('div');
    el.className = `sd-node sd-node-${step.type}`;
    el.dataset.stepId = step.id;
    el.style.cssText = `
      width:${NODE_W}px; height:${NODE_H}px;
      background:${colors.bg}; border:1.5px solid ${colors.border};
      border-radius:10px; display:flex; align-items:center; padding:0 12px;
      position:absolute; cursor:default; transition: box-shadow 0.3s, border-color 0.3s;
    `;

    let subtitle = '';
    if (step.type === 'action') subtitle = step.tool || '';
    else if (step.type === 'ai') subtitle = step.saveAs ? `→ ${step.saveAs}` : '';
    else if (step.type === 'condition') subtitle = step.check || '';

    el.innerHTML = `
      <span class="sd-icon">${colors.icon}</span>
      <div class="sd-text">
        <span class="sd-label" style="color:${colors.text}">${index + 1}. ${step.label || step.id}</span>
        ${subtitle ? `<span class="sd-sub">${subtitle}</span>` : ''}
      </div>
      <span class="sd-status-dot"></span>
    `;
    return el;
  }

  // ─── SVG connections ──────────────────────────────────────────────────

  _drawConnections() {
    if (!this.svg) return;
    this.svg.innerHTML = '';

    for (let i = 0; i < this.nodes.length - 1; i++) {
      const from = this.nodes[i];
      const to = this.nodes[i + 1];
      this._drawLine(from.x, from.y + NODE_H / 2, to.x, to.y - NODE_H / 2, CONN_COLOR);
    }

    // Condition jump arrows
    if (!this.skill) return;
    const idxMap = new Map();
    this.nodes.forEach((n, i) => idxMap.set(n.stepId, i));

    for (const step of this.skill.steps) {
      if (step.type !== 'condition') continue;
      const fromIdx = idxMap.get(step.id);
      if (fromIdx === undefined) continue;
      const from = this.nodes[fromIdx];

      // onFalse jump
      if (step.onFalse && step.onFalse !== 'next' && step.onFalse !== 'fail' && step.onFalse !== 'end') {
        const targetIdx = idxMap.get(step.onFalse);
        if (targetIdx !== undefined) {
          const to = this.nodes[targetIdx];
          this._drawCurvedLine(from.x + NODE_W / 2 - 4, from.y, to.x + NODE_W / 2 - 4, to.y, '#ef4444');
        }
      }
      // onTrue jump (if not just "next")
      if (step.onTrue && step.onTrue !== 'next' && step.onTrue !== 'fail' && step.onTrue !== 'end') {
        const targetIdx = idxMap.get(step.onTrue);
        if (targetIdx !== undefined) {
          const to = this.nodes[targetIdx];
          this._drawCurvedLine(from.x - NODE_W / 2 + 4, from.y, to.x - NODE_W / 2 + 4, to.y, '#22c55e');
        }
      }
    }
  }

  _drawLine(x1, y1, x2, y2, color) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6 4');
    this.svg.appendChild(line);
  }

  _drawCurvedLine(x1, y1, x2, y2, color) {
    const midY = (y1 + y2) / 2;
    const offsetX = 30;
    const d = `M ${x1} ${y1} C ${x1 + offsetX} ${midY}, ${x2 + offsetX} ${midY}, ${x2} ${y2}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-dasharray', '4 3');

    // Arrow head
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const arrowSize = 6;
    arrow.setAttribute('points', `${x2},${y2} ${x2 + arrowSize},${y2 - arrowSize * 2} ${x2 - arrowSize},${y2 - arrowSize * 2}`);
    arrow.setAttribute('fill', color);

    this.svg.appendChild(path);
    this.svg.appendChild(arrow);
  }

  // ─── Live execution state ─────────────────────────────────────────────

  setStepActive(stepId) {
    this._activeId = stepId;
    for (const node of this.nodes) {
      const el = node.el;
      if (node.stepId === stepId) {
        el.classList.add('sd-active');
        el.style.boxShadow = '0 0 16px var(--accent, #818cf8)';
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        el.classList.remove('sd-active');
        el.style.boxShadow = '';
      }
    }
  }

  setStepDone(stepId) {
    this._doneIds.add(stepId);
    const node = this.nodes.find(n => n.stepId === stepId);
    if (!node) return;
    node.el.classList.remove('sd-active');
    node.el.classList.add('sd-done');
    node.el.style.boxShadow = '';
    const dot = node.el.querySelector('.sd-status-dot');
    if (dot) {
      dot.style.background = '#22c55e';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
    }
  }

  setStepFailed(stepId) {
    this._failedIds.add(stepId);
    const node = this.nodes.find(n => n.stepId === stepId);
    if (!node) return;
    node.el.classList.remove('sd-active');
    node.el.classList.add('sd-failed');
    node.el.style.boxShadow = '0 0 12px #ef4444';
    const dot = node.el.querySelector('.sd-status-dot');
    if (dot) {
      dot.style.background = '#ef4444';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
    }
  }

  resetState() {
    this._activeId = null;
    this._doneIds.clear();
    this._failedIds.clear();
    for (const node of this.nodes) {
      node.el.classList.remove('sd-active', 'sd-done', 'sd-failed');
      node.el.style.boxShadow = '';
      const dot = node.el.querySelector('.sd-status-dot');
      if (dot) dot.style.cssText = '';
    }
  }
}
