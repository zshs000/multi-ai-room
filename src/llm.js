// 统一 LLM 调用：屏蔽协议差异，对外只暴露 streamChat。
import { getAdapter } from './adapters.js'

// 发起一次流式对话。
//   provider: { protocol, baseUrl, apiKey }
//   model, systemPrompt, messages: ChatMsg[]
//   onToken(text): 每收到一段增量文本回调
//   signal: AbortSignal，可选，用于中断
// 返回：完整回复字符串
export async function streamChat({ provider, model, systemPrompt, messages, onToken, signal }) {
  const adapter = getAdapter(provider.protocol)
  const { url, headers, body } = adapter.buildRequest({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    systemPrompt,
    messages,
  })

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
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
}
