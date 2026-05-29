<script setup>
import { ref, onMounted } from 'vue'
import { api, startDiscuss } from './api.js'
import SettingsDrawer from './components/SettingsDrawer.vue'

const messages = ref([]) // {kind:'system'|'agent'|'error', name?, color?, model?, round?, text}
const topic = ref('')
const running = ref(false)
const showSettings = ref(false)
const config = ref({ providers: [], agents: [], rounds: 2 })
const chatEl = ref(null)
let controller = null

async function loadConfig() {
  config.value = await api.getConfig()
}
onMounted(loadConfig)

function scrollToBottom() {
  requestAnimationFrame(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
  })
}

function addSystem(text) {
  messages.value.push({ kind: 'system', text })
  scrollToBottom()
}

function start() {
  const t = topic.value.trim()
  if (!t || running.value) return
  if (!config.value.agents.length) {
    addSystem('还没有 Agent，请先点右上角「设置」添加。')
    return
  }
  running.value = true
  addSystem(`话题：${t}`)
  topic.value = ''

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

function stop() {
  if (controller) controller.abort()
  running.value = false
  addSystem('已停止。')
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
        <button class="ghost" @click="showSettings = true">⚙ 设置</button>
      </div>
    </header>

    <main ref="chatEl">
      <div v-if="!messages.length" class="empty">
        输入一个话题，让 {{ config.agents.length || '多个' }} 个 AI 智能体轮流讨论。
      </div>
      <template v-for="(m, i) in messages" :key="i">
        <div v-if="m.kind === 'system'" class="system-msg">{{ m.text }}</div>
        <div v-else-if="m.kind === 'error'" class="error-msg">{{ m.text }}</div>
        <div v-else class="msg">
          <div class="who">
            <span class="dot" :style="{ background: m.color }"></span>
            {{ m.name }}
            <span class="meta">{{ m.providerName }} · {{ m.model }} · 第{{ m.round }}轮</span>
          </div>
          <div class="bubble" :style="{ borderLeftColor: m.color }">{{ m.text }}<span v-if="running && i === messages.length - 1" class="cursor">▋</span></div>
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

main { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.empty { color: var(--muted); text-align: center; margin-top: 40px; }
.system-msg { align-self: center; color: var(--muted); font-size: 13px; }
.error-msg { align-self: center; color: var(--danger); background: #fff0f0; padding: 8px 14px; border-radius: 8px; font-size: 14px; }

.msg { max-width: 76%; }
.who { font-size: 13px; color: var(--muted); margin-bottom: 4px; padding: 0 4px; display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.meta { font-size: 11px; color: #c7c7cc; }
.bubble {
  background: var(--panel); border-radius: 14px; padding: 12px 16px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; border-left: 4px solid #ccc;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.cursor { animation: blink 1s steps(2) infinite; color: var(--primary); }
@keyframes blink { 50% { opacity: 0; } }

footer { background: var(--panel); border-top: 1px solid var(--border); padding: 14px 20px; display: flex; gap: 10px; }
footer input { flex: 1; }
footer button { padding: 0 24px; }
</style>
