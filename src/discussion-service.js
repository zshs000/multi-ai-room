import { loadConfig, genId } from './store.js'
import { runRoundRobin, runModerated, runSummary, resolveRounds } from './orchestrator.js'
import { createSession, getSession, saveSession, deleteSession, tryAcquireRun, releaseRun } from './sessions.js'
import { sse } from './http.js'
import {
  DEFAULT_ORCHESTRATION,
  MODERATOR_ORCHESTRATION,
  SUMMARY_AGENT_COLOR,
  SUMMARY_AGENT_ID,
  SUMMARY_AGENT_NAME,
  USER_MESSAGE_COLOR,
} from './constants.js'

export async function runDiscussion(res, body, signal) {
  const config = await loadConfig()
  const discussionId = genId('d')
  const emit = (evt) => sse(res, { discussionId, ...evt })

  // 续聊已有会话 or 新建会话
  let session
  if (body.sessionId) {
    session = await getSession(body.sessionId)
    if (!session) {
      emit({ type: 'error', message: '会话不存在' })
      emit({ type: 'done' })
      return res.end()
    }
    // 续聊：该会话若已有讨论在跑，拒绝并发
    if (!tryAcquireRun(session.id)) {
      emit({ type: 'error', message: '该会话正在讨论中，请等待当前轮结束。' })
      emit({ type: 'done' })
      return res.end()
    }
  }
  const topic = session ? session.topic : (body.topic || '').trim()

  if (!config.agents.length) {
    if (session) releaseRun(session.id)
    emit({ type: 'error', message: '还没有任何 Agent，请先到设置里添加。' })
    emit({ type: 'done' })
    return res.end()
  }

  // 新建会话：用当前 agent 配置做快照
  let createdNew = false
  if (!session) {
    session = await createSession({
      topic,
      agents: config.agents,
      rounds: config.rounds,
      orchestration: config.orchestration || DEFAULT_ORCHESTRATION,
    })
    createdNew = true
    tryAcquireRun(session.id) // 新会话 id 唯一，必定成功
  }

  emit({ type: 'start', sessionId: session.id, topic })

  // 续聊时用会话快照的 agent（保人设语义）；新会话也用快照保持一致
  const agents = session.agentsSnapshot
  const providers = config.providers

  // 重建历史（续聊时从已存消息恢复）
  const history = session.messages.map((m) => ({
    type: m.type, agentId: m.agentId, name: m.name, color: m.color, round: m.round, content: m.content,
  }))

  // 用户插话：作为一条 user 消息进入历史并持久化
  if (body.interject) {
    const turn = { type: 'user', agentId: null, name: '用户', color: USER_MESSAGE_COLOR, round: 0, content: body.interject }
    history.push(turn)
    session.messages.push({ seq: session.messages.length, ...turn })
    await saveSession(session)
    emit({ type: 'user_message', content: body.interject })
  }

  // 持久化每条新发言。记录续聊前的发言数，用于判断本次是否真有新内容产出。
  const messagesBefore = session.messages.length
  const onTurn = async (turn) => {
    session.messages.push({ seq: session.messages.length, ...turn })
    await saveSession(session)
  }

  // 续聊（已有历史）时收敛轮数，避免重跑整场；轮数决策见 orchestrator.resolveRounds。
  const isContinuation = messagesBefore > 0 && (body.sessionId || body.interject)
  const mode = (session.orchestration || config.orchestration) === MODERATOR_ORCHESTRATION ? MODERATOR_ORCHESTRATION : DEFAULT_ORCHESTRATION

  try {
    // @指定 agent：只让该 agent 回应一次
    if (body.mention) {
      const agent = agents.find((a) => a.id === body.mention)
      if (agent) {
        await runRoundRobin({ agents: [agent], providers, topic, history, rounds: 1, emit, signal, onTurn })
      } else {
        emit({ type: 'error', message: '你 @ 的角色已不存在（可能已被删除）。' })
      }
    } else if (mode === MODERATOR_ORCHESTRATION) {
      // 主持人模式
      const modProvider = providers.find((p) => p.id === config.moderatorProviderId) || providers[0]
      const modModel = config.moderatorModel || modProvider?.models?.[0] || ''
      const { maxTurns } = resolveRounds({
        mode, isContinuation, agentCount: agents.length, rounds: config.rounds, maxTurns: config.maxTurns,
      })
      await runModerated({
        agents, providers, topic, history,
        maxTurns,
        moderator: { provider: modProvider, model: modModel },
        emit, signal, onTurn,
      })
    } else {
      // 固定轮流
      const { rounds } = resolveRounds({ mode, isContinuation, agentCount: agents.length, rounds: config.rounds })
      await runRoundRobin({ agents, providers, topic, history, rounds, emit, signal, onTurn })
    }

    // 总结：仅当本次真有新发言产出、开启总结、未中断时
    const producedNew = session.messages.length > messagesBefore
    if (config.summarize && !signal.aborted && producedNew) {
      const sumProvider = providers.find((p) => p.id === config.moderatorProviderId) || providers[0]
      const sumModel = config.moderatorModel || sumProvider?.models?.[0] || ''
      try {
        const summary = await runSummary({ summarizer: { provider: sumProvider, model: sumModel }, topic, messages: session.messages, emit, signal })
        await onTurn({ type: 'agent', agentId: SUMMARY_AGENT_ID, name: SUMMARY_AGENT_NAME, color: SUMMARY_AGENT_COLOR, round: 0, content: summary })
      } catch (e) {
        if (!signal.aborted) emit({ type: 'error', message: `总结出错：${e.message}` })
      }
    }
  } catch (e) {
    if (!signal.aborted) emit({ type: 'error', message: e.message })
  } finally {
    releaseRun(session.id)
  }

  // 全新会话若一条发言都没产出（如所有 provider 配错），删掉空壳，
  // 不在侧栏留下"0 条"的幽灵记录。用户已通过 error 事件看到失败原因。
  if (createdNew && session.messages.length === 0) {
    await deleteSession(session.id)
  }

  emit({ type: 'done', sessionId: session.id })
  res.end()
}
