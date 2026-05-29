// 配置存储：读写 config.json，负责旧结构迁移、id 生成、密钥脱敏、引用完整性。
import { readFile, writeFile, rename } from 'node:fs/promises'
import { DEFAULT_AGENT_COLOR, DEFAULT_MAX_TURNS, DEFAULT_ORCHESTRATION, DEFAULT_ROUNDS } from './constants.js'

const CONFIG_PATH = new URL('../config.json', import.meta.url)

// id 生成：时间戳 + 自增 + 随机后缀，跨重启不撞。
let idCounter = 0
function genId(prefix) {
  idCounter += 1
  const rand = Math.random().toString(36).slice(2, 6)
  return `${prefix}_${Date.now().toString(36)}${idCounter}${rand}`
}

// ---------- 读写底层 ----------
// 解析失败时必须抛错，绝不静默返回 {}：config.json 含 API key 与全部 provider/agent，
// 若把"损坏"当成"空配置"，会在下一次 saveConfig 时把残留的好数据彻底覆盖掉（无声丢 key）。
// 只有"文件不存在"（首次启动）才是合法的空配置。
export class ConfigCorruptError extends Error {}

// 严格读取 JSON 文件：不存在/空 → {}；存在但损坏 → 抛 ConfigCorruptError（不静默吞）。
// 抽成接受 path 的纯函数，便于测试用临时文件验证，不碰真实 config.json。
export async function readJsonStrict(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return {} // 首次启动，无配置文件，正常
    throw e
  }
  if (!raw.trim()) return {} // 空文件视为空配置
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new ConfigCorruptError(`配置文件解析失败，已停止以防覆盖丢失配置：${e.message}`)
  }
}

// 原子写 JSON：临时文件 + rename。进程中途被杀也不会留下半截文件污染原文件。
// 自带按目标路径的写锁串行化：同一文件的并发写排队执行。
// （Windows 上多个 rename 同时指向同一目标会抛 EPERM，串行化是必需而非可选。）
let tmpCounter = 0
const writeLocks = new Map()
export async function atomicWriteJson(path, data) {
  const key = path.href
  const prev = writeLocks.get(key) || Promise.resolve()
  const task = prev.catch(() => {}).then(async () => {
    tmpCounter += 1
    const suffix = `${Date.now().toString(36)}${tmpCounter}${Math.random().toString(36).slice(2, 6)}`
    const tmpPath = new URL(`${path.pathname}.${suffix}.tmp`, path)
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmpPath, path)
  })
  writeLocks.set(key, task)
  try {
    await task
  } finally {
    if (writeLocks.get(key) === task) writeLocks.delete(key)
  }
}

async function readRaw() {
  return readJsonStrict(CONFIG_PATH)
}

// 配置写入串行化的写锁：上一次写的 Promise，新写排在它后面，防并发保存互相覆盖。
let configWriteLock = Promise.resolve()
async function writeRaw(config) {
  const task = configWriteLock.catch(() => {}).then(() => atomicWriteJson(CONFIG_PATH, config))
  configWriteLock = task
  await task
}

// ---------- 旧结构迁移 ----------
// 旧：{ baseUrl, apiKey, model, rounds, agents:[{name,color,systemPrompt}] }
// 新：{ providers:[...], agents:[{...,providerId,model}], rounds }
export function migrate(config) {
  if (Array.isArray(config.providers)) return config // 已是新结构

  const provider = {
    id: genId('p'),
    name: '默认供应商',
    protocol: 'openai',
    baseUrl: config.baseUrl || '',
    apiKey: config.apiKey || '',
    models: config.model ? [config.model] : [],
  }
  const agents = (config.agents || []).map((a) => ({
    id: genId('a'),
    name: a.name,
    color: a.color || DEFAULT_AGENT_COLOR,
    systemPrompt: a.systemPrompt || '',
    providerId: provider.id,
    model: config.model || '',
  }))
  return {
    providers: [provider],
    agents,
    rounds: config.rounds || DEFAULT_ROUNDS,
  }
}

// ---------- 加载（含迁移并回写） ----------
export async function loadConfig() {
  const raw = await readRaw()
  const migrated = migrate(raw)
  // 若发生了迁移（旧结构），回写一次
  if (!Array.isArray(raw.providers)) {
    await writeRaw(migrated)
  }
  return migrated
}

export async function saveConfig(config) {
  await writeRaw(config)
}

// ---------- 密钥脱敏 ----------
function maskKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}

// 把 provider 转为可安全下发前端的形态：去掉明文 apiKey，加 hasApiKey/apiKeyMask
export function publicProvider(p) {
  const { apiKey, ...rest } = p
  return { ...rest, hasApiKey: !!apiKey, apiKeyMask: maskKey(apiKey) }
}

// ---------- 完整性标注 ----------
// 给 agent 标注引用是否失效，便于前端置灰
export function annotateAgent(agent, providers) {
  const provider = providers.find((p) => p.id === agent.providerId)
  if (!provider) return { ...agent, invalid: 'provider_missing' }
  if (provider.models.length && !provider.models.includes(agent.model)) {
    return { ...agent, invalid: 'model_missing' }
  }
  return { ...agent }
}

// 返回整体配置的“公开版”（脱敏 + 标注）
export function publicConfig(config) {
  return {
    providers: config.providers.map(publicProvider),
    agents: config.agents.map((a) => annotateAgent(a, config.providers)),
    rounds: config.rounds,
    orchestration: config.orchestration || DEFAULT_ORCHESTRATION,
    moderatorProviderId: config.moderatorProviderId || '',
    moderatorModel: config.moderatorModel || '',
    maxTurns: config.maxTurns || DEFAULT_MAX_TURNS,
    summarize: !!config.summarize,
  }
}

export { genId, maskKey }
