import { streamChat } from './llm.js'

// 连通性测试：发一条极简非流式请求探活。
export async function testConnection({ protocol, baseUrl, apiKey, model }) {
  const start = Date.now()
  try {
    let full = ''
    await streamChat({
      provider: { protocol, baseUrl, apiKey },
      model,
      systemPrompt: '',
      messages: [{ role: 'user', content: '只回复"ok"两个字。' }],
      onToken: (t) => { full += t },
    })
    return { ok: true, message: `连通正常，返回：${full.slice(0, 20)}`, latencyMs: Date.now() - start }
  } catch (e) {
    // 防止错误信息里意外回显完整 apiKey
    let msg = e.message || '未知错误'
    if (apiKey && apiKey.length > 8) msg = msg.split(apiKey).join('***')
    return { ok: false, message: msg, latencyMs: Date.now() - start }
  }
}
