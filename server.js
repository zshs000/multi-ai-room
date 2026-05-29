import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { loadConfig, saveConfig, publicConfig, publicProvider, annotateAgent, genId } from './src/store.js'
import { streamChat } from './src/llm.js'
import { providerTemplates, lineupTemplates } from './src/templates.js'
import { runRoundRobin, runModerated, runSummary } from './src/orchestrator.js'
import { createSession, getSession, saveSession, listSessions, deleteSession, renameSession, snapshotAgents, tryAcquireRun, releaseRun } from './src/sessions.js'

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
    // 防止错误信息里意外回显完整 apiKey
    let msg = e.message || '未知错误'
    if (apiKey && apiKey.length > 8) msg = msg.split(apiKey).join('***')
    return { ok: false, message: msg, latencyMs: Date.now() - start }
  }
}

// ---------- 讨论编排 ----------
// ---------- 讨论编排 ----------
async function runDiscussion(res, body, signal) {
  const config = await loadConfig()
  const discussionId = genId('d')
  const emit = (evt) => sse(res, { discussionId, ...evt })

  // 续聊已有会话 or 新建会话
  let session
  if (body.sessionId) {
    session = await getSession(body.sessionId)
    if (!session) {
      emit({ type: 'error', message: '会话不存在' })
      emit({ type: 'done' })
      return res.end()
    }
    // 续聊：该会话若已有讨论在跑，拒绝并发
    if (!tryAcquireRun(session.id)) {
      emit({ type: 'error', message: '该会话正在讨论中，请等待当前轮结束。' })
      emit({ type: 'done' })
      return res.end()
    }
  }
  const topic = session ? session.topic : (body.topic || '').trim()

  if (!config.agents.length) {
    if (session) releaseRun(session.id)
    emit({ type: 'error', message: '还没有任何 Agent，请先到设置里添加。' })
    emit({ type: 'done' })
    return res.end()
  }

  // 新建会话：用当前 agent 配置做快照
  if (!session) {
    session = await createSession({
      topic,
      agents: config.agents,
      rounds: config.rounds,
      orchestration: config.orchestration || 'round-robin',
    })
    tryAcquireRun(session.id) // 新会话 id 唯一，必定成功
  }

  emit({ type: 'start', sessionId: session.id, topic })

  // 续聊时用会话快照的 agent（保人设语义）；新会话也用快照保持一致
  const agents = session.agentsSnapshot
  const providers = config.providers

  // 重建历史（续聊时从已存消息恢复）
  const history = session.messages.map((m) => ({
    type: m.type, agentId: m.agentId, name: m.name, color: m.color, round: m.round, content: m.content,
  }))

  // 用户插话：作为一条 user 消息进入历史并持久化
  if (body.interject) {
    const turn = { type: 'user', agentId: null, name: '用户', color: '#888', round: 0, content: body.interject }
    history.push(turn)
    session.messages.push({ seq: session.messages.length, ...turn })
    await saveSession(session)
    emit({ type: 'user_message', content: body.interject })
  }

  // 持久化每条新发言。记录续聊前的发言数，用于判断本次是否真有新内容产出。
  const messagesBefore = session.messages.length
  const onTurn = async (turn) => {
    session.messages.push({ seq: session.messages.length, ...turn })
    await saveSession(session)
  }

  // 续聊（已有历史）时，每个 agent 只接话 1 轮，避免重跑整轮 N 次；新讨论用配置轮数。
  const isContinuation = messagesBefore > 0 && (body.sessionId || body.interject)
  const effectiveRounds = isContinuation ? 1 : (config.rounds || 1)

  try {
    // @指定 agent：只让该 agent 回应一次
    if (body.mention) {
      const agent = agents.find((a) => a.id === body.mention)
      if (agent) {
        await runRoundRobin({ agents: [agent], providers, topic, history, rounds: 1, emit, signal, onTurn })
      } else {
        emit({ type: 'error', message: '你 @ 的角色已不存在（可能已被删除）。' })
      }
    } else if ((session.orchestration || config.orchestration) === 'moderator') {
      // 主持人模式
      const modProvider = providers.find((p) => p.id === config.moderatorProviderId) || providers[0]
      const modModel = config.moderatorModel || modProvider?.models?.[0] || ''
      await runModerated({
        agents, providers, topic, history,
        maxTurns: config.maxTurns || (agents.length * (config.rounds || 2)),
        moderator: { provider: modProvider, model: modModel },
        emit, signal, onTurn,
      })
    } else {
      // 固定轮流
      await runRoundRobin({ agents, providers, topic, history, rounds: effectiveRounds, emit, signal, onTurn })
    }

    // 总结：仅当本次真有新发言产出、开启总结、未中断时
    const producedNew = session.messages.length > messagesBefore
    if (config.summarize && !signal.aborted && producedNew) {
      const sumProvider = providers.find((p) => p.id === config.moderatorProviderId) || providers[0]
      const sumModel = config.moderatorModel || sumProvider?.models?.[0] || ''
      try {
        const summary = await runSummary({ summarizer: { provider: sumProvider, model: sumModel }, topic, history, emit, signal })
        await onTurn({ type: 'agent', agentId: '__summary__', name: '总结', color: '#5856d6', round: 0, content: summary })
      } catch (e) {
        if (!signal.aborted) emit({ type: 'error', message: `总结出错：${e.message}` })
      }
    }
  } catch (e) {
    if (!signal.aborted) emit({ type: 'error', message: e.message })
  } finally {
    releaseRun(session.id)
  }

  emit({ type: 'done', sessionId: session.id })
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
      if (body.orchestration !== undefined) config.orchestration = body.orchestration === 'moderator' ? 'moderator' : 'round-robin'
      if (body.moderatorProviderId !== undefined) config.moderatorProviderId = body.moderatorProviderId
      if (body.moderatorModel !== undefined) config.moderatorModel = body.moderatorModel
      if (body.maxTurns !== undefined) config.maxTurns = Number(body.maxTurns) || 8
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
      req.on('close', () => ac.abort()) // 前端断开即中断 LLM 请求
      return runDiscussion(res, body, ac.signal)
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
