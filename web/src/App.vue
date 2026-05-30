<script setup>
import { ref, onMounted, nextTick, computed } from 'vue'
import { api, startDiscuss } from './api.js'
import { renderMarkdown } from './markdown.js'
import SettingsDrawer from './components/SettingsDrawer.vue'
import RenameSessionModal from './components/RenameSessionModal.vue'
import DialogModal from './components/DialogModal.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import { useDialog } from './composables/useDialog.js'
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
const theme = ref(localStorage.getItem('theme') || 'light')
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

// ---------- 主题 ----------
function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme.value)
}
function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  localStorage.setItem('theme', theme.value)
  applyTheme()
}

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
    ctx.current = { kind: 'agent', agentId: evt.agentId, name: evt.name, color: evt.color, model: evt.model, providerName: evt.providerName, round: evt.round, text: '', isSummary: evt.agentId === SUMMARY_AGENT_ID }
    messages.value.push(ctx.current)
    scrollToBottom()
  } else if (evt.type === 'token') {
    if (ctx.current) { ctx.current.text += evt.text; scrollToBottom() }
  } else if (evt.type === 'error') {
    messages.value.push({ kind: 'error', text: evt.message })
    scrollToBottom()
  } else if (evt.type === 'done') {
    running.value = false
    loadSessions() // 刷新会话列表（新会话/消息数）
  }
}

function runTopic(t) {
  running.value = true
  autoScroll.value = true
  lastTopic = t
  currentSessionId.value = null // 新讨论
  messages.value = []
  addSystem(`话题：${t}`)
  const ctx = { current: null }
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
  const ctx = { current: null }
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

function initial(name) {
  return (name || '?').trim().charAt(0)
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
        <div v-if="!messages.length" class="empty">
          输入一个话题，让 {{ config.agents.length || '多个' }} 个 AI 智能体讨论。
        </div>
        <template v-for="(m, i) in messages" :key="i">
          <div v-if="m.kind === 'system'" class="system-msg">{{ m.text }}</div>
          <div v-else-if="m.kind === 'user'" class="user-msg">
            <div class="user-bubble">{{ m.text }}</div>
          </div>
          <div v-else-if="m.kind === 'error'" class="error-msg">
            <span>{{ m.text }}</span>
            <button v-if="!running && i === messages.length - 1" class="retry-btn" @click="retry">重试</button>
          </div>
          <div v-else class="msg" :class="{ 'msg-summary': m.isSummary }">
            <div class="avatar" :style="{ background: m.color }">{{ m.isSummary ? '∑' : initial(m.name) }}</div>
            <div class="msg-body">
              <div class="who">
                {{ m.name }}
                <span v-if="!m.isSummary" class="meta">{{ m.providerName }} · {{ m.model }} · 第{{ m.round }}轮</span>
                <span v-if="m.interrupted" class="interrupted">已中断</span>
              </div>
              <div class="bubble" :style="{ borderLeftColor: m.color }">
                <div class="md" v-html="renderMarkdown(m.text)"></div><span v-if="running && i === messages.length - 1" class="cursor">▋</span>
              </div>
            </div>
          </div>
        </template>
      </main>

      <footer>
        <!-- @目标选择（仅续聊时显示）-->
        <select v-if="canInterject" v-model="mentionTarget" class="mention-select" title="指定回应者">
          <option value="">全体</option>
          <option v-for="a in config.agents" :key="a.id" :value="a.id">@{{ a.name }}</option>
        </select>
        <input
          v-model="topic"
          :placeholder="canInterject ? '追问或补充，按回车继续讨论…' : '输入讨论话题，回车开始…'"
          @keydown.enter="canInterject ? interject() : start()"
          :disabled="running"
        />
        <button v-if="running" class="danger" @click="stop">停止</button>
        <button v-else-if="canInterject" class="primary" @click="interject">追问</button>
        <button v-else class="primary" @click="start">开始讨论</button>
      </footer>
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
.empty { color: var(--muted); text-align: center; margin-top: 40px; }
.system-msg { align-self: center; color: var(--muted); font-size: 13px; }

/* 用户消息（右对齐）*/
.user-msg { align-self: flex-end; max-width: 70%; }
.user-bubble { background: var(--primary); color: #fff; padding: 10px 14px; border-radius: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }

.error-msg { align-self: center; color: var(--danger); background: var(--danger-bg); padding: 8px 14px; border-radius: 8px; font-size: 14px; display: flex; align-items: center; gap: 10px; }
.retry-btn { padding: 3px 12px; font-size: 13px; background: var(--danger); color: #fff; }

.msg { display: flex; gap: 10px; max-width: 80%; }
.msg-summary { max-width: 90%; align-self: center; width: 90%; }
.msg-summary .bubble { background: var(--code-bg); border-left-width: 4px; }
.avatar { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600; }
.msg-body { min-width: 0; }
.who { font-size: 13px; color: var(--muted); margin-bottom: 4px; padding: 0 2px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.meta { font-size: 11px; color: var(--meta); }
.interrupted { font-size: 11px; color: var(--danger); background: var(--danger-bg); padding: 1px 7px; border-radius: 999px; }
.bubble {
  background: var(--panel); border-radius: 14px; padding: 12px 16px; line-height: 1.6;
  word-break: break-word; border-left: 4px solid #ccc;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
/* Markdown 排版 */
.md :deep(p) { margin: 0 0 8px; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(ul), .md :deep(ol) { margin: 6px 0; padding-left: 22px; }
.md :deep(li) { margin: 3px 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3) { font-size: 15px; margin: 10px 0 6px; font-weight: 600; }
.md :deep(code) { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: 13px; font-family: "SF Mono", Consolas, monospace; }
.md :deep(pre.hljs) { margin: 8px 0; padding: 12px; border-radius: 8px; overflow-x: auto; background: var(--pre-bg); }
.md :deep(pre.hljs code) { background: none; padding: 0; font-size: 13px; }
.md :deep(blockquote) { border-left: 3px solid #d1d1d6; margin: 6px 0; padding-left: 12px; color: var(--muted); }
.md :deep(a) { color: var(--primary); }
.md :deep(table) { border-collapse: collapse; margin: 8px 0; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--border); padding: 4px 10px; font-size: 13px; }
.md :deep(strong) { font-weight: 600; }
.md { display: inline; }
/* 深色模式下代码高亮 token 适配 */
:global(:root[data-theme="dark"]) .md :deep(.hljs) { color: #c9d1d9; }
:global(:root[data-theme="dark"]) .md :deep(.hljs-keyword),
:global(:root[data-theme="dark"]) .md :deep(.hljs-built_in) { color: #ff7b72; }
:global(:root[data-theme="dark"]) .md :deep(.hljs-string) { color: #a5d6ff; }
:global(:root[data-theme="dark"]) .md :deep(.hljs-comment) { color: #8b949e; }
:global(:root[data-theme="dark"]) .md :deep(.hljs-number),
:global(:root[data-theme="dark"]) .md :deep(.hljs-literal) { color: #79c0ff; }
:global(:root[data-theme="dark"]) .md :deep(.hljs-title),
:global(:root[data-theme="dark"]) .md :deep(.hljs-function .hljs-title) { color: #d2a8ff; }
.cursor { animation: blink 1s steps(2) infinite; color: var(--primary); }
@keyframes blink { 50% { opacity: 0; } }

footer { background: var(--panel); border-top: 1px solid var(--border); padding: 14px 20px; display: flex; gap: 10px; }
footer input { flex: 1; }
footer button { padding: 0 24px; }
.mention-select { width: auto; flex-shrink: 0; max-width: 130px; }

/* 响应式 */
@media (max-width: 600px) {
  header { padding: 10px 14px; }
  header h1 { font-size: 16px; }
  main { padding: 14px; }
  .msg { max-width: 92%; }
  .user-msg { max-width: 85%; }
  footer { padding: 10px 14px; }
  footer button { padding: 0 16px; }
}
</style>
