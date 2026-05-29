// 配置存储：读写 config.json，负责旧结构迁移、id 生成、密钥脱敏、引用完整性。
import { readFile, writeFile } from 'node:fs/promises'

const CONFIG_PATH = new URL('../config.json', import.meta.url)

// 简单确定性 id 生成（不依赖随机数，便于测试与可读性）
let idCounter = 0
function genId(prefix) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter}`
}

// ---------- 读写底层 ----------
async function readRaw() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeRaw(config) {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
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
    color: a.color || '#888888',
    systemPrompt: a.systemPrompt || '',
    providerId: provider.id,
    model: config.model || '',
  }))
  return {
    providers: [provider],
    agents,
    rounds: config.rounds || 2,
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
  }
}

export { genId, maskKey }
