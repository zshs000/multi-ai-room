<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { api, startDiscuss } from './api.js'
import { renderMarkdown } from './markdown.js'
import SettingsDrawer from './components/SettingsDrawer.vue'

const messages = ref([]) // {kind:'system'|'agent'|'error', name?, color?, model?, round?, text, interrupted?}
const topic = ref('')
const running = ref(false)
const showSettings = ref(false)
const config = ref({ providers: [], agents: [], rounds: 2 })
const chatEl = ref(null)
const theme = ref(localStorage.getItem('theme') || 'light')
const autoScroll = ref(true) // 用户上滚后暂停自动跟随
let controller = null
let lastTopic = ''

async function loadConfig() {
  config.value = await api.getConfig()
}
onMounted(() => {
  loadConfig()
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
  // 距底 < 60px 视为“在底部”，恢复自动跟随
  autoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60
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

function runTopic(t) {
  running.value = true
  autoScroll.value = true
  lastTopic = t
  addSystem(`话题：${t}`)

  let current = null
  controller = startDiscuss(t, (evt) => {
    if (evt.type === 'agent_start') {
      current = { kind: 'agent', name: evt.name, color: evt.color, model: evt.model, providerName: evt.providerName, round: evt.round, text: '' }
      messages.value.push(current)
      scrollToBottom()
    } else if (evt.type === 'token') {
      if (current) { current.text += evt.text; scrollToBottom() }
    } else if (evt.type === 'error') {
      messages.value.push({ kind: 'error', text: evt.message })
      scrollToBottom()
    } else if (evt.type === 'done') {
      running.value = false
      addSystem('讨论结束。')
    }
  })
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

function retry() {
  if (running.value || !lastTopic) return
  runTopic(lastTopic)
}

function stop() {
  if (controller) controller.abort()
  running.value = false
  // 给最后一个 agent 气泡标记中断
  const last = messages.value[messages.value.length - 1]
  if (last && last.kind === 'agent') last.interrupted = true
  addSystem('已停止。')
}

function clearChat() {
  if (running.value) return
  messages.value = []
}

function initial(name) {
  return (name || '?').trim().charAt(0)
}

async function onSettingsClose() {
  showSettings.value = false
  await loadConfig() // 重新拉取，反映 Provider/Agent 改动
}
</script>

<template>
  <div class="layout">
    <header>
      <h1>多 AI 讨论室</h1>
      <div class="agents-preview">
        <span v-for="a in config.agents" :key="a.id" class="chip" :style="{ borderColor: a.color }">
          {{ a.name }}
        </span>
        <button class="ghost icon" @click="toggleTheme" :title="theme === 'light' ? '切换深色' : '切换浅色'">
          {{ theme === 'light' ? '🌙' : '☀️' }}
        </button>
        <button class="ghost icon" @click="clearChat" :disabled="running || !messages.length" title="清空对话">🗑</button>
        <button class="ghost" @click="showSettings = true">⚙ 设置</button>
      </div>
    </header>

    <main ref="chatEl" @scroll="onScroll">
      <div v-if="!messages.length" class="empty">
        输入一个话题，让 {{ config.agents.length || '多个' }} 个 AI 智能体轮流讨论。
      </div>
      <template v-for="(m, i) in messages" :key="i">
        <div v-if="m.kind === 'system'" class="system-msg">{{ m.text }}</div>
        <div v-else-if="m.kind === 'error'" class="error-msg">
          <span>{{ m.text }}</span>
          <button v-if="!running && i === messages.length - 1" class="retry-btn" @click="retry">重试</button>
        </div>
        <div v-else class="msg">
          <div class="avatar" :style="{ background: m.color }">{{ initial(m.name) }}</div>
          <div class="msg-body">
            <div class="who">
              {{ m.name }}
              <span class="meta">{{ m.providerName }} · {{ m.model }} · 第{{ m.round }}轮</span>
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
      <input
        v-model="topic"
        placeholder="输入讨论话题，回车开始…"
        @keydown.enter="start"
        :disabled="running"
      />
      <button v-if="!running" class="primary" @click="start">开始讨论</button>
      <button v-else class="danger" @click="stop">停止</button>
    </footer>

    <SettingsDrawer v-if="showSettings" :config="config" @close="onSettingsClose" @changed="loadConfig" />
  </div>
</template>

<style scoped>
.layout { height: 100%; display: flex; flex-direction: column; }
header {
  background: var(--panel); padding: 12px 20px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
header h1 { font-size: 18px; font-weight: 600; }
.agents-preview { display: flex; align-items: center; gap: 8px; }
.chip { font-size: 12px; padding: 3px 10px; border: 1px solid; border-radius: 999px; color: var(--text); }
.icon { padding: 6px 9px; }

main { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.empty { color: var(--muted); text-align: center; margin-top: 40px; }
.system-msg { align-self: center; color: var(--muted); font-size: 13px; }
.error-msg { align-self: center; color: var(--danger); background: var(--danger-bg); padding: 8px 14px; border-radius: 8px; font-size: 14px; display: flex; align-items: center; gap: 10px; }
.retry-btn { padding: 3px 12px; font-size: 13px; background: var(--danger); color: #fff; }

.msg { display: flex; gap: 10px; max-width: 80%; }
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

/* 响应式 */
@media (max-width: 600px) {
  header { padding: 10px 14px; }
  header h1 { font-size: 16px; }
  .agents-preview .chip { display: none; }
  main { padding: 14px; }
  .msg { max-width: 92%; }
  footer { padding: 10px 14px; }
  footer button { padding: 0 16px; }
}
</style>
