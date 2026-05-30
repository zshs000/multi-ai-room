// typewriter.js 单元测试。纯函数调度，不依赖 DOM。
// 运行：node test/typewriter.test.js
import { createTypewriter } from '../web/src/typewriter.js'

let pass = 0, fail = 0
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, '\n   期望:', e, '\n   实际:', a) }
}

function createFakeClock() {
  const tasks = []
  return {
    schedule(fn) {
      const task = { fn, canceled: false }
      tasks.push(task)
      return task
    },
    cancel(task) {
      if (task) task.canceled = true
    },
    runNext() {
      const task = tasks.shift()
      if (task && !task.canceled) task.fn()
    },
    get pendingCount() {
      return tasks.filter((task) => !task.canceled).length
    },
  }
}

// ---------- 逐字输出 ----------
{
  const out = []
  const clock = createFakeClock()
  const writer = createTypewriter({ append: (text) => out.push(text), schedule: clock.schedule, cancel: clock.cancel })

  writer.enqueue('你好')
  eq(out, [], 'enqueue 后不会立刻把整段文本写出')
  eq(clock.pendingCount, 1, 'enqueue 后安排一次打字 tick')

  clock.runNext()
  eq(out, ['你'], '第一个 tick 输出第一个字符')
  clock.runNext()
  eq(out, ['你', '好'], '第二个 tick 输出第二个字符')
  eq(clock.pendingCount, 0, '队列清空后不再继续调度')
}

// ---------- 多 chunk 保序 ----------
{
  const out = []
  const clock = createFakeClock()
  const writer = createTypewriter({ append: (text) => out.push(text), schedule: clock.schedule, cancel: clock.cancel })

  writer.enqueue('AB')
  writer.enqueue('CD')
  clock.runNext(); clock.runNext(); clock.runNext(); clock.runNext()
  eq(out.join(''), 'ABCD', '多个 chunk 按收到顺序逐字输出')
}

// ---------- flush ----------
{
  const out = []
  const clock = createFakeClock()
  const writer = createTypewriter({ append: (text) => out.push(text), schedule: clock.schedule, cancel: clock.cancel })

  writer.enqueue('剩余文本')
  clock.runNext()
  writer.flush()
  eq(out.join(''), '剩余文本', 'flush 会补齐未显示文本')
  eq(clock.pendingCount, 0, 'flush 会取消后续 tick')
}

// ---------- onIdle ----------
{
  const out = []
  const idle = []
  const clock = createFakeClock()
  const writer = createTypewriter({
    append: (text) => out.push(text),
    onIdle: () => idle.push('idle'),
    schedule: clock.schedule,
    cancel: clock.cancel,
  })

  writer.enqueue('打完')
  clock.runNext()
  eq(idle, [], '队列未清空时不触发 idle')
  clock.runNext()
  eq(idle, ['idle'], '队列自然清空后触发 idle')
}

// ---------- stop ----------
{
  const out = []
  const clock = createFakeClock()
  const writer = createTypewriter({ append: (text) => out.push(text), schedule: clock.schedule, cancel: clock.cancel })

  writer.enqueue('不会完整显示')
  writer.stop()
  clock.runNext()
  writer.enqueue('忽略')
  eq(out, [], 'stop 会丢弃待显示文本并忽略后续输入')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
