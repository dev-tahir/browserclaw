# Skill Script System — How It Works

## Overview

Skills are **automation scripts** stored as `.json` files. Unlike the old `.txt` format (plain text instructions the AI reads), skill scripts **execute directly** — action steps run without any AI call, and only steps that genuinely need reasoning invoke the model.

**Old flow (text skill):** User runs skill → AI reads instructions → AI call per step → slow, expensive, unreliable
**New flow (script skill):** User runs skill → executor reads JSON → runs actions directly → AI only where needed → fast, cheap, deterministic

---

## Skill JSON Format

```json
{
  "name": "Tweet War Update",
  "description": "Search Google for news, compose and post tweet on X",
  "version": 1,
  "inputs": [
    { "id": "topic", "label": "Search Topic", "type": "text", "default": "Iran America war update" }
  ],
  "steps": [
    {
      "id": "s1",
      "type": "action",
      "tool": "navigate",
      "args": { "url": "https://www.google.com" },
      "label": "Open Google"
    },
    {
      "id": "s2",
      "type": "action",
      "tool": "type_text",
      "args": { "selector": "textarea[name=q]", "text": "{{input.topic}}" },
      "label": "Type search query"
    },
    {
      "id": "s3",
      "type": "action",
      "tool": "press_key",
      "args": { "key": "Enter" },
      "label": "Submit search"
    },
    {
      "id": "s4",
      "type": "action",
      "tool": "wait",
      "args": { "seconds": 3 },
      "label": "Wait for results"
    },
    {
      "id": "s5",
      "type": "ai",
      "prompt": "Extract the top 3 news headlines about {{input.topic}} from this page. Return only the headlines, one per line.",
      "saveAs": "headlines",
      "label": "Extract headlines"
    },
    {
      "id": "s6",
      "type": "condition",
      "check": "variable_not_empty",
      "variable": "headlines",
      "onTrue": "s7",
      "onFalse": "fail",
      "label": "Headlines found?"
    },
    {
      "id": "s7",
      "type": "action",
      "tool": "navigate",
      "args": { "url": "https://x.com/compose/post" },
      "label": "Open X compose"
    },
    {
      "id": "s8",
      "type": "ai",
      "prompt": "Write a concise tweet (max 280 chars) summarizing these headlines:\n{{var.headlines}}",
      "saveAs": "tweet",
      "label": "Compose tweet"
    },
    {
      "id": "s9",
      "type": "action",
      "tool": "type_text",
      "args": { "selector": "[data-testid='tweetTextarea_0']", "text": "{{var.tweet}}" },
      "label": "Type tweet"
    },
    {
      "id": "s10",
      "type": "action",
      "tool": "click",
      "args": { "selector": "[data-testid='tweetButton']" },
      "label": "Post tweet"
    }
  ]
}
```

---

## Step Types

### 🔵 `action` — Direct Tool Call (No AI)
Executes a browser automation tool directly via `ToolExecutor`. Deterministic, instant, zero tokens.

| Field   | Required | Description |
|---------|----------|-------------|
| `id`    | yes      | Unique step ID (for jumps/conditions) |
| `type`  | yes      | `"action"` |
| `tool`  | yes      | Tool name: `navigate`, `click`, `type_text`, `press_key`, `wait`, `screenshot`, etc. |
| `args`  | yes      | Object with tool parameters. Supports `{{input.X}}` and `{{var.X}}` templates |
| `label` | no       | Human-readable description shown in diagram |

### 🟣 `ai` — AI Reasoning Step (Uses Model)
Makes a single focused AI call. The AI sees the current page (via screenshot) plus the prompt. Output is saved to a variable for use in later steps.

| Field    | Required | Description |
|----------|----------|-------------|
| `id`     | yes      | Unique step ID |
| `type`   | yes      | `"ai"` |
| `prompt` | yes      | Prompt sent to AI. Supports templates |
| `saveAs` | yes      | Variable name to store the AI's text response |
| `label`  | no       | Human-readable description |

### 🟡 `condition` — Branch (No AI)
Evaluates a check and jumps to a different step based on the result.

| Field      | Required | Description |
|------------|----------|-------------|
| `id`       | yes      | Unique step ID |
| `type`     | yes      | `"condition"` |
| `check`    | yes      | Check type (see below) |
| `variable` | depends  | Variable name for variable checks |
| `value`    | depends  | Expected value for some checks |
| `selector` | depends  | CSS selector for element checks |
| `onTrue`   | yes      | Step ID to jump to if true, or `"next"` |
| `onFalse`  | yes      | Step ID to jump to if false, or `"fail"` / `"end"` |
| `label`    | no       | Human-readable description |

**Available checks:**
- `variable_not_empty` — `var[variable]` is non-empty
- `variable_equals` — `var[variable]` equals `value`
- `variable_contains` — `var[variable]` contains `value`
- `url_contains` — current page URL contains `value`
- `element_exists` — element matching `selector` exists on page

### 🟢 `input` — Defined in top-level `inputs` array
Collected from the user before execution starts. Available as `{{input.id}}`.

| Field     | Required | Description |
|-----------|----------|-------------|
| `id`      | yes      | Variable name (used as `{{input.id}}`) |
| `label`   | yes      | Display label for the input form |
| `type`    | yes      | `"text"`, `"url"`, `"number"`, `"select"` |
| `default` | no       | Default value |
| `options` | no       | For `"select"` type: array of `{ label, value }` |

---

## Template Variables

Templates use `{{...}}` syntax and are resolved before each step executes.

| Pattern | Source | Example |
|---------|--------|---------|
| `{{input.topic}}` | User input collected before run | `"Iran America war update"` |
| `{{var.headlines}}` | Output of a previous `ai` step | `"1. Iran talks...\n2. ..."` |

Templates work in:
- `action` → any string value in `args`
- `ai` → the `prompt` field
- `condition` → the `value` field

---

## File Architecture

```
background/
  skill-format.js    — Schema validation, template engine, constants, step type registry
  skill-executor.js  — Runtime engine: executes skill JSON step by step
  skills-manager.js  — CRUD: load/save/delete skills (.json + legacy .txt)
  agent-manager.js   — Hosts runSkillScript() for agent-integrated skill runs

dashboard/
  skill-diagram.js   — Visual flowchart renderer (canvas or DOM-based)
  dashboard.js       — UI integration: run skills, show diagram, create from conversation
  dashboard.css      — Node colors, edge styles, status animations
```

---

## Execution Engine (`skill-executor.js`)

### Run Flow
1. Collect inputs from user (if any `inputs` defined)
2. Resolve template variables in each step before executing
3. For each step:
   - **action**: call `toolExecutor.execute(tool, resolvedArgs, context)` directly
   - **ai**: take screenshot → send prompt + screenshot to AI → save response to `variables[saveAs]`
   - **condition**: evaluate check → jump to `onTrue` or `onFalse` step ID
4. Emit progress events: `step_start`, `step_done`, `step_failed`, `skill_done`
5. If a step fails → stop execution, report which step failed and why

### Variables Map
```
{
  input: { topic: "Iran America war update" },
  var: { headlines: "...", tweet: "..." }
}
```

### Pause / Resume
The executor supports pause/resume. When paused, it saves the current step index and variables map. Resume continues from where it left off.

---

## Diagram Visualization (`skill-diagram.js`)

Each step is rendered as a color-coded node in a vertical flowchart:

```
  ┌─────────────────────┐
  │ 🟢 input: topic     │
  └──────────┬──────────┘
             │
  ┌──────────▼──────────┐
  │ 🔵 navigate: Google │
  └──────────┬──────────┘
             │
  ┌──────────▼──────────┐
  │ 🟣 AI: Extract news │
  └──────────┬──────────┘
             │
  ┌──────────▼──────────┐
  │ 🟡 headlines found? │──No──→ ❌ fail
  └──────────┬──────────┘
           Yes
  ┌──────────▼──────────┐
  │ 🔵 navigate: X.com  │
  └─────────────────────┘
```

Node states during execution:
- **pending** (grey) — not yet reached
- **running** (pulsing border) — currently executing
- **done** (green check) — completed successfully
- **failed** (red X) — failed
- **skipped** (dimmed) — skipped by condition

---

## Skill Creation from Conversation

When user clicks "Save as Skill" on a completed task:

1. The conversation's `toolCallHistory` and `displayMessages` are sent to AI
2. AI receives special **script-generation instructions** that say:
   - Convert deterministic tool sequences into `action` steps
   - Convert places where AI reasoned/generated text into `ai` steps
   - Identify repeated patterns → parametrize with `inputs`
   - Add `condition` steps where the conversation had error handling
3. AI returns the structured JSON skill
4. User sees the visual diagram, can edit nodes, reorder, then save

---

## Backward Compatibility

- Old `.txt` skills continue to work as "prompt-based" skills (appended to system prompt)
- The UI shows both types: `.txt` skills with a text icon, `.json` skills with a diagram icon
- `.txt` skills can be converted to `.json` via AI (same flow as "Create from Conversation")

---

## Cost Comparison

| Scenario | Text Skill | Script Skill |
|----------|-----------|-------------|
| 10-step Google → Tweet flow | 10 AI calls (~$0.02) | 2 AI calls (~$0.004) |
| Simple 5-step form fill | 5 AI calls | 0 AI calls |
| Complex flow with branching | Unpredictable | Deterministic path |
