import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { loadConfig, saveConfig, publicConfig, publicProvider, annotateAgent, genId } from './src/store.js'
import { providerTemplates, lineupTemplates } from './src/templates.js'
import { getSession, listSessions, deleteSession, renameSession } from './src/sessions.js'
import { readJsonBody, sendJson } from './src/http.js'
import { startHeartbeat } from './src/sse.js'
import { testConnection } from './src/provider-service.js'
import { runDiscussion } from './src/discussion-service.js'
import {
  DEFAULT_AGENT_COLOR,
  DEFAULT_MAX_TURNS,
  DEFAULT_ORCHESTRATION,
  MODERATOR_ORCHESTRATION,
} from './src/constants.js'

const PORT = Number(process.env.PORT) || 3000
const PUBLIC_DIR = new URL('./public/', import.meta.url)

// ---------- 静态文件 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
async function serveStatic(res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1)
  try {
    const content = await readFile(new URL(file, PUBLIC_DIR))
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404); res.end('Not Found')
  }
}

// ---------- 路由 ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const { pathname } = url
  const method = req.method

  try {
    // ===== 配置总览 =====
    if (method === 'GET' && pathname === '/api/config') {
      const config = await loadConfig()
      return sendJson(res, 200, publicConfig(config))
    }

    // ===== 模板（只读）=====
    if (method === 'GET' && pathname === '/api/templates/providers') {
      return sendJson(res, 200, providerTemplates)
    }
    if (method === 'GET' && pathname === '/api/templates/lineups') {
      return sendJson(res, 200, lineupTemplates)
    }

    // ===== Provider =====
    if (method === 'GET' && pathname === '/api/providers') {
      const config = await loadConfig()
      return sendJson(res, 200, config.providers.map(publicProvider))
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
      return sendJson(res, 200, publicProvider(provider))
    }
    // /api/providers/:id  和  /api/providers/:id/test
    const provMatch = pathname.match(/^\/api\/providers\/([^/]+)(\/test)?$/)
    if (provMatch) {
      const id = provMatch[1]
      const isTest = !!provMatch[2]
      const config = await loadConfig()
      const provider = config.providers.find((p) => p.id === id)

      if (isTest && method === 'POST') {
        if (!provider) return sendJson(res, 404, { ok: false, error: '供应商不存在' })
        const model = provider.models[0] || ''
        const result = await testConnection({ protocol: provider.protocol, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model })
        return sendJson(res, 200, result)
      }
      if (!isTest && method === 'PUT') {
        if (!provider) return sendJson(res, 404, { ok: false, error: '供应商不存在' })
        const body = await readJsonBody(req)
        if (body.name !== undefined) provider.name = body.name
        if (body.protocol !== undefined) provider.protocol = body.protocol === 'anthropic' ? 'anthropic' : 'openai'
        if (body.baseUrl !== undefined) provider.baseUrl = body.baseUrl
        if (Array.isArray(body.models)) provider.models = body.models
        // 密钥：仅当传了非空 apiKey 才覆盖
        if (body.apiKey) provider.apiKey = body.apiKey
        // model 删除后修复引用该 model 的 agent
        const migratedAgents = []
        for (const a of config.agents) {
          if (a.providerId === provider.id && provider.models.length && !provider.models.includes(a.model)) {
            a.model = provider.models[0]
            migratedAgents.push(a.id)
          }
        }
        await saveConfig(config)
        return sendJson(res, 200, { ...publicProvider(provider), migratedAgents })
      }
      if (!isTest && method === 'DELETE') {
        if (!provider) return sendJson(res, 404, { ok: false, error: '供应商不存在' })
        const referencedBy = config.agents.filter((a) => a.providerId === id).map((a) => a.id)
        const force = url.searchParams.get('force') === '1'
        if (referencedBy.length && !force) {
          return sendJson(res, 409, { ok: false, error: '仍有 Agent 引用该供应商', referencedBy })
        }
        config.providers = config.providers.filter((p) => p.id !== id)
        await saveConfig(config)
        return sendJson(res, 200, { ok: true })
      }
    }

    // ===== 未保存时的连通性测试 =====
    if (method === 'POST' && pathname === '/api/providers/test') {
      const body = await readJsonBody(req)
      const result = await testConnection(body)
      return sendJson(res, 200, result)
    }

    // ===== Agent =====
    if (method === 'GET' && pathname === '/api/agents') {
      const config = await loadConfig()
      return sendJson(res, 200, config.agents.map((a) => annotateAgent(a, config.providers)))
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
      return sendJson(res, 200, annotateAgent(agent, config.providers))
    }
    if (method === 'POST' && pathname === '/api/agents/reorder') {
      const body = await readJsonBody(req)
      const config = await loadConfig()
      const order = Array.isArray(body.order) ? body.order : []
      // 校验：order 必须是当前 agent id 的排列。缺失的 id 用 indexOf=-1 会乱序，
      // 故按 order 位置排序，order 中没有的 agent 稳定排到末尾。
      const rank = (id) => {
        const i = order.indexOf(id)
        return i === -1 ? Number.MAX_SAFE_INTEGER : i
      }
      config.agents.sort((a, b) => rank(a.id) - rank(b.id))
      await saveConfig(config)
      return sendJson(res, 200, { ok: true })
    }
    const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/)
    if (agentMatch) {
      const id = agentMatch[1]
      const config = await loadConfig()
      const agent = config.agents.find((a) => a.id === id)
      if (method === 'PUT') {
        if (!agent) return sendJson(res, 404, { ok: false, error: 'Agent 不存在' })
        const body = await readJsonBody(req)
        for (const k of ['name', 'color', 'systemPrompt', 'providerId', 'model']) {
          if (body[k] !== undefined) agent[k] = body[k]
        }
        await saveConfig(config)
        return sendJson(res, 200, annotateAgent(agent, config.providers))
      }
      if (method === 'DELETE') {
        if (!agent) return sendJson(res, 404, { ok: false, error: 'Agent 不存在' })
        config.agents = config.agents.filter((a) => a.id !== id)
        await saveConfig(config)
        return sendJson(res, 200, { ok: true })
      }
    }

    // ===== 全局设置 =====
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
      return sendJson(res, 200, { ok: true })
    }

    // ===== 会话管理 =====
    if (method === 'GET' && pathname === '/api/sessions') {
      return sendJson(res, 200, await listSessions())
    }
    const sessMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessMatch) {
      const id = sessMatch[1]
      if (method === 'GET') {
        const s = await getSession(id)
        return s ? sendJson(res, 200, s) : sendJson(res, 404, { ok: false, error: '会话不存在' })
      }
      if (method === 'DELETE') {
        await deleteSession(id)
        return sendJson(res, 200, { ok: true })
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req)
        const s = await renameSession(id, body.title || '未命名讨论')
        return s ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { ok: false, error: '会话不存在' })
      }
    }

    // ===== 讨论（SSE）=====
    if (method === 'POST' && pathname === '/api/discuss') {
      const body = await readJsonBody(req)
      // 新讨论需要 topic；续聊（带 sessionId）则不需要
      if (!body.sessionId && !(body.topic || '').trim()) {
        return sendJson(res, 400, { ok: false, error: '缺少话题' })
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      const ac = new AbortController()
      const stopHeartbeat = startHeartbeat(res)
      req.on('close', () => { ac.abort(); stopHeartbeat() }) // 前端断开：中断 LLM + 停心跳
      try {
        return await runDiscussion(res, body, ac.signal)
      } finally {
        stopHeartbeat() // 正常结束 / 抛错都停心跳，防定时器泄漏
      }
    }

    // 其它走静态
    return serveStatic(res, pathname)
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`多 AI 讨论室已启动：http://localhost:${PORT}`)
})
