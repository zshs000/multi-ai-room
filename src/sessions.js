// 会话持久化：每个会话存为 sessions/{id}.json。
// 会话绑定 agent 配置快照（含人设，但不含 apiKey）——人设是讨论语义的一部分，
// 事后改配置不应影响已有会话；续聊时用快照的 providerId 去 live config 查当前 key。
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises'
import { genId } from './store.js'

const SESSIONS_DIR = new URL('../sessions/', import.meta.url)

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true }).catch(() => {})
}
function sessionPath(id) {
  return new URL(`./${id}.json`, SESSIONS_DIR)
}

// 从 agent 列表生成快照（剔除任何敏感信息；agent 本就不含 key，但显式挑字段更安全）
export function snapshotAgents(agents) {
  return agents.map((a) => ({
    id: a.id, name: a.name, color: a.color,
    systemPrompt: a.systemPrompt, providerId: a.providerId, model: a.model,
  }))
}

// 创建会话
export async function createSession({ topic, agents, rounds, orchestration }) {
  await ensureDir()
  const now = Date.now()
  const session = {
    id: genId('s'),
    title: topic?.slice(0, 40) || '未命名讨论',
    topic: topic || '',
    createdAt: now,
    updatedAt: now,
    rounds: rounds || 2,
    orchestration: orchestration || 'round-robin',
    agentsSnapshot: snapshotAgents(agents),
    messages: [], // { seq, type:'user'|'agent', agentId, name, color, model, providerName, round, content }
  }
  await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), 'utf8')
  return session
}

export async function getSession(id) {
  try {
    const raw = await readFile(sessionPath(id), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function saveSession(session) {
  await ensureDir()
  session.updatedAt = Date.now()
  await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), 'utf8')
  return session
}

// 追加一条消息到会话
export async function appendMessage(id, message) {
  const session = await getSession(id)
  if (!session) return null
  const seq = session.messages.length
  session.messages.push({ seq, ...message })
  await saveSession(session)
  return session
}

// 列出所有会话（摘要，不含 messages，按更新时间倒序）
export async function listSessions() {
  await ensureDir()
  let files = []
  try {
    files = await readdir(SESSIONS_DIR)
  } catch {
    return []
  }
  const sessions = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const s = JSON.parse(await readFile(new URL(`./${f}`, SESSIONS_DIR), 'utf8'))
      sessions.push({
        id: s.id, title: s.title, topic: s.topic,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
        messageCount: s.messages?.length || 0,
        agentNames: (s.agentsSnapshot || []).map((a) => a.name),
      })
    } catch {}
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteSession(id) {
  try {
    await unlink(sessionPath(id))
    return true
  } catch {
    return false
  }
}

export async function renameSession(id, title) {
  const session = await getSession(id)
  if (!session) return null
  session.title = title.slice(0, 60)
  await saveSession(session)
  return session
}
