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
}

// 发起讨论并逐事件回调。返回一个 { abort } 控制器。
export function startDiscuss(topic, onEvent) {
  const controller = new AbortController()
  ;(async () => {
    const resp = await fetch('/api/discuss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
      signal: controller.signal,
    })
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      let chunk
      try {
        chunk = await reader.read()
      } catch {
        break // abort
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
  })().catch(() => {})
  return controller
}
