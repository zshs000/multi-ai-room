// 统一 LLM 调用：屏蔽协议差异，对外只暴露 streamChat。
import { getAdapter } from './adapters.js'

// 发起一次流式对话。
//   provider: { protocol, baseUrl, apiKey }
//   model, systemPrompt, messages: ChatMsg[]
//   onToken(text): 每收到一段增量文本回调
//   signal: AbortSignal，可选，用于用户中断
//   idleTimeoutMs: 空闲超时（无数据多久判定卡死），默认 60s
// 返回：完整回复字符串
export async function streamChat({ provider, model, systemPrompt, messages, onToken, signal, idleTimeoutMs = 60000 }) {
  const adapter = getAdapter(provider.protocol)
  const { url, headers, body } = adapter.buildRequest({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    systemPrompt,
    messages,
  })

  // 合并用户中断信号与空闲超时信号：任一触发即 abort 请求
  const timeoutAc = new AbortController()
  let timedOut = false
  let idleTimer = null
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { timedOut = true; timeoutAc.abort() }, idleTimeoutMs)
  }
  const signals = [timeoutAc.signal]
  if (signal) signals.push(signal)
  const merged = AbortSignal.any(signals)

  resetIdle()
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: merged,
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`接口返回 ${resp.status}：${text.slice(0, 300)}`)
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    const parser = adapter.createStreamParser()
    let buffer = ''
    let full = ''
    let done = false

    while (!done) {
      const { done: streamEnd, value } = await reader.read()
      if (streamEnd) break
      resetIdle() // 收到数据，重置空闲计时
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() // 末段可能不完整，留到下次
      for (const line of lines) {
        for (const evt of parser.push(line)) {
          if (evt.type === 'delta') {
            full += evt.text
            onToken?.(evt.text)
          } else if (evt.type === 'done') {
            done = true
          }
        }
      }
    }
    return full
  } catch (e) {
    if (timedOut) throw new Error(`响应超时（${idleTimeoutMs / 1000}秒无数据）`)
    throw e
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}
