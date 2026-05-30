export function createTypewriter({ append, onIdle, schedule = defaultSchedule, cancel = defaultCancel }) {
  const queue = []
  let task = null
  let stopped = false

  function enqueue(text) {
    if (stopped || !text) return
    queue.push(...Array.from(text))
    scheduleNext()
  }

  function scheduleNext() {
    if (task || stopped || !queue.length) return
    task = schedule(tick)
  }

  function tick() {
    task = null
    if (stopped || !queue.length) return
    append(queue.shift())
    if (queue.length) scheduleNext()
    else onIdle?.()
  }

  function flush() {
    if (task) cancel(task)
    task = null
    if (queue.length) append(queue.splice(0).join(''))
  }

  function stop() {
    stopped = true
    if (task) cancel(task)
    task = null
    queue.length = 0
  }

  return { enqueue, flush, stop }
}

function defaultSchedule(fn) {
  return window.setTimeout(fn, 18)
}

function defaultCancel(task) {
  window.clearTimeout(task)
}
