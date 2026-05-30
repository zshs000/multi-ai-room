<script setup>
import { ref, onMounted, nextTick, computed } from 'vue'
import { api, startDiscuss } from './api.js'
import SettingsDrawer from './components/SettingsDrawer.vue'
import RenameSessionModal from './components/RenameSessionModal.vue'
import DialogModal from './components/DialogModal.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import ChatMessages from './components/ChatMessages.vue'
import ComposerBar from './components/ComposerBar.vue'
import { useDialog } from './composables/useDialog.js'
import { useTheme } from './composables/useTheme.js'
import { createTypewriter } from './typewriter.js'
import {
  AUTO_SCROLL_THRESHOLD_PX,
  DEFAULT_ORCHESTRATION,
  DEFAULT_ROUNDS,
  EXPORT_FILENAME_TOPIC_LENGTH,
  SUMMARY_AGENT_ID,
  TOAST_DURATION_MS,
} from './constants.js'

const messages = ref([]) // {kind:'system'|'agent'|'error'|'user'|'moderator', ...}
const topic = ref('')
const running = ref(false)
const showSettings = ref(false)
const config = ref({ providers: [], agents: [], rounds: DEFAULT_ROUNDS, orchestration: DEFAULT_ORCHESTRATION })
const chatEl = ref(null)
const { theme, applyTheme, toggleTheme } = useTheme()
const autoScroll = ref(true)
const sessions = ref([])
const currentSessionId = ref(null)
const showSidebar = ref(true)
const toast = ref('') // 居中偏上的轻提示文字，空=不显示
const { dialog, confirmDialog, resolveDialog } = useDialog()
let toastTimer = null
function showToast(text) {
  toast.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, TOAST_DURATION_MS)
}
let controller = null
let lastTopic = ''
let activeDiscussion = null

async function loadConfig() {
  config.value = await api.getConfig()
}
async function loadSessions() {
  sessions.value = await api.listSessions()
}
onMounted(() => {
  loadConfig()
  loadSessions()
  applyTheme()
})

// ---------- 智能滚动 ----------
function onScroll() {
  const el = chatEl.value
  if (!el) return
  autoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX
}
function scrollToBottom() {
  if (!autoScroll.value) return
  nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
  })
}

function addSystem(text) {
  messages.value.push({ kind: 'system', text })
  scrollToBottom()
}

// 把 SSE 事件渲染进消息流
function handleEvent(evt, ctx) {
  if (evt.type === 'start') {
    currentSessionId.value = evt.sessionId
  } else if (evt.type === 'moderator_decision') {
    if (evt.shouldEnd) addSystem(`🎤 主持人：${evt.reason || '讨论结束'}`)
    else addSystem(`🎤 主持人 → ${evt.name}${evt.reason ? '：' + evt.reason : ''}`)
  } else if (evt.type === 'user_message') {
    messages.value.push({ kind: 'user', text: evt.content })
    scrollToBottom()
  } else if (evt.type === 'agent_start') {
    ctx.writer?.flush()
    ctx.current = { kind: 'agent', agentId: evt.agentId, name: evt.name, color: evt.color, model: evt.model, providerName: evt.providerName, round: evt.round, text: '', isSummary: evt.agentId === SUMMARY_AGENT_ID }
    ctx.agentEnded = false
    ctx.writer = createTypewriter({
      append: (text) => { ctx.current.text += text; scrollToBottom() },
      onIdle: () => {
        if (ctx.agentEnded) ctx.writer = null
        if (ctx.donePending) finishDiscussion(ctx)
      },
    })
    messages.value.push(ctx.current)
    // 重新指向数组里的响应式代理：之后逐字 append 才会被 Vue 追踪并重渲染（直接改 push 前的原始对象不触发）
    ctx.current = messages.value[messages.value.length - 1]
    scrollToBottom()
  } else if (evt.type === 'token') {
    ctx.writer?.enqueue(evt.text)
  } else if (evt.type === 'agent_end') {
    ctx.agentEnded = true
  } else if (evt.type === 'error') {
    ctx.writer?.flush()
    ctx.writer = null
    messages.value.push({ kind: 'error', text: evt.message })
    scrollToBottom()
  } else if (evt.type === 'done') {
    if (ctx.writer) {
      ctx.donePending = true
    } else {
      finishDiscussion(ctx)
    }
  }
}

function finishDiscussion(ctx) {
  ctx.writer = null
  ctx.donePending = false
  if (activeDiscussion === ctx) activeDiscussion = null
  running.value = false
  loadSessions() // 刷新会话列表（新会话/消息数）
}

function runTopic(t) {
  running.value = true
  autoScroll.value = true
  lastTopic = t
  currentSessionId.value = null // 新讨论
  messages.value = []
  addSystem(`话题：${t}`)
  const ctx = { current: null, writer: null, agentEnded: false, donePending: false }
  activeDiscussion = ctx
  controller = startDiscuss({ topic: t }, (evt) => handleEvent(evt, ctx))
}

function start() {
  const t = topic.value.trim()
  if (!t || running.value) return
  if (!config.value.agents.length) {
    addSystem('还没有 Agent，请先点右上角「设置」添加。')
    return
  }
  topic.value = ''
  runTopic(t)
}

// 用户插话（续聊当前会话）。支持 @agent 语法
const mentionTarget = ref('') // 选中要 @的 agentId，空=全体
function interject() {
  const t = topic.value.trim()
  if (!t || running.value || !currentSessionId.value) return
  topic.value = ''
  running.value = true
  autoScroll.value = true
  const ctx = { current: null, writer: null, agentEnded: false, donePending: false }
  activeDiscussion = ctx
  const opts = { sessionId: currentSessionId.value, interject: t }
  if (mentionTarget.value) opts.mention = mentionTarget.value
  controller = startDiscuss(opts, (evt) => handleEvent(evt, ctx))
  mentionTarget.value = ''
}

function retry() {
  if (running.value || !lastTopic) return
  runTopic(lastTopic)
}

function stop() {
  if (controller) controller.abort()
  activeDiscussion?.writer?.stop()
  activeDiscussion = null
  running.value = false
  const last = messages.value[messages.value.length - 1]
  if (last && last.kind === 'agent') last.interrupted = true
  addSystem('已停止。')
}

// ---------- 会话管理 ----------
async function loadSession(id) {
  if (running.value) return
  const s = await api.getSession(id)
  if (!s) return
  currentSessionId.value = s.id
  lastTopic = s.topic
  messages.value = [{ kind: 'system', text: `话题：${s.topic}` }]
  for (const m of s.messages) {
    if (m.type === 'user') messages.value.push({ kind: 'user', text: m.content })
    else messages.value.push({ kind: 'agent', agentId: m.agentId, name: m.name, color: m.color, model: m.model, round: m.round, text: m.content, isSummary: m.agentId === SUMMARY_AGENT_ID })
  }
  autoScroll.value = true
  scrollToBottom()
}
function newChat() {
  if (running.value) return
  // 已经是空白新讨论（无会话、无消息）：提示用户，不重复清空
  if (!currentSessionId.value && messages.value.length === 0) {
    showToast('已经是最新讨论了')
    return
  }
  currentSessionId.value = null
  messages.value = []
  lastTopic = ''
}
async function delSession(id) {
  const confirmed = await confirmDialog({
    title: '删除会话',
    message: '删除这个会话？',
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  await api.deleteSession(id)
  if (currentSessionId.value === id) newChat()
  await loadSessions()
}
// 重命名弹框：居中输入框替代原生 prompt
const renaming = ref(null) // { id, title } 正在重命名的会话；null=关闭
function renameSessionPrompt(s) {
  renaming.value = { id: s.id, title: s.title }
}
async function confirmRename(title) {
  if (!renaming.value) return
  await api.renameSession(renaming.value.id, title)
  renaming.value = null
  await loadSessions()
}

// ---------- 导出 Markdown ----------
function exportMarkdown() {
  if (!messages.value.length) return
  let md = `# ${lastTopic || '讨论记录'}\n\n`
  for (const m of messages.value) {
    if (m.kind === 'agent') md += `## ${m.name}${m.isSummary ? '（总结）' : ` · ${m.model || ''}`}\n\n${m.text}\n\n`
    else if (m.kind === 'user') md += `> **用户**：${m.text}\n\n`
    else if (m.kind === 'system') md += `*${m.text}*\n\n`
  }
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `讨论_${(lastTopic || 'export').slice(0, EXPORT_FILENAME_TOPIC_LENGTH)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function clearChat() {
  if (running.value) return
  newChat()
}

const canInterject = computed(() => currentSessionId.value && !running.value && messages.value.length > 0)

async function onSettingsClose() {
  showSettings.value = false
  await loadConfig()
}
</script>

<template>
  <div class="layout" :class="{ 'sidebar-hidden': !showSidebar }">
    <!-- 居中偏上的轻提示 -->
    <transition name="toast">
      <div v-if="toast" class="app-toast">{{ toast }}</div>
    </transition>
    <SessionSidebar
      :sessions="sessions"
      :current-session-id="currentSessionId"
      :running="running"
      @new-chat="newChat"
      @load-session="loadSession"
      @rename-session="renameSessionPrompt"
      @delete-session="delSession"
    />

    <!-- 主区 -->
    <div class="main-area">
      <header>
        <div class="header-left">
          <button class="ghost icon" @click="showSidebar = !showSidebar" title="切换侧栏">☰</button>
          <h1>多 AI 讨论室</h1>
        </div>
        <div class="agents-preview">
          <span class="mode-tag" :title="'当前编排模式'">{{ config.orchestration === 'moderator' ? '🎤 主持人' : '🔄 轮流' }}</span>
          <button class="ghost icon" @click="exportMarkdown" :disabled="!messages.length" title="导出 Markdown">⬇</button>
          <button class="ghost icon" @click="toggleTheme" :title="theme === 'light' ? '切换深色' : '切换浅色'">
            {{ theme === 'light' ? '🌙' : '☀️' }}
          </button>
          <button class="ghost icon" @click="clearChat" :disabled="running || !messages.length" title="清空当前">🗑</button>
          <button class="ghost" @click="showSettings = true">⚙ 设置</button>
        </div>
      </header>

      <main ref="chatEl" @scroll="onScroll">
        <ChatMessages
          :messages="messages"
          :running="running"
          :agent-count="config.agents.length"
          @retry="retry"
        />
      </main>

      <ComposerBar
        v-model="topic"
        v-model:mention-target="mentionTarget"
        :agents="config.agents"
        :running="running"
        :can-interject="canInterject"
        @start="start"
        @interject="interject"
        @stop="stop"
      />
    </div>

    <SettingsDrawer v-if="showSettings" :config="config" @close="onSettingsClose" @changed="loadConfig" />
    <DialogModal :dialog="dialog" @resolve="resolveDialog" />

    <RenameSessionModal
      v-if="renaming"
      :session="renaming"
      @close="renaming = null"
      @submit="confirmRename"
    />
  </div>
</template>

<style scoped>
.layout { height: 100%; display: flex; }

/* 居中偏上的轻提示 toast */
.app-toast {
  position: fixed; top: 10%; left: 50%; transform: translate(-50%, -50%);
  z-index: 200; padding: 9px 18px; border-radius: 9px;
  font-size: 13px; font-weight: 500; color: #fff; background: #323233;
  box-shadow: 0 6px 20px rgba(0,0,0,0.18); pointer-events: none;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }

/* 主区 */
.main-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
header {
  background: var(--panel); padding: 12px 20px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.header-left { display: flex; align-items: center; gap: 10px; }
header h1 { font-size: 18px; font-weight: 600; }
.agents-preview { display: flex; align-items: center; gap: 8px; }
.mode-tag { font-size: 12px; padding: 3px 10px; background: var(--code-bg); border-radius: 999px; color: var(--muted); }
.icon { padding: 6px 9px; }

main { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }

/* 响应式 */
@media (max-width: 600px) {
  header { padding: 10px 14px; }
  header h1 { font-size: 16px; }
  main { padding: 14px; }
}
</style>
