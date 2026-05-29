// store.js 单元测试（不触网，不写真实 config.json）。运行：node test/store.test.js
import { migrate, publicProvider, publicConfig, annotateAgent, maskKey } from '../src/store.js'
import { DEFAULT_MAX_TURNS, DEFAULT_ORCHESTRATION } from '../src/constants.js'

let pass = 0, fail = 0
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, '\n   期望:', e, '\n   实际:', a) }
}
function ok(cond, name) {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name) }
}

// 旧结构迁移
const old = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-old',
  model: 'deepseek-chat',
  rounds: 3,
  agents: [{ name: '产品', color: '#fff', systemPrompt: 'P' }],
}
const m = migrate(old)
ok(Array.isArray(m.providers) && m.providers.length === 1, '迁移生成1个provider')
eq(m.providers[0].baseUrl, 'https://api.deepseek.com/v1', '迁移保留baseUrl')
eq(m.providers[0].apiKey, 'sk-old', '迁移保留apiKey')
eq(m.providers[0].models, ['deepseek-chat'], '迁移把model放入models')
eq(m.rounds, 3, '迁移保留rounds')
eq(m.agents[0].providerId, m.providers[0].id, 'agent指向迁移的provider')
eq(m.agents[0].model, 'deepseek-chat', 'agent继承model')

// 新结构不重复迁移
const already = { providers: [{ id: 'p1' }], agents: [], rounds: 1 }
eq(migrate(already), already, '新结构原样返回')

// 脱敏
eq(maskKey('sk-1234567890abcd'), 'sk-****abcd', '长key脱敏')
eq(maskKey('short'), '****', '短key全掩码')
eq(maskKey(''), '', '空key')
const pub = publicProvider({ id: 'p1', name: 'X', apiKey: 'sk-1234567890abcd', baseUrl: 'u', protocol: 'openai', models: [] })
ok(!('apiKey' in pub), '公开provider不含明文apiKey')
ok(pub.hasApiKey === true, '公开provider标hasApiKey')
eq(pub.apiKeyMask, 'sk-****abcd', '公开provider带掩码')

// 完整性标注
const providers = [{ id: 'p1', models: ['m1', 'm2'] }]
eq(annotateAgent({ id: 'a1', providerId: 'p1', model: 'm1' }, providers).invalid, undefined, '正常agent无invalid')
eq(annotateAgent({ id: 'a2', providerId: 'pX', model: 'm1' }, providers).invalid, 'provider_missing', '缺provider标记')
eq(annotateAgent({ id: 'a3', providerId: 'p1', model: 'mZ' }, providers).invalid, 'model_missing', '缺model标记')

// publicConfig 必须回吐全部设置字段（否则前端复选框/下拉保存后回弹默认值）
const pc = publicConfig({
  providers: [], agents: [], rounds: 3,
  orchestration: 'moderator', moderatorProviderId: 'p1', moderatorModel: 'm1',
  maxTurns: 12, summarize: true,
})
eq(pc.summarize, true, 'publicConfig 回吐 summarize')
eq(pc.orchestration, 'moderator', 'publicConfig 回吐 orchestration')
eq(pc.moderatorProviderId, 'p1', 'publicConfig 回吐 moderatorProviderId')
eq(pc.moderatorModel, 'm1', 'publicConfig 回吐 moderatorModel')
eq(pc.maxTurns, 12, 'publicConfig 回吐 maxTurns')
// 缺省兜底
const pcEmpty = publicConfig({ providers: [], agents: [], rounds: 2 })
eq(pcEmpty.summarize, false, 'summarize 缺省为 false')
eq(pcEmpty.orchestration, DEFAULT_ORCHESTRATION, 'orchestration 缺省为 round-robin')
eq(pcEmpty.maxTurns, DEFAULT_MAX_TURNS, 'maxTurns 缺省为 8')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
