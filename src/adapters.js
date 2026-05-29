// 供应商协议适配器：吸收 OpenAI / Anthropic 两种协议的请求构造与流式解析差异。
// 加新协议（如 Gemini）= 新增一个适配器对象 + 在 adapters 注册一行。

// 把 baseUrl 规范化到“域名根”：去掉结尾 /，剥掉误填的结尾 /v1。
function normalizeBaseUrl(baseUrl) {
  let u = (baseUrl || '').trim().replace(/\/+$/, '')
  u = u.replace(/\/v1$/i, '')
  return u
}

// ---------- OpenAI 兼容协议 ----------
const OpenAIAdapter = {
  buildRequest({ baseUrl, apiKey, model, systemPrompt, messages }) {
    const msgs = []
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
    for (const m of messages) {
      msgs.push({ role: m.role, content: m.content })
    }
    return {
      url: `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: { model, messages: msgs, stream: true, max_tokens: 2048 },
    }
  },

  // 有状态解析器：逐行喂入 SSE 原始行，产出标准事件 {type:'delta'|'done', text?}
  createStreamParser() {
    return {
      push(line) {
        const events = []
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) return events
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          events.push({ type: 'done' })
          return events
        }
        try {
          const json = JSON.parse(payload)
          const token = json.choices?.[0]?.delta?.content
          if (token) events.push({ type: 'delta', text: token })
        } catch {
          // 半条 JSON，忽略
        }
        return events
      },
    }
  },
}

// ---------- Anthropic 原生协议 ----------
const AnthropicAdapter = {
  buildRequest({ baseUrl, apiKey, model, systemPrompt, messages }) {
    // Anthropic 的 system 是顶层字段；messages 只含 user/assistant
    const msgs = messages.map((m) => ({ role: m.role, content: m.content }))
    const body = {
      model,
      messages: msgs,
      stream: true,
      max_tokens: 2048,
    }
    if (systemPrompt) body.system = systemPrompt
    return {
      url: `${normalizeBaseUrl(baseUrl)}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    }
  },

  // Anthropic SSE：event: 行 + data: 行配对。统一只看 data 行 JSON 的 type 字段判断。
  createStreamParser() {
    return {
      push(line) {
        const events = []
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) return events
        const payload = trimmed.slice(5).trim()
        try {
          const json = JSON.parse(payload)
          if (json.type === 'content_block_delta') {
            const text = json.delta?.text
            if (text) events.push({ type: 'delta', text })
          } else if (json.type === 'message_stop') {
            events.push({ type: 'done' })
          }
          // 忽略 ping / message_start / content_block_start/stop / message_delta
        } catch {
          // 半条 JSON，忽略
        }
        return events
      },
    }
  },
}

// ---------- 注册表 ----------
const adapters = {
  openai: OpenAIAdapter,
  anthropic: AnthropicAdapter,
}

export function getAdapter(protocol) {
  const adapter = adapters[protocol]
  if (!adapter) throw new Error(`不支持的协议：${protocol}`)
  return adapter
}

export { normalizeBaseUrl }
