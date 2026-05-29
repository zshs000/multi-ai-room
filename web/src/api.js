// 前端 API 封装：统一 fetch 后端接口。
const json = (r) => r.json()

export const api = {
  getConfig: () => fetch('/api/config').then(json),

  // Provider
  listProviders: () => fetch('/api/providers').then(json),
  createProvider: (data) =>
    fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),
  updateProvider: (id, data) =>
    fetch(`/api/providers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),
  deleteProvider: (id, force = false) =>
    fetch(`/api/providers/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' }).then(json),
  testProvider: (id) => fetch(`/api/providers/${id}/test`, { method: 'POST' }).then(json),
  testProviderDraft: (data) =>
    fetch('/api/providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),

  // Agent
  listAgents: () => fetch('/api/agents').then(json),
  createAgent: (data) =>
    fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),
  updateAgent: (id, data) =>
    fetch(`/api/agents/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),
  deleteAgent: (id) => fetch(`/api/agents/${id}`, { method: 'DELETE' }).then(json),
  reorderAgents: (order) =>
    fetch('/api/agents/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }).then(json),

  // 设置
  updateSettings: (data) =>
    fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),

  // 模板
  providerTemplates: () => fetch('/api/templates/providers').then(json),
  lineupTemplates: () => fetch('/api/templates/lineups').then(json),

  // 会话
  listSessions: () => fetch('/api/sessions').then(json),
  getSession: (id) => fetch(`/api/sessions/${id}`).then(json),
  deleteSession: (id) => fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then(json),
  renameSession: (id, title) =>
    fetch(`/api/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }).then(json),
}

// 发起讨论并逐事件回调。opts 可含 { topic, sessionId, interject, mention }。返回 { abort } 控制器。
export function startDiscuss(opts, onEvent) {
  const controller = new AbortController()
  ;(async () => {
    let resp
    try {
      resp = await fetch('/api/discuss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
        signal: controller.signal,
      })
    } catch (e) {
      if (!controller.signal.aborted) {
        onEvent({ type: 'error', message: `请求失败：${e.message}` })
        onEvent({ type: 'done' })
      }
      return
    }

    // 后端出错时返回的是 JSON 而非 SSE 流，需识别并报错，否则前端会卡死
    const ct = resp.headers.get('content-type') || ''
    if (!resp.ok || !ct.includes('text/event-stream')) {
      let msg = `服务器返回 ${resp.status}`
      try {
        const data = await resp.json()
        if (data.error) msg = data.error
      } catch {}
      onEvent({ type: 'error', message: msg })
      onEvent({ type: 'done' })
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      let chunk
      try {
        chunk = await reader.read()
      } catch {
        break // 用户主动 abort
      }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop()
      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data:')) continue
        try {
          onEvent(JSON.parse(line.slice(5).trim()))
        } catch {
          // 忽略半条
        }
      }
    }
  })().catch(() => {
    // 兜底：任何未预期错误也复位前端
    if (!controller.signal.aborted) {
      onEvent({ type: 'error', message: '讨论意外中断' })
      onEvent({ type: 'done' })
    }
  })
  return controller
}
