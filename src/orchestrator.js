// 讨论编排器：支持固定轮流 / 主持人调度两种模式，流式产出事件。
// 通过 emit(event) 回调推送事件，调用方（server）负责转成 SSE。
import { streamChat } from './llm.js'

// 构造某 agent 能看到的消息历史。
// 自己的发言=assistant；他人发言/用户插话=user 带 [名字] 前缀。
function buildMessages(agent, topic, history, extraGuidance) {
  const messages = [{ role: 'user', content: `本次讨论的话题是：${topic}` }]
  for (const turn of history) {
    if (turn.type === 'agent' && turn.agentId === agent.id) {
      messages.push({ role: 'assistant', content: turn.content })
    } else {
      const speaker = turn.type === 'user' ? '用户' : turn.name
      messages.push({ role: 'user', content: `[${speaker}]：${turn.content}` })
    }
  }
  // 主持人的定向引导：作为临时 user 消息，不进共享历史
  if (extraGuidance) {
    messages.push({ role: 'user', content: `（主持人提示）${extraGuidance}` })
  }
  return messages
}

// 解析 provider + 校验 model，返回可用的 {provider, model} 或抛错
function resolveProvider(agent, providers) {
  const provider = providers.find((p) => p.id === agent.providerId)
  if (!provider) throw new Error(`供应商配置失效（provider_missing）`)
  let model = agent.model
  if (provider.models.length && !provider.models.includes(model)) {
    model = provider.models[0]
  }
  return { provider, model }
}

// 让一个 agent 发言（流式），返回完整回复文本
async function speak(agent, providers, topic, history, emit, signal, guidance, round) {
  const { provider, model } = resolveProvider(agent, providers)
  emit({ type: 'agent_start', agentId: agent.id, name: agent.name, color: agent.color, model, providerName: provider.name, round })
  const reply = await streamChat({
    provider, model,
    systemPrompt: agent.systemPrompt,
    messages: buildMessages(agent, topic, history, guidance),
    onToken: (text) => emit({ type: 'token', agentId: agent.id, text }),
    signal,
  })
  emit({ type: 'agent_end', agentId: agent.id })
  return reply
}

// ---------- 主持人决策 ----------
// 让主持人 LLM 返回 JSON：下一个谁发言 + 给他的引导 + 是否结束
async function moderatorDecide({ moderatorProvider, moderatorModel, agents, topic, history, turnCount, maxTurns, signal }) {
  const roster = agents.map((a) => `- ${a.id}（${a.name}）：${a.systemPrompt.slice(0, 40)}`).join('\n')
  const recent = history.slice(-8).map((t) => `[${t.type === 'user' ? '用户' : t.name}]：${t.content.slice(0, 120)}`).join('\n')
  const sys = `你是一场多人讨论的主持人。根据讨论进展，决定下一个该谁发言，并给他一句定向引导（让讨论深入、避免重复立场、推动达成结论）。当讨论已充分或达成共识时结束。

可发言的人：
${roster}

只返回 JSON，格式：{"next":"agentId","guidance":"给这个人的一句话引导","shouldEnd":false,"reason":"简短理由"}
当应该结束时返回 {"shouldEnd":true,"reason":"..."}。不要返回其它任何内容。`
  const user = `话题：${topic}\n\n最近的发言：\n${recent || '（还没有人发言）'}\n\n已进行 ${turnCount} 轮发言（上限 ${maxTurns}）。请决策下一步。`

  let raw = ''
  await streamChat({
    provider: moderatorProvider, model: moderatorModel,
    systemPrompt: sys,
    messages: [{ role: 'user', content: user }],
    onToken: (t) => { raw += t },
    signal,
  })
  return parseModeratorDecision(raw)
}

// 从主持人 LLM 的原始输出里提取决策 JSON（可能被 ```json 包裹或夹在解释文字中）。
// 解析失败一律返回 null，让上层走兜底逻辑。
function parseModeratorDecision(raw) {
  const match = (raw || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// ---------- 固定轮流模式 ----------
async function runRoundRobin({ agents, providers, topic, history, rounds, emit, signal, onTurn }) {
  for (let r = 0; r < rounds; r++) {
    for (const agent of agents) {
      if (signal.aborted) return
      try {
        const reply = await speak(agent, providers, topic, history, emit, signal, null, r + 1)
        const turn = { type: 'agent', agentId: agent.id, name: agent.name, color: agent.color, round: r + 1, content: reply }
        history.push(turn)
        await onTurn?.(turn)
      } catch (e) {
        if (signal.aborted) return
        emit({ type: 'error', agentId: agent.id, message: `${agent.name}：${e.message}` })
      }
    }
  }
}

// ---------- 主持人模式 ----------
async function runModerated({ agents, providers, topic, history, maxTurns, moderator, emit, signal, onTurn }) {
  const { provider: moderatorProvider, model: moderatorModel } = moderator
  let turnCount = 0
  while (turnCount < maxTurns) {
    if (signal.aborted) return
    let decision
    try {
      decision = await moderatorDecide({ moderatorProvider, moderatorModel, agents, topic, history, turnCount, maxTurns, signal })
    } catch (e) {
      if (signal.aborted) return
      emit({ type: 'error', message: `主持人决策出错：${e.message}` })
      decision = null
    }
    // 决策失效兜底：回退到轮流挑下一个
    if (!decision) {
      const fallback = agents[turnCount % agents.length]
      decision = { next: fallback.id, guidance: '', reason: '主持人决策失败，回退轮流' }
    }
    if (decision.shouldEnd) {
      emit({ type: 'moderator_decision', shouldEnd: true, reason: decision.reason || '讨论结束' })
      return
    }
    const agent = agents.find((a) => a.id === decision.next)
    if (!agent) {
      // 非法 agentId 兜底
      const fallback = agents[turnCount % agents.length]
      emit({ type: 'moderator_decision', next: fallback.id, name: fallback.name, reason: '主持人选了无效对象，已回退' })
      turnCount++
      continue
    }
    emit({ type: 'moderator_decision', next: agent.id, name: agent.name, reason: decision.reason || '' })
    try {
      const reply = await speak(agent, providers, topic, history, emit, signal, decision.guidance, turnCount + 1)
      const turn = { type: 'agent', agentId: agent.id, name: agent.name, color: agent.color, round: turnCount + 1, content: reply }
      history.push(turn)
      await onTurn?.(turn)
    } catch (e) {
      if (signal.aborted) return
      emit({ type: 'error', agentId: agent.id, message: `${agent.name}：${e.message}` })
    }
    turnCount++
  }
}

// ---------- 总结 ----------
// 从消息列表构建讨论记录文本。事实源应是持久化的 session.messages，
// 而非编排内部的 history（两者靠双写同步，易漂移）——统一从一个源构建。
// 排除既往的总结消息（__summary__），避免把上次总结当成讨论内容再喂进去。
function buildTranscript(messages) {
  return messages
    .filter((t) => t.agentId !== '__summary__')
    .map((t) => `[${t.type === 'user' ? '用户' : t.name}]：${t.content}`)
    .join('\n\n')
}

async function runSummary({ summarizer, topic, messages, emit, signal }) {
  const { provider, model } = summarizer
  const transcript = buildTranscript(messages)
  emit({ type: 'agent_start', agentId: '__summary__', name: '总结', color: '#5856d6', model, providerName: provider.name, round: 0 })
  const reply = await streamChat({
    provider, model,
    systemPrompt: '你是讨论总结者。请客观提炼以下讨论的核心共识、主要分歧和结论，条理清晰，用 markdown。',
    messages: [{ role: 'user', content: `话题：${topic}\n\n讨论记录：\n${transcript}\n\n请总结。` }],
    onToken: (t) => emit({ type: 'token', agentId: '__summary__', text: t }),
    signal,
  })
  emit({ type: 'agent_end', agentId: '__summary__' })
  return reply
}

// ---------- 轮数 / 上限决策（纯函数，便于测试）----------
// 统一决定一次讨论该跑多少：
// - round-robin 返回 { rounds }：每个 agent 依次发言的轮数
// - moderator   返回 { maxTurns }：主持人模式允许的最大发言次数
// 续聊（isContinuation）时两种模式都收敛到"约一轮"，不重开整场，
// 避免主持人模式续聊跑满 maxTurns 造成额外 API 消耗与不可控体验。
function resolveRounds({ mode, isContinuation, agentCount, rounds, maxTurns }) {
  const r = rounds || 1
  if (mode === 'moderator') {
    if (isContinuation) return { maxTurns: agentCount } // 约一轮：每人一次的量级
    return { maxTurns: maxTurns || (agentCount * (rounds || 2)) }
  }
  // round-robin
  return { rounds: isContinuation ? 1 : r }
}

export { buildMessages, resolveProvider, speak, runRoundRobin, runModerated, runSummary, moderatorDecide, parseModeratorDecision, resolveRounds, buildTranscript }
