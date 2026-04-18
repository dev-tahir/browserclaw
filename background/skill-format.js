// Skill Format — Schema validation, template engine, constants, step type registry.
// Kept separate so changes to the skill format don't touch the executor or UI.

// ─── Step type constants ────────────────────────────────────────────────────
export const STEP_TYPES = {
  ACTION:    'action',
  AI:        'ai',
  CONDITION: 'condition',
};

// Colors for diagram rendering (node backgrounds / borders)
export const STEP_COLORS = {
  action:    { bg: 'rgba(99,102,241,0.10)',  border: '#818cf8', text: '#818cf8', icon: '🔵' },
  ai:        { bg: 'rgba(168,85,247,0.10)',   border: '#a855f7', text: '#a855f7', icon: '🟣' },
  condition: { bg: 'rgba(250,204,21,0.10)',   border: '#facc15', text: '#eab308', icon: '🟡' },
  input:     { bg: 'rgba(52,211,153,0.10)',   border: '#34d399', text: '#34d399', icon: '🟢' },
};

// Condition check types supported by the executor
export const CONDITION_CHECKS = [
  'variable_not_empty',
  'variable_equals',
  'variable_contains',
  'url_contains',
  'element_exists',
];

// Input field types
export const INPUT_TYPES = ['text', 'url', 'number', 'select'];

// ─── Template engine ────────────────────────────────────────────────────────

/**
 * Resolve all {{input.X}} and {{var.X}} placeholders in a value.
 * Works recursively on strings, arrays, and plain objects.
 */
export function resolveTemplates(value, variables) {
  if (typeof value === 'string') {
    return value.replace(/\{\{(input|var)\.([^}]+)\}\}/g, (match, scope, key) => {
      const resolved = variables[scope]?.[key];
      return resolved !== undefined ? String(resolved) : match;
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveTemplates(v, variables));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveTemplates(v, variables);
    }
    return out;
  }
  return value;
}

// ─── Schema validation ──────────────────────────────────────────────────────

/**
 * Validate a skill JSON object. Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validateSkill(skill) {
  const errors = [];

  if (!skill || typeof skill !== 'object') {
    return { valid: false, errors: ['Skill must be a JSON object'] };
  }

  if (!skill.name || typeof skill.name !== 'string') {
    errors.push('Missing or invalid "name" (string required)');
  }

  if (!Array.isArray(skill.steps) || skill.steps.length === 0) {
    errors.push('Missing or empty "steps" array');
  }

  // Validate inputs
  if (skill.inputs) {
    if (!Array.isArray(skill.inputs)) {
      errors.push('"inputs" must be an array');
    } else {
      const inputIds = new Set();
      for (const inp of skill.inputs) {
        if (!inp.id)    errors.push('Input missing "id"');
        if (!inp.label) errors.push(`Input "${inp.id || '?'}" missing "label"`);
        if (!inp.type || !INPUT_TYPES.includes(inp.type)) {
          errors.push(`Input "${inp.id || '?'}" has invalid type "${inp.type}". Must be: ${INPUT_TYPES.join(', ')}`);
        }
        if (inp.id && inputIds.has(inp.id)) errors.push(`Duplicate input id "${inp.id}"`);
        if (inp.id) inputIds.add(inp.id);
      }
    }
  }

  // Validate steps
  if (Array.isArray(skill.steps)) {
    const stepIds = new Set();
    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      const prefix = `Step ${i + 1}`;

      if (!step.id) errors.push(`${prefix}: missing "id"`);
      if (step.id && stepIds.has(step.id)) errors.push(`${prefix}: duplicate id "${step.id}"`);
      if (step.id) stepIds.add(step.id);

      if (!step.type) {
        errors.push(`${prefix}: missing "type"`);
        continue;
      }

      switch (step.type) {
        case STEP_TYPES.ACTION:
          if (!step.tool) errors.push(`${prefix}: action step missing "tool"`);
          if (!step.args || typeof step.args !== 'object') errors.push(`${prefix}: action step missing "args" object`);
          break;
        case STEP_TYPES.AI:
          if (!step.prompt)  errors.push(`${prefix}: ai step missing "prompt"`);
          if (!step.saveAs)  errors.push(`${prefix}: ai step missing "saveAs"`);
          break;
        case STEP_TYPES.CONDITION:
          if (!step.check || !CONDITION_CHECKS.includes(step.check)) {
            errors.push(`${prefix}: invalid check "${step.check}". Must be: ${CONDITION_CHECKS.join(', ')}`);
          }
          if (!step.onTrue)  errors.push(`${prefix}: condition missing "onTrue"`);
          if (!step.onFalse) errors.push(`${prefix}: condition missing "onFalse"`);
          break;
        default:
          errors.push(`${prefix}: unknown step type "${step.type}"`);
      }
    }

    // Validate jump targets
    for (const step of skill.steps) {
      if (step.type === STEP_TYPES.CONDITION) {
        for (const target of [step.onTrue, step.onFalse]) {
          if (target && !['next', 'fail', 'end'].includes(target) && !stepIds.has(target)) {
            errors.push(`Step "${step.id}": jump target "${target}" does not match any step id`);
          }
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a human-readable summary of a skill (for display in lists) */
export function skillSummary(skill) {
  const actionCount = skill.steps.filter(s => s.type === 'action').length;
  const aiCount     = skill.steps.filter(s => s.type === 'ai').length;
  const condCount   = skill.steps.filter(s => s.type === 'condition').length;
  const parts = [];
  if (actionCount) parts.push(`${actionCount} action${actionCount > 1 ? 's' : ''}`);
  if (aiCount)     parts.push(`${aiCount} AI`);
  if (condCount)   parts.push(`${condCount} condition${condCount > 1 ? 's' : ''}`);
  return `${skill.steps.length} steps (${parts.join(', ')})`;
}

/** Create a blank skill scaffold */
export function createBlankSkill(name = 'Untitled Skill') {
  return {
    name,
    description: '',
    version: 1,
    inputs: [],
    steps: [],
  };
}
