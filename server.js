import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'

const PORT = 3000
const CONFIG_PATH = new URL('./config.json', import.meta.url)
const PUBLIC_DIR = new URL('./public/', import.meta.url)

// ---------- 工具函数 ----------

// 读请求体并解析 JSON
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// 发一条 SSE 事件给前端
function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf8')
  return JSON.parse(raw)
}

// ---------- 核心：给某个 agent 构造它能看到的消息历史 ----------
// 关键点：别人的发言当 user（带 [名字] 前缀），自己的发言当 assistant。
// 这样模型才分得清谁是谁、并能针对性回应。
function buildMessages(agent, topic, history) {
  const messages = [{ role: 'system', content: agent.systemPrompt }]
  messages.push({ role: 'user', content: `本次讨论的话题是：${topic}` })
  for (const turn of history) {
    if (turn.name === agent.name) {
      messages.push({ role: 'assistant', content: turn.content })
    } else {
      messages.push({ role: 'user', content: `[${turn.name}]：${turn.content}` })
    }
  }
  return messages
}

// ---------- 调用 OpenAI 格式的流式接口，逐字回调 ----------
async function streamChat(config, messages, onToken) {
  const resp = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`接口返回 ${resp.status}：${text.slice(0, 300)}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // 按行处理，OpenAI 流式每行形如：data: {...} 或 data: [DONE]
    const lines = buffer.split('\n')
    buffer = lines.pop() // 最后一段可能不完整，留到下次
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const token = json.choices?.[0]?.delta?.content
        if (token) {
          full += token
          onToken(token)
        }
      } catch {
        // 半条 JSON，忽略
      }
    }
  }
  return full
}

// ---------- 编排：a→b→c 轮流发言，转 N 圈 ----------
async function runDiscussion(res, topic) {
  const config = await loadConfig()

  if (!config.apiKey) {
    sse(res, { type: 'error', message: '还没填 API Key，请点右上角设置填写后再试。' })
    sse(res, { type: 'done' })
    return res.end()
  }

  const history = [] // 共享历史：[{ name, content }]
  const rounds = config.rounds || 1

  for (let r = 0; r < rounds; r++) {
    for (const agent of config.agents) {
      sse(res, { type: 'agent_start', name: agent.name, color: agent.color, round: r + 1 })
      const messages = buildMessages(agent, topic, history)
      try {
        const reply = await streamChat(config, messages, (token) => {
          sse(res, { type: 'token', text: token })
        })
        history.push({ name: agent.name, content: reply })
      } catch (e) {
        sse(res, { type: 'error', message: `${agent.name} 出错：${e.message}` })
      }
      sse(res, { type: 'agent_end' })
    }
  }

  sse(res, { type: 'done' })
  res.end()
}

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

async function serveStatic(res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1)
  try {
    const content = await readFile(new URL(file, PUBLIC_DIR))
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not Found')
  }
}

// ---------- 路由 ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // 读配置
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const config = await loadConfig()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(config))
  }

  // 存配置
  if (req.method === 'POST' && url.pathname === '/api/config') {
    try {
      const incoming = await readJsonBody(req)
      const current = await loadConfig()
      const merged = { ...current, ...incoming }
      await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, error: e.message }))
    }
  }

  // 开始讨论（SSE 流式）
  if (req.method === 'POST' && url.pathname === '/api/discuss') {
    const body = await readJsonBody(req)
    const topic = (body.topic || '').trim()
    if (!topic) {
      res.writeHead(400)
      return res.end('缺少话题')
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    return runDiscussion(res, topic)
  }

  // 其它走静态文件
  return serveStatic(res, url.pathname)
})

server.listen(PORT, () => {
  console.log(`多 AI 讨论室已启动：http://localhost:${PORT}`)
})
