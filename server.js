import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { loadConfig, saveConfig, publicConfig, publicProvider, annotateAgent, genId } from './src/store.js'
import { streamChat } from './src/llm.js'
import { providerTemplates, lineupTemplates } from './src/templates.js'

const PORT = 3000
const PUBLIC_DIR = new URL('./public/', import.meta.url)

// ---------- 工具 ----------
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}
function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

// 构造某 agent 能看到的消息历史：自己=assistant，他人=user 带 [名字] 前缀
function buildMessages(agent, topic, history) {
  const messages = [{ role: 'user', content: `本次讨论的话题是：${topic}` }]
  for (const turn of history) {
    if (turn.agentId === agent.id) {
      messages.push({ role: 'assistant', content: turn.content })
    } else {
      messages.push({ role: 'user', content: `[${turn.name}]：${turn.content}` })
    }
  }
  return messages
}

// ---------- 连通性测试：发一条极简非流式请求探活 ----------
async function testConnection({ protocol, baseUrl, apiKey, model }) {
  const start = Date.now()
  try {
    let full = ''
    await streamChat({
      provider: { protocol, baseUrl, apiKey },
      model,
      systemPrompt: '',
      messages: [{ role: 'user', content: '只回复"ok"两个字。' }],
      onToken: (t) => { full += t },
    })
    return { ok: true, message: `连通正常，返回：${full.slice(0, 20)}`, latencyMs: Date.now() - start }
  } catch (e) {
    return { ok: false, message: e.message, latencyMs: Date.now() - start }
  }
}

// ---------- 讨论编排 ----------
async function runDiscussion(res, topic, signal) {
  const config = await loadConfig()
  const discussionId = genId('d')
  sse(res, { type: 'start', discussionId, topic, rounds: config.rounds })

  if (!config.agents.length) {
    sse(res, { type: 'error', discussionId, message: '还没有任何 Agent，请先到设置里添加。' })
    sse(res, { type: 'done', discussionId })
    return res.end()
  }

  const history = []
  const rounds = config.rounds || 1

  for (let r = 0; r < rounds; r++) {
    for (const agent of config.agents) {
      if (signal.aborted) { sse(res, { type: 'done', discussionId }); return res.end() }

      // 发起前兜底校验引用完整性
      const annotated = annotateAgent(agent, config.providers)
      const provider = config.providers.find((p) => p.id === agent.providerId)
      if (annotated.invalid || !provider) {
        sse(res, { type: 'error', discussionId, agentId: agent.id, message: `${agent.name}：供应商配置失效（${annotated.invalid || 'provider_missing'}），已跳过。` })
        continue
      }
      // model 不在列表则用首个兜底
      let model = agent.model
      if (provider.models.length && !provider.models.includes(model)) {
        model = provider.models[0]
      }

      sse(res, { type: 'agent_start', discussionId, agentId: agent.id, name: agent.name, color: agent.color, model, providerName: provider.name, round: r + 1 })
      try {
        const reply = await streamChat({
          provider,
          model,
          systemPrompt: agent.systemPrompt,
          messages: buildMessages(agent, topic, history),
          onToken: (token) => sse(res, { type: 'token', discussionId, agentId: agent.id, text: token }),
          signal,
        })
        history.push({ agentId: agent.id, name: agent.name, content: reply })
      } catch (e) {
        if (signal.aborted) { sse(res, { type: 'done', discussionId }); return res.end() }
        sse(res, { type: 'error', discussionId, agentId: agent.id, message: `${agent.name} 出错：${e.message}` })
      }
      sse(res, { type: 'agent_end', discussionId, agentId: agent.id })
    }
  }
  sse(res, { type: 'done', discussionId })
  res.end()
}

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
        color: body.color || '#888888',
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
      const order = body.order || []
      config.agents.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
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
      await saveConfig(config)
      return sendJson(res, 200, { ok: true })
    }

    // ===== 讨论（SSE）=====
    if (method === 'POST' && pathname === '/api/discuss') {
      const body = await readJsonBody(req)
      const topic = (body.topic || '').trim()
      if (!topic) return sendJson(res, 400, { ok: false, error: '缺少话题' })
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      const ac = new AbortController()
      req.on('close', () => ac.abort()) // 前端断开即中断 LLM 请求
      return runDiscussion(res, topic, ac.signal)
    }

    // 其它走静态
    return serveStatic(res, pathname)
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: e.message })
  }
})

server.listen(PORT, () => {
  console.log(`多 AI 讨论室已启动：http://localhost:${PORT}`)
})
