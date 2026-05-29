// store.js 原子写 + 严格读取测试（用项目内临时文件，绝不碰真实 config.json）。
// 运行：node test/store-io.test.js
import { readFile, writeFile, unlink, readdir } from 'node:fs/promises'
import { readJsonStrict, atomicWriteJson, ConfigCorruptError } from '../src/store.js'

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name) }
}
function eq(actual, expected, name) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), name)
}
async function rejects(fn, name) {
  try { await fn(); fail++; console.log('✗', name, '（未抛错）') }
  catch { pass++; console.log('✓', name) }
}

const dir = new URL('./', import.meta.url)
const tmp = new URL('./_store_io_test.json', dir)
const tmpPath = new URL('', tmp)

try {
  // ---------- readJsonStrict ----------
  // 文件不存在 → {}（首次启动合法）
  eq(await readJsonStrict(new URL('./_nope_no_such.json', dir)), {}, '不存在的文件返回 {}')

  // 正常 JSON 正确读回
  await writeFile(tmp, JSON.stringify({ providers: [{ apiKey: 'sk-x' }] }), 'utf8')
  eq((await readJsonStrict(tmp)).providers[0].apiKey, 'sk-x', '正常 JSON 读回内容')

  // 空文件 → {}
  await writeFile(tmp, '   ', 'utf8')
  eq(await readJsonStrict(tmp), {}, '空文件返回 {}')

  // 半截/损坏 JSON → 抛 ConfigCorruptError（关键：绝不静默返回 {} 抹掉 key）
  await writeFile(tmp, '{"providers":[{"apiKey":"sk-', 'utf8')
  await rejects(() => readJsonStrict(tmp), '损坏 JSON 抛错而非静默返回 {}')
  let threw = null
  try { await readJsonStrict(tmp) } catch (e) { threw = e }
  ok(threw instanceof ConfigCorruptError, '抛的是 ConfigCorruptError 类型')

  // ---------- atomicWriteJson ----------
  const data = { providers: [{ id: 'p1', apiKey: 'sk-secret' }], agents: [], rounds: 3 }
  await atomicWriteJson(tmp, data)
  eq(JSON.parse(await readFile(tmp, 'utf8')), data, '原子写后内容完整可读')

  // 并发写 15 次：写锁串行化，最终文件必是完整 JSON（不撕裂）
  await Promise.all(Array.from({ length: 15 }, (_, i) =>
    atomicWriteJson(tmp, { ...data, marker: i })
  ))
  const after = JSON.parse(await readFile(tmp, 'utf8')) // 能 parse 就证明没写出半截
  ok(typeof after.marker === 'number' && after.providers[0].apiKey === 'sk-secret', '并发写后仍是完整 JSON 且 key 完好')

  // 不残留 .tmp 临时文件
  const leftover = (await readdir(dir)).filter((f) => f.includes('_store_io_test') && f.endsWith('.tmp'))
  eq(leftover, [], '原子写后无残留 .tmp 文件')
} finally {
  await unlink(tmp).catch(() => {})
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
