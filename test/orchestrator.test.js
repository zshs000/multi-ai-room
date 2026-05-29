// orchestrator.js 单元测试（纯函数，不触网）。运行：node test/orchestrator.test.js
// 重点覆盖"可见性模型"的核心——buildMessages 的角色映射，以及 provider 解析与主持人 JSON 解析的容错。
import { buildMessages, resolveProvider, parseModeratorDecision, resolveRounds, buildTranscript } from '../src/orchestrator.js'

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
function throws(fn, name) {
  try { fn(); fail++; console.log('✗', name, '（未抛错）') }
  catch { pass++; console.log('✓', name) }
}

// ---------- buildMessages：可见性模型的核心 ----------
const me = { id: 'a1', name: '小明' }
const history = [
  { type: 'agent', agentId: 'a1', name: '小明', content: '我先说。' },     // 自己
  { type: 'agent', agentId: 'a2', name: '小红', content: '我反对。' },     // 他人
  { type: 'user', content: '你们展开讲讲' },                              // 用户插话
]

const msgs = buildMessages(me, '该不该加班', history)
eq(msgs[0], { role: 'user', content: '本次讨论的话题是：该不该加班' }, '话题作为开场 user 消息')
eq(msgs[1], { role: 'assistant', content: '我先说。' }, '自己的发言映射为 assistant')
eq(msgs[2], { role: 'user', content: '[小红]：我反对。' }, '他人发言映射为 user 带[名字]前缀')
eq(msgs[3], { role: 'user', content: '[用户]：你们展开讲讲' }, '用户插话带[用户]前缀')
eq(msgs.length, 4, '无引导时消息数=话题+历史')

// 主持人定向引导：作为临时 user 追加在末尾
const guided = buildMessages(me, 'T', history, '请聚焦成本')
eq(guided[guided.length - 1], { role: 'user', content: '（主持人提示）请聚焦成本' }, '引导作为末尾临时 user 消息')
ok(guided.length === msgs.length + 1, '引导使消息数+1')

// 空历史：只有话题开场
eq(buildMessages(me, '新话题', []), [{ role: 'user', content: '本次讨论的话题是：新话题' }], '空历史只含话题开场')

// 同名不同 id 不应被误判为"自己"（以 agentId 为准，不是 name）
const twin = buildMessages({ id: 'a1', name: '小明' }, 'T', [
  { type: 'agent', agentId: 'aX', name: '小明', content: '另一个同名的我' },
])
eq(twin[1].role, 'user', '同名但不同 id 的发言仍算他人（按 id 区分）')

// ---------- resolveProvider：model 兜底与缺失抛错 ----------
const providers = [{ id: 'p1', name: 'P', models: ['m1', 'm2'] }]
eq(resolveProvider({ providerId: 'p1', model: 'm2' }, providers).model, 'm2', '合法 model 原样返回')
eq(resolveProvider({ providerId: 'p1', model: '不存在' }, providers).model, 'm1', 'model 不在列表时回退到首个')
ok(resolveProvider({ providerId: 'p1', model: 'm1' }, providers).provider === providers[0], '返回对应 provider 引用')
throws(() => resolveProvider({ providerId: '不存在', model: 'm1' }, providers), '缺 provider 抛错')
// models 为空（未探测模型列表）时不应强行覆盖用户填的 model
eq(resolveProvider({ providerId: 'p2', model: '随便填' }, [{ id: 'p2', models: [] }]).model, '随便填', 'models 为空时保留用户 model')

// ---------- parseModeratorDecision：LLM 输出容错 ----------
eq(parseModeratorDecision('{"next":"a1","shouldEnd":false}'), { next: 'a1', shouldEnd: false }, '裸 JSON 正常解析')
eq(parseModeratorDecision('```json\n{"next":"a2"}\n```').next, 'a2', '剥离 ```json 代码块')
eq(parseModeratorDecision('好的，我的决策是：{"shouldEnd":true,"reason":"已达成共识"} 以上。').shouldEnd, true, '从解释文字中提取 JSON')
eq(parseModeratorDecision('我觉得应该继续讨论'), null, '无 JSON 返回 null')
eq(parseModeratorDecision('{坏掉的 json'), null, '半截/非法 JSON 返回 null')
eq(parseModeratorDecision(''), null, '空字符串返回 null')
eq(parseModeratorDecision(undefined), null, 'undefined 返回 null')

// ---------- resolveRounds：续聊收敛轮数（修复 #1）----------
// round-robin：新讨论用配置轮数，续聊只 1 轮
eq(resolveRounds({ mode: 'round-robin', isContinuation: false, agentCount: 3, rounds: 3 }), { rounds: 3 }, 'round-robin 新讨论用配置轮数')
eq(resolveRounds({ mode: 'round-robin', isContinuation: true, agentCount: 3, rounds: 3 }), { rounds: 1 }, 'round-robin 续聊收敛到 1 轮')
// moderator：新讨论用 maxTurns（或默认 agentCount*rounds），续聊收敛到约一轮(=agentCount)
eq(resolveRounds({ mode: 'moderator', isContinuation: false, agentCount: 3, rounds: 2, maxTurns: 8 }), { maxTurns: 8 }, 'moderator 新讨论用配置 maxTurns')
eq(resolveRounds({ mode: 'moderator', isContinuation: false, agentCount: 3, rounds: 2 }), { maxTurns: 6 }, 'moderator 无 maxTurns 时默认 agentCount*rounds')
eq(resolveRounds({ mode: 'moderator', isContinuation: true, agentCount: 3, rounds: 2, maxTurns: 8 }), { maxTurns: 3 }, '★moderator 续聊收敛到 agentCount(不再跑满 maxTurns=8)')
eq(resolveRounds({ mode: 'moderator', isContinuation: true, agentCount: 5, rounds: 3, maxTurns: 30 }), { maxTurns: 5 }, '★moderator 续聊不受大 maxTurns 影响')

// ---------- buildTranscript：总结取数源（修复 #2）----------
const sessionMessages = [
  { seq: 0, type: 'agent', agentId: 'a1', name: '甲', content: '观点A' },
  { seq: 1, type: 'user', agentId: null, name: '用户', content: '追问X' },
  { seq: 2, type: 'agent', agentId: 'a2', name: '乙', content: '观点B' },
  { seq: 3, type: 'agent', agentId: '__summary__', name: '总结', content: '上次的总结' },
]
const tr = buildTranscript(sessionMessages)
ok(tr.includes('[甲]：观点A') && tr.includes('[乙]：观点B'), 'transcript 含各 agent 发言')
ok(tr.includes('[用户]：追问X'), 'transcript 含用户插话，标注[用户]')
ok(!tr.includes('上次的总结'), '★transcript 排除既往 __summary__，不把旧总结当讨论内容')
eq(buildTranscript([]), '', '空消息列表返回空串')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
