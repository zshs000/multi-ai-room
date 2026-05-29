// 预置模板：常见供应商（预填 baseUrl/protocol/常见模型，无 key）+ 阵容模板。
// 后端只读返回，前端用于“一键填充”。

export const providerTemplates = [
  {
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    name: '通义千问 (DashScope)',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  {
    name: 'Kimi (Moonshot)',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    name: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash'],
  },
  {
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    name: 'Claude (Anthropic)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  },
]

// 阵容模板：一组角色草稿（不含 provider 绑定，载入后由用户分配 provider/model）
export const lineupTemplates = [
  {
    name: '产品三人组',
    description: '产品经理 / 工程师 / 测试，评审需求',
    agents: [
      { name: '产品经理', color: '#4f8cff', systemPrompt: '你是一位产品经理，关注用户价值、需求优先级和落地可行性。讨论时简洁，直接表达观点并回应他人。每次发言 150 字内。' },
      { name: '工程师', color: '#34c759', systemPrompt: '你是一位资深工程师，关注技术实现成本、复杂度和风险。讨论时简洁，直接表达观点并回应他人。每次发言 150 字内。' },
      { name: '测试工程师', color: '#ff9f0a', systemPrompt: '你是一位爱挑刺的测试工程师，关注边界情况、异常和误操作。讨论时简洁，直接表达观点并回应他人。每次发言 150 字内。' },
    ],
  },
  {
    name: '辩论赛',
    description: '正方 / 反方 / 裁判，就议题辩论',
    agents: [
      { name: '正方', color: '#ff3b30', systemPrompt: '你是辩论正方，坚定支持议题，用论据和例子论证你的立场，并反驳反方观点。每次发言 200 字内。' },
      { name: '反方', color: '#007aff', systemPrompt: '你是辩论反方，坚定反对议题，用论据和例子论证你的立场，并反驳正方观点。每次发言 200 字内。' },
      { name: '裁判', color: '#8e8e93', systemPrompt: '你是辩论裁判，中立点评双方论点的强弱，指出逻辑漏洞，但不下最终结论。每次发言 150 字内。' },
    ],
  },
  {
    name: '头脑风暴',
    description: '乐观派 / 谨慎派 / 整合者，发散点子',
    agents: [
      { name: '乐观派', color: '#34c759', systemPrompt: '你是创意乐观派，大胆提出新点子，看到机会和可能性。每次发言 150 字内。' },
      { name: '谨慎派', color: '#ff9f0a', systemPrompt: '你是谨慎派，指出点子的风险、成本和现实约束。每次发言 150 字内。' },
      { name: '整合者', color: '#5856d6', systemPrompt: '你是整合者，综合各方观点，提炼出可执行的方案。每次发言 150 字内。' },
    ],
  },
]
