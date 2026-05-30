<script setup>
import { renderMarkdown } from '../markdown.js'

defineProps({
  messages: { type: Array, required: true },
  running: { type: Boolean, default: false },
  agentCount: { type: Number, default: 0 },
})
const emit = defineEmits(['retry'])

function initial(name) {
  return (name || '?').trim().charAt(0)
}
</script>

<template>
  <div v-if="!messages.length" class="empty">
    输入一个话题，让 {{ agentCount || '多个' }} 个 AI 智能体讨论。
  </div>
  <template v-for="(message, index) in messages" :key="index">
    <div v-if="message.kind === 'system'" class="system-msg">{{ message.text }}</div>
    <div v-else-if="message.kind === 'user'" class="user-msg">
      <div class="user-bubble">{{ message.text }}</div>
    </div>
    <div v-else-if="message.kind === 'error'" class="error-msg">
      <span>{{ message.text }}</span>
      <button v-if="!running && index === messages.length - 1" class="retry-btn" @click="emit('retry')">重试</button>
    </div>
    <div v-else class="msg" :class="{ 'msg-summary': message.isSummary }">
      <div class="avatar" :style="{ background: message.color }">
        {{ message.isSummary ? '∑' : initial(message.name) }}
      </div>
      <div class="msg-body">
        <div class="who">
          {{ message.name }}
          <span v-if="!message.isSummary" class="meta">
            {{ message.providerName }} · {{ message.model }} · 第{{ message.round }}轮
          </span>
          <span v-if="message.interrupted" class="interrupted">已中断</span>
        </div>
        <div class="bubble" :style="{ borderLeftColor: message.color }">
          <div class="md" v-html="renderMarkdown(message.text)"></div>
          <span v-if="running && index === messages.length - 1" class="cursor">▋</span>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.empty { color: var(--muted); text-align: center; margin-top: 40px; }
.system-msg { align-self: center; color: var(--muted); font-size: 13px; }

.user-msg { align-self: flex-end; max-width: 70%; }
.user-bubble {
  background: var(--primary); color: #fff; padding: 10px 14px;
  border-radius: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
}

.error-msg {
  align-self: center; color: var(--danger); background: var(--danger-bg);
  padding: 8px 14px; border-radius: 8px; font-size: 14px;
  display: flex; align-items: center; gap: 10px;
}
.retry-btn { padding: 3px 12px; font-size: 13px; background: var(--danger); color: #fff; }

.msg { display: flex; gap: 10px; max-width: 80%; }
.msg-summary { max-width: 90%; align-self: center; width: 90%; }
.msg-summary .bubble { background: var(--code-bg); border-left-width: 4px; }
.avatar {
  flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600;
}
.msg-body { min-width: 0; }
.who {
  font-size: 13px; color: var(--muted); margin-bottom: 4px; padding: 0 2px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.meta { font-size: 11px; color: var(--meta); }
.interrupted {
  font-size: 11px; color: var(--danger); background: var(--danger-bg);
  padding: 1px 7px; border-radius: 999px;
}
.bubble {
  background: var(--panel); border-radius: 14px; padding: 12px 16px; line-height: 1.6;
  word-break: break-word; border-left: 4px solid #ccc;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.md :deep(p) { margin: 0 0 8px; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(ul), .md :deep(ol) { margin: 6px 0; padding-left: 22px; }
.md :deep(li) { margin: 3px 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3) { font-size: 15px; margin: 10px 0 6px; font-weight: 600; }
.md :deep(code) {
  background: var(--code-bg); padding: 1px 5px; border-radius: 4px;
  font-size: 13px; font-family: "SF Mono", Consolas, monospace;
}
.md :deep(pre.hljs) { margin: 8px 0; padding: 12px; border-radius: 8px; overflow-x: auto; background: var(--pre-bg); }
.md :deep(pre.hljs code) { background: none; padding: 0; font-size: 13px; }
.md :deep(blockquote) { border-left: 3px solid #d1d1d6; margin: 6px 0; padding-left: 12px; color: var(--muted); }
.md :deep(a) { color: var(--primary); }
.md :deep(table) { border-collapse: collapse; margin: 8px 0; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--border); padding: 4px 10px; font-size: 13px; }
.md :deep(strong) { font-weight: 600; }
.md { display: inline; }

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

@media (max-width: 600px) {
  .msg { max-width: 92%; }
  .user-msg { max-width: 85%; }
}
</style>
