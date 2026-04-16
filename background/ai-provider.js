// AI Provider - Abstraction for Ollama and OpenRouter APIs
// Supports streaming, tool calling, and vision (screenshots)

export class AIProvider {
  constructor() {
    this.ollamaBaseUrl = 'http://localhost:11434';
    this.openrouterApiKey = '';
    this.openrouterBaseUrl = 'https://openrouter.ai/api/v1';
    this._orPricingCache = {}; // modelId -> { prompt, completion }
  }

  async loadSettings() {
    const data = await chrome.storage.local.get(['ollamaBaseUrl', 'openrouterApiKey']);
    if (data.ollamaBaseUrl) this.ollamaBaseUrl = data.ollamaBaseUrl;
    if (data.openrouterApiKey) this.openrouterApiKey = data.openrouterApiKey;
  }

  async saveSettings(settings) {
    if (settings.ollamaBaseUrl) this.ollamaBaseUrl = settings.ollamaBaseUrl;
    if (settings.openrouterApiKey) this.openrouterApiKey = settings.openrouterApiKey;
    await chrome.storage.local.set({
      ollamaBaseUrl: this.ollamaBaseUrl,
      openrouterApiKey: this.openrouterApiKey
    });
  }

  // ============ OLLAMA ============

  async getOllamaModels() {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/tags`);
      if (!res.ok) {
        if (res.status === 403) throw new Error('Ollama 403: Set OLLAMA_ORIGINS=* and restart Ollama');
        throw new Error(`Ollama API error: ${res.status}`);
      }
      const data = await res.json();
      return data.models || [];
    } catch (err) {
      console.error('Failed to fetch Ollama models:', err);
      return [];
    }
  }

  async *streamOllama(model, messages, tools = [], effort = 'low') {
    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: true
    };
    if (tools.length > 0) {
      body.tools = tools;
    }
    // Enable extended thinking for models that support it (effort != 'none')
    if (effort !== 'none') {
      body.think = true;
    }

    const res = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(
          'Ollama blocked the request (403 Forbidden). ' +
          'Ollama rejects requests from Chrome extensions by default. ' +
          'Fix: Stop Ollama, set the environment variable OLLAMA_ORIGINS=* and restart it. ' +
          'On Windows PowerShell: $env:OLLAMA_ORIGINS="*"; ollama serve'
        );
      }
      const errText = await res.text();
      throw new Error(`Ollama error ${res.status}: ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          yield this._parseOllamaChunk(chunk);
          // Ollama final chunk (done=true) carries token counts
          if (chunk.done && chunk.prompt_eval_count != null) {
            yield {
              type: 'usage',
              usage: {
                prompt_tokens: chunk.prompt_eval_count || 0,
                completion_tokens: chunk.eval_count || 0,
                total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
                cost: null
              },
              done: false
            };
          }
        } catch (e) {
          // Skip malformed JSON
        }
      }
    }

    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer);
        const parsed = this._parseOllamaChunk(chunk);
        yield parsed;
        // Ollama final chunk carries token counts
        if (chunk.done && chunk.prompt_eval_count != null) {
          yield {
            type: 'usage',
            usage: {
              prompt_tokens: chunk.prompt_eval_count || 0,
              completion_tokens: chunk.eval_count || 0,
              total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
              cost: null // Ollama is local — no cost
            },
            done: false
          };
        }
      } catch (e) {}
    }
  }

  _parseOllamaChunk(chunk) {
    const result = { type: 'text', content: '', done: false, tool_calls: null };

    if (chunk.done) {
      result.done = true;
    }

    if (chunk.message) {
      if (chunk.message.content) {
        // Check for thinking tags
        result.content = chunk.message.content;
        result.type = 'text';
      }
      if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
        result.type = 'tool_calls';
        result.tool_calls = chunk.message.tool_calls.map(tc => ({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments)
          }
        }));
      }
    }

    return result;
  }

  // ============ OPENROUTER ============

  async getOpenRouterModels() {
    try {
      const res = await fetch(`${this.openrouterBaseUrl}/models`, {
        headers: this._openrouterHeaders()
      });
      if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
      const data = await res.json();
      const models = (data.data || []).map(m => ({
        name: m.id,
        displayName: m.name || m.id,
        contextLength: m.context_length,
        pricing: m.pricing
      }));
      // Cache pricing for cost calculation
      for (const m of data.data || []) {
        if (m.pricing) this._orPricingCache[m.id] = m.pricing;
      }
      return models;
    } catch (err) {
      console.error('Failed to fetch OpenRouter models:', err);
      return [];
    }
  }

  _mapEffortToOpenRouter(effort) {
    // Maps internal effort levels to OpenRouter reasoning effort strings
    const map = { none: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'high' };
    return map[effort] ?? 'low';
  }

  async *streamOpenRouter(model, messages, tools = [], effort = 'low') {
    const pricing = this._orPricingCache[model] || null; // may be null if models weren't fetched yet
    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: true,
      stream_options: { include_usage: true } // request usage stats in the stream
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    // Inject reasoning effort for models that support extended thinking
    if (effort !== 'none') {
      const orEffort = this._mapEffortToOpenRouter(effort);
      body.reasoning = { effort: orEffort };
      if (effort === 'xhigh') body.reasoning.max_tokens = 20000;
    }

    const res = await fetch(`${this.openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this._openrouterHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCallAccumulator = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') {
          // Flush accumulated tool calls
          const accumulated = Object.values(toolCallAccumulator);
          if (accumulated.length > 0) {
            yield {
              type: 'tool_calls',
              content: '',
              done: false,
              tool_calls: accumulated.map(tc => ({
                id: tc.id,
                function: {
                  name: tc.name,
                  arguments: tc.arguments
                }
              }))
            };
            toolCallAccumulator = {};
          }
          yield { type: 'text', content: '', done: true, tool_calls: null };
          continue;
        }

        // OpenRouter sends a final non-[DONE] chunk with usage data
        try {
          const peek = JSON.parse(payload);
          if (peek.usage) {
            const u = peek.usage;
            let cost = null;
            if (pricing) {
              const promptCost = (u.prompt_tokens / 1_000_000) * parseFloat(pricing.prompt || 0);
              const completionCost = (u.completion_tokens / 1_000_000) * parseFloat(pricing.completion || 0);
              cost = promptCost + completionCost;
            }
            yield {
              type: 'usage',
              usage: {
                prompt_tokens: u.prompt_tokens || 0,
                completion_tokens: u.completion_tokens || 0,
                total_tokens: u.total_tokens || (u.prompt_tokens + u.completion_tokens) || 0,
                cost
              },
              done: false
            };
          }
        } catch (e) { /* not a usage chunk */ }

        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Handle thinking/reasoning tokens
          if (delta.reasoning || delta.reasoning_content) {
            yield {
              type: 'thinking',
              content: delta.reasoning || delta.reasoning_content,
              done: false,
              tool_calls: null
            };
            continue;
          }

          // Handle content
          if (delta.content) {
            yield {
              type: 'text',
              content: delta.content,
              done: false,
              tool_calls: null
            };
          }

          // Handle tool calls (accumulated across chunks)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallAccumulator[idx]) {
                toolCallAccumulator[idx] = {
                  id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  name: '',
                  arguments: ''
                };
              }
              if (tc.id) toolCallAccumulator[idx].id = tc.id;
              if (tc.function?.name) toolCallAccumulator[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallAccumulator[idx].arguments += tc.function.arguments;
            }
          }
        } catch (e) {
          // Skip malformed chunks
        }
      }
    }
  }

  // ============ UNIFIED ============

  async *stream(provider, model, messages, tools = [], effort = 'low') {
    await this.loadSettings();

    try {
      if (provider === 'ollama') {
        yield* this.streamOllama(model, messages, tools, effort);
      } else if (provider === 'openrouter') {
        yield* this.streamOpenRouter(model, messages, tools, effort);
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (err) {
      // If the model doesn't support vision, strip all images and retry once.
      // This prevents 404 errors from accumulating screenshot history on non-vision models.
      if (this._isVisionError(err)) {
        console.warn('[ai-provider] Model does not support vision — retrying without images');
        const stripped = this._stripImages(messages);
        if (provider === 'ollama') {
          yield* this.streamOllama(model, stripped, tools, effort);
        } else {
          yield* this.streamOpenRouter(model, stripped, tools, effort);
        }
      } else {
        throw err;
      }
    }
  }

  _isVisionError(err) {
    const msg = err?.message || '';
    return msg.includes('image input') || msg.includes('image_url') ||
           msg.includes('does not support') && msg.includes('image');
  }

  _stripImages(messages) {
    return messages.map(msg => {
      if (!msg.images && !Array.isArray(msg.content)) return msg;
      if (msg.images) {
        // eslint-disable-next-line no-unused-vars
        const { images, ...rest } = msg;
        return rest;
      }
      // Strip image_url parts from array content
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.filter(p => p.type !== 'image_url').map(p => p.text || '').join('') || ''
        };
      }
      return msg;
    });
  }

  // Non-streaming call (for simple requests)
  async chat(provider, model, messages, tools = []) {
    await this.loadSettings();

    if (provider === 'ollama') {
      return this._chatOllama(model, messages, tools);
    } else {
      return this._chatOpenRouter(model, messages, tools);
    }
  }

  async _chatOllama(model, messages, tools) {
    const body = { model, messages: this._formatMessages(messages), stream: false };
    if (tools.length > 0) body.tools = tools;

    const res = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      if (res.status === 403) throw new Error('Ollama 403: Set OLLAMA_ORIGINS=* and restart Ollama');
      throw new Error(`Ollama error: ${res.status}`);
    }
    const data = await res.json();
    return this._normalizeResponse(data.message);
  }

  async _chatOpenRouter(model, messages, tools) {
    const body = { model, messages: this._formatMessages(messages) };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${this.openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this._openrouterHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`);
    const data = await res.json();
    return this._normalizeResponse(data.choices?.[0]?.message);
  }

  _normalizeResponse(message) {
    if (!message) return { content: '', tool_calls: [] };
    return {
      content: message.content || '',
      tool_calls: (message.tool_calls || []).map(tc => ({
        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments)
        }
      }))
    };
  }

  _formatMessages(messages) {
    return messages.map(msg => {
      // Tool result messages must be plain text — never embed images here
      // (tool role does not support multimodal content in OpenAI-compatible APIs)
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        };
      }
      // Handle image content (screenshots sent via user messages)
      if (msg.images && msg.images.length > 0) {
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content || '' },
            ...msg.images.map(img => ({
              type: 'image_url',
              image_url: { url: img.startsWith('data:') ? img : `data:image/png;base64,${img}` }
            }))
          ]
        };
      }
      // Handle assistant with tool calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        return {
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls
        };
      }
      return { role: msg.role, content: msg.content || '' };
    });
  }

  _openrouterHeaders() {
    return {
      'Authorization': `Bearer ${this.openrouterApiKey}`,
      'HTTP-Referer': 'chrome-extension://ai-browser-control',
      'X-Title': 'AI Browser Control Agent'
    };
  }
}
