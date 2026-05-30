import { loadConfig, saveConfig, publicConfig, publicProvider, annotateAgent, genId } from './store.js'
import { providerTemplates, lineupTemplates } from './templates.js'
import { getSession, listSessions, deleteSession, renameSession } from './sessions.js'
import { readJsonBody, sendJson } from './http.js'
import { startHeartbeat } from './sse.js'
import { testConnection } from './provider-service.js'
import { runDiscussion } from './discussion-service.js'
import {
  DEFAULT_AGENT_COLOR,
  DEFAULT_MAX_TURNS,
  DEFAULT_ORCHESTRATION,
  MODERATOR_ORCHESTRATION,
} from './constants.js'

export async function handleApiRoute(req, res, url) {
  const { pathname } = url
  const method = req.method

  if (method === 'GET' && pathname === '/api/config') {
    const config = await loadConfig()
    sendJson(res, 200, publicConfig(config))
    return true
  }

  if (method === 'GET' && pathname === '/api/templates/providers') {
    sendJson(res, 200, providerTemplates)
    return true
  }
  if (method === 'GET' && pathname === '/api/templates/lineups') {
    sendJson(res, 200, lineupTemplates)
    return true
  }

  if (method === 'GET' && pathname === '/api/providers') {
    const config = await loadConfig()
    sendJson(res, 200, config.providers.map(publicProvider))
    return true
  }
  if (method === 'POST' && pathname === '/api/providers') {
    const body = await readJsonBody(req)
    const config = await loadConfig()
    const provider = {
      id: genId('p'),
      name: body.name || '未命名供应商',
      protocol: body.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: body.baseUrl || '',
      apiKey: body.apiKey || '',
      models: Array.isArray(body.models) ? body.models : [],
    }
    config.providers.push(provider)
    await saveConfig(config)
    sendJson(res, 200, publicProvider(provider))
    return true
  }

  const provMatch = pathname.match(/^\/api\/providers\/([^/]+)(\/test)?$/)
  if (provMatch) {
    const id = provMatch[1]
    const isTest = !!provMatch[2]
    const config = await loadConfig()
    const provider = config.providers.find((p) => p.id === id)

    if (isTest && method === 'POST') {
      if (!provider) return sendAndHandled(res, 404, { ok: false, error: '供应商不存在' })
      const model = provider.models[0] || ''
      const result = await testConnection({ protocol: provider.protocol, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model })
      sendJson(res, 200, result)
      return true
    }
    if (!isTest && method === 'PUT') {
      if (!provider) return sendAndHandled(res, 404, { ok: false, error: '供应商不存在' })
      const body = await readJsonBody(req)
      if (body.name !== undefined) provider.name = body.name
      if (body.protocol !== undefined) provider.protocol = body.protocol === 'anthropic' ? 'anthropic' : 'openai'
      if (body.baseUrl !== undefined) provider.baseUrl = body.baseUrl
      if (Array.isArray(body.models)) provider.models = body.models
      if (body.apiKey) provider.apiKey = body.apiKey
      const migratedAgents = []
      for (const agent of config.agents) {
        if (agent.providerId === provider.id && provider.models.length && !provider.models.includes(agent.model)) {
          agent.model = provider.models[0]
          migratedAgents.push(agent.id)
        }
      }
      await saveConfig(config)
      sendJson(res, 200, { ...publicProvider(provider), migratedAgents })
      return true
    }
    if (!isTest && method === 'DELETE') {
      if (!provider) return sendAndHandled(res, 404, { ok: false, error: '供应商不存在' })
      const referencedBy = config.agents.filter((agent) => agent.providerId === id).map((agent) => agent.id)
      const force = url.searchParams.get('force') === '1'
      if (referencedBy.length && !force) {
        return sendAndHandled(res, 409, { ok: false, error: '仍有 Agent 引用该供应商', referencedBy })
      }
      config.providers = config.providers.filter((providerItem) => providerItem.id !== id)
      await saveConfig(config)
      sendJson(res, 200, { ok: true })
      return true
    }
    return true
  }

  if (method === 'POST' && pathname === '/api/providers/test') {
    const body = await readJsonBody(req)
    const result = await testConnection(body)
    sendJson(res, 200, result)
    return true
  }

  if (method === 'GET' && pathname === '/api/agents') {
    const config = await loadConfig()
    sendJson(res, 200, config.agents.map((agent) => annotateAgent(agent, config.providers)))
    return true
  }
  if (method === 'POST' && pathname === '/api/agents') {
    const body = await readJsonBody(req)
    const config = await loadConfig()
    const agent = {
      id: genId('a'),
      name: body.name || '未命名',
      color: body.color || DEFAULT_AGENT_COLOR,
      systemPrompt: body.systemPrompt || '',
      providerId: body.providerId || '',
      model: body.model || '',
    }
    config.agents.push(agent)
    await saveConfig(config)
    sendJson(res, 200, annotateAgent(agent, config.providers))
    return true
  }
  if (method === 'POST' && pathname === '/api/agents/reorder') {
    const body = await readJsonBody(req)
    const config = await loadConfig()
    const order = Array.isArray(body.order) ? body.order : []
    const rank = (id) => {
      const i = order.indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    config.agents.sort((a, b) => rank(a.id) - rank(b.id))
    await saveConfig(config)
    sendJson(res, 200, { ok: true })
    return true
  }

  const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/)
  if (agentMatch) {
    const id = agentMatch[1]
    const config = await loadConfig()
    const agent = config.agents.find((item) => item.id === id)
    if (method === 'PUT') {
      if (!agent) return sendAndHandled(res, 404, { ok: false, error: 'Agent 不存在' })
      const body = await readJsonBody(req)
      for (const key of ['name', 'color', 'systemPrompt', 'providerId', 'model']) {
        if (body[key] !== undefined) agent[key] = body[key]
      }
      await saveConfig(config)
      sendJson(res, 200, annotateAgent(agent, config.providers))
      return true
    }
    if (method === 'DELETE') {
      if (!agent) return sendAndHandled(res, 404, { ok: false, error: 'Agent 不存在' })
      config.agents = config.agents.filter((item) => item.id !== id)
      await saveConfig(config)
      sendJson(res, 200, { ok: true })
      return true
    }
    return true
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    const body = await readJsonBody(req)
    const config = await loadConfig()
    if (body.rounds !== undefined) config.rounds = Number(body.rounds) || 1
    if (body.orchestration !== undefined) config.orchestration = body.orchestration === MODERATOR_ORCHESTRATION ? MODERATOR_ORCHESTRATION : DEFAULT_ORCHESTRATION
    if (body.moderatorProviderId !== undefined) config.moderatorProviderId = body.moderatorProviderId
    if (body.moderatorModel !== undefined) config.moderatorModel = body.moderatorModel
    if (body.maxTurns !== undefined) config.maxTurns = Number(body.maxTurns) || DEFAULT_MAX_TURNS
    if (body.summarize !== undefined) config.summarize = !!body.summarize
    await saveConfig(config)
    sendJson(res, 200, { ok: true })
    return true
  }

  if (method === 'GET' && pathname === '/api/sessions') {
    sendJson(res, 200, await listSessions())
    return true
  }

  const sessMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
  if (sessMatch) {
    const id = sessMatch[1]
    if (method === 'GET') {
      const session = await getSession(id)
      sendJson(res, session ? 200 : 404, session || { ok: false, error: '会话不存在' })
      return true
    }
    if (method === 'DELETE') {
      await deleteSession(id)
      sendJson(res, 200, { ok: true })
      return true
    }
    if (method === 'PUT') {
      const body = await readJsonBody(req)
      const session = await renameSession(id, body.title || '未命名讨论')
      sendJson(res, session ? 200 : 404, session ? { ok: true } : { ok: false, error: '会话不存在' })
      return true
    }
    return true
  }

  if (method === 'POST' && pathname === '/api/discuss') {
    const body = await readJsonBody(req)
    if (!body.sessionId && !(body.topic || '').trim()) {
      return sendAndHandled(res, 400, { ok: false, error: '缺少话题' })
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const ac = new AbortController()
    const stopHeartbeat = startHeartbeat(res)
    req.on('close', () => { ac.abort(); stopHeartbeat() })
    try {
      await runDiscussion(res, body, ac.signal)
    } finally {
      stopHeartbeat()
    }
    return true
  }

  return false
}

function sendAndHandled(res, status, obj) {
  sendJson(res, status, obj)
  return true
}
