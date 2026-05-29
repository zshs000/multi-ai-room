// sessions.js 单元测试。纯函数 + 真实文件往返（用完即删，sessions/ 已 gitignore）。
// 运行：node test/sessions.test.js
import { readdir } from 'node:fs/promises'
import {
  isValidId, snapshotAgents, tryAcquireRun, releaseRun,
  createSession, getSession, saveSession, renameSession, deleteSession, listSessions,
} from '../src/sessions.js'

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

// ---------- isValidId：路径注入防线 ----------
ok(isValidId('s_abc123'), '合法 id 通过')
ok(isValidId('s_KQ9Zv0'), '合法 id（含大写）通过')
ok(!isValidId('s_../etc/passwd'), '含 ../ 的 id 被拒')
ok(!isValidId('../../secret'), '路径穿越被拒')
ok(!isValidId('s_a/b'), '含斜杠被拒')
ok(!isValidId('s_a.b'), '含点被拒')
ok(!isValidId('abc'), '无 s_ 前缀被拒')
ok(!isValidId(''), '空串被拒')
ok(!isValidId(null), 'null 被拒')
ok(!isValidId(42), '非字符串被拒')

// ---------- snapshotAgents：安全——绝不泄露 apiKey ----------
const snap = snapshotAgents([
  { id: 'a1', name: 'X', color: '#f00', systemPrompt: 'P', providerId: 'p1', model: 'm1',
    apiKey: 'sk-LEAK', baseUrl: 'http://x', extra: 'noise' },
])
ok(!('apiKey' in snap[0]), '快照不含 apiKey')
ok(!('baseUrl' in snap[0]), '快照不含 baseUrl')
ok(!('extra' in snap[0]), '快照剔除未知字段')
eq(Object.keys(snap[0]).sort(), ['color', 'id', 'model', 'name', 'providerId', 'systemPrompt'], '快照只保留 6 个白名单字段')
ok(!JSON.stringify(snap).includes('sk-LEAK'), '快照序列化后无 key 痕迹')

// ---------- 运行锁语义 ----------
ok(tryAcquireRun('s_lock1') === true, '首次获取运行锁成功')
ok(tryAcquireRun('s_lock1') === false, '同会话重复获取失败')
ok(tryAcquireRun('s_lock2') === true, '不同会话可各自获取')
releaseRun('s_lock1')
ok(tryAcquireRun('s_lock1') === true, '释放后可再次获取')
releaseRun('s_lock1'); releaseRun('s_lock2')

// ---------- 真实文件往返 + 并发写（用完即删）----------
const created = []
try {
  const s = await createSession({ topic: '测试话题超过四十字'.repeat(5), agents: [{ id: 'a1', name: '甲' }], rounds: 2, orchestration: 'round-robin' })
  created.push(s.id)
  ok(isValidId(s.id), '新会话 id 合法')
  eq(s.title.length, 40, 'title 截断到 40 字')
  ok(!JSON.stringify(s.agentsSnapshot).includes('apiKey'), '落盘会话快照无 apiKey')

  const got = await getSession(s.id)
  eq(got.id, s.id, 'getSession 取回同一会话')

  await renameSession(s.id, '新名字')
  eq((await getSession(s.id)).title, '新名字', 'renameSession 生效')

  eq(await getSession('s_nonexistent999'), null, '不存在的会话返回 null')

  // 并发写：20 个 saveSession 同时打到同一会话，验证序列化 + 原子性（永不写出半截 JSON）
  const base = await getSession(s.id)
  await Promise.all(Array.from({ length: 20 }, (_, i) => {
    const copy = JSON.parse(JSON.stringify(base))
    copy.marker = i
    return saveSession(copy)
  }))
  const after = await getSession(s.id)
  ok(after !== null && typeof after.marker === 'number', '并发写后文件仍是完整可解析 JSON（原子性）')

  // 不应残留 .tmp 临时文件
  const dir = new URL('../sessions/', import.meta.url)
  const leftover = (await readdir(dir)).filter((f) => f.includes(s.id) && f.endsWith('.tmp'))
  eq(leftover, [], '并发写后无残留 .tmp 文件')

  // 出现在列表里
  ok((await listSessions()).some((x) => x.id === s.id), '会话出现在 listSessions')
} finally {
  for (const id of created) await deleteSession(id)
}
// 删除后确实没了
for (const id of created) eq(await getSession(id), null, '删除后会话不可再取')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
