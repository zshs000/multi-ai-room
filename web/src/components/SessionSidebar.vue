<script setup>
defineProps({
  sessions: { type: Array, required: true },
  currentSessionId: { type: String, default: null },
  running: { type: Boolean, default: false },
})
const emit = defineEmits(['new-chat', 'load-session', 'rename-session', 'delete-session'])
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <button class="primary block" :disabled="running" @click="emit('new-chat')">＋ 新讨论</button>
    </div>
    <div class="session-list">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: session.id === currentSessionId }"
        @click="emit('load-session', session.id)"
      >
        <div class="session-title">{{ session.title }}</div>
        <div class="session-meta">{{ session.messageCount }} 条 · {{ session.agentNames.join('/') }}</div>
        <div class="session-btns">
          <button class="session-btn" title="重命名" @click.stop="emit('rename-session', session)">✎</button>
          <button class="session-btn" title="删除" @click.stop="emit('delete-session', session.id)">✕</button>
        </div>
      </div>
      <div v-if="!sessions.length" class="session-empty">还没有历史会话</div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px; flex-shrink: 0; background: var(--panel); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; transition: margin-left 0.2s;
}
:global(.sidebar-hidden) .sidebar { margin-left: -240px; }
.sidebar-head { padding: 12px; border-bottom: 1px solid var(--border); }
.session-list { flex: 1; overflow-y: auto; padding: 8px; }
.session-item { position: relative; padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; }
.session-item:hover { background: var(--btn-bg); }
.session-item.active { background: var(--code-bg); }
.session-title {
  font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 40px;
}
.session-meta {
  font-size: 11px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.session-btns { position: absolute; top: 8px; right: 6px; display: flex; gap: 2px; opacity: 0; }
.session-btn { padding: 2px 6px; font-size: 11px; background: transparent; }
.session-item:hover .session-btns { opacity: 0.7; }
.session-btn:hover { opacity: 1; background: var(--btn-hover); }
.session-empty { color: var(--muted); font-size: 13px; text-align: center; padding: 20px; }

@media (max-width: 600px) {
  .sidebar { position: absolute; z-index: 50; height: 100%; box-shadow: 2px 0 12px rgba(0,0,0,0.15); }
}
</style>
