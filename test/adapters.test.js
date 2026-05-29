// 适配器层单元测试（零依赖，不触网）。运行：node test/adapters.test.js
import { getAdapter, normalizeBaseUrl } from '../src/adapters.js'

let pass = 0, fail = 0
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('✓', name) }
  else { fail++; console.log('✗', name, '\n   期望:', e, '\n   实际:', a) }
}

// baseUrl 规范化
eq(normalizeBaseUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com', '剥除结尾/v1')
eq(normalizeBaseUrl('https://api.x.com/'), 'https://api.x.com', '去结尾斜杠')

// OpenAI 请求构造
const oa = getAdapter('openai')
const oaReq = oa.buildRequest({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-1', model: 'deepseek-chat', systemPrompt: '你是A', messages: [{ role: 'user', content: 'hi' }] })
eq(oaReq.url, 'https://api.deepseek.com/v1/chat/completions', 'OpenAI URL')
eq(oaReq.headers.Authorization, 'Bearer sk-1', 'OpenAI 认证头')
eq(oaReq.body.messages[0], { role: 'system', content: '你是A' }, 'OpenAI system 进 messages')

// OpenAI 流解析
const oaP = oa.createStreamParser()
eq(oaP.push('data: {"choices":[{"delta":{"content":"你好"}}]}'), [{ type: 'delta', text: '你好' }], 'OpenAI 增量')
eq(oaP.push('data: [DONE]'), [{ type: 'done' }], 'OpenAI 结束')
eq(oaP.push(': ping'), [], 'OpenAI 忽略非data行')

// Anthropic 请求构造
const an = getAdapter('anthropic')
const anReq = an.buildRequest({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-2', model: 'claude-3', systemPrompt: '你是B', messages: [{ role: 'user', content: 'hi' }] })
eq(anReq.url, 'https://api.anthropic.com/v1/messages', 'Anthropic URL')
eq(anReq.headers['x-api-key'], 'sk-2', 'Anthropic 认证头')
eq(anReq.headers['anthropic-version'], '2023-06-01', 'Anthropic 版本头')
eq(anReq.body.system, '你是B', 'Anthropic system 顶层')
eq(anReq.body.messages.length, 1, 'Anthropic messages 不含 system')

// Anthropic 流解析
const anP = an.createStreamParser()
eq(anP.push('data: {"type":"content_block_delta","delta":{"text":"嗨"}}'), [{ type: 'delta', text: '嗨' }], 'Anthropic 增量')
eq(anP.push('data: {"type":"message_stop"}'), [{ type: 'done' }], 'Anthropic 结束')
eq(anP.push('data: {"type":"ping"}'), [], 'Anthropic 忽略ping')
eq(anP.push('event: message_stop'), [], 'Anthropic 忽略event行')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
