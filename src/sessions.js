// 会话持久化：每个会话存为 sessions/{id}.json。
// 会话绑定 agent 配置快照（含人设，但不含 apiKey）——人设是讨论语义的一部分，
// 事后改配置不应影响已有会话；续聊时用快照的 providerId 去 live config 查当前 key。
import { readFile, writeFile, readdir, mkdir, unlink, rename } from 'node:fs/promises'
import { genId } from './store.js'
import { DEFAULT_ORCHESTRATION, DEFAULT_ROUNDS, SESSION_TITLE_MAX_LENGTH } from './constants.js'

const SESSIONS_DIR = new URL('../sessions/', import.meta.url)

export class SessionCorruptError extends Error {}

// 每个会话一把写锁：写操作串行化，防并发全量覆写互相丢消息。
// 锁值是上一次写的 Promise，新写排在它后面。
const writeLocks = new Map()

// 讨论运行锁：同一会话同时只允许一个活跃讨论，防两个 runDiscussion 各持内存副本分叉。
const runningDiscussions = new Set()
export function tryAcquireRun(sessionId) {
  if (runningDiscussions.has(sessionId)) return false
  runningDiscussions.add(sessionId)
  return true
}
export function releaseRun(sessionId) {
  runningDiscussions.delete(sessionId)
}

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true }).catch(() => {})
}
// 校验 sessionId 格式，防路径注入（纵深防御，不依赖 URL+fs 的副作用）
export function isValidId(id) {
  return typeof id === 'string' && /^s_[a-z0-9]+$/i.test(id)
}
function sessionPath(id) {
  if (!isValidId(id)) throw new Error('非法的会话 id')
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
    rounds: rounds || DEFAULT_ROUNDS,
    orchestration: orchestration || DEFAULT_ORCHESTRATION,
    agentsSnapshot: snapshotAgents(agents),
    messages: [], // { seq, type:'user'|'agent', agentId, name, color, model, providerName, round, content }
  }
  await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), 'utf8')
  return session
}

export async function getSession(id) {
  let raw
  try {
    raw = await readFile(sessionPath(id), 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new SessionCorruptError(`会话文件解析失败，已停止以防历史记录静默丢失：${id}：${e.message}`)
  }
}

export async function saveSession(session) {
  await ensureDir()
  session.updatedAt = Date.now()
  const id = session.id
  // 串行化同一会话的写：排到上一次写之后，避免并发覆写
  const prev = writeLocks.get(id) || Promise.resolve()
  const task = prev.catch(() => {}).then(async () => {
    // 原子写：先写临时文件，再 rename 替换。进程中途被杀也不会留下半截 JSON。
    const finalPath = sessionPath(id)
    const tmpPath = new URL(`./${id}.${Date.now().toString(36)}.tmp`, SESSIONS_DIR)
    await writeFile(tmpPath, JSON.stringify(session, null, 2), 'utf8')
    await rename(tmpPath, finalPath)
  })
  writeLocks.set(id, task)
  try {
    await task
  } finally {
    // 清理：若自己是最后一个写任务，移除锁条目避免内存泄漏
    if (writeLocks.get(id) === task) writeLocks.delete(id)
  }
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
    } catch (e) {
      throw new SessionCorruptError(`会话文件解析失败，已停止以防历史记录静默丢失：${f}：${e.message}`)
    }
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
  session.title = title.slice(0, SESSION_TITLE_MAX_LENGTH)
  await saveSession(session)
  return session
}
