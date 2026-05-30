<script setup>
defineProps({
  lineups: { type: Array, required: true },
})
const emit = defineEmits(['close', 'load'])

function close() {
  emit('close')
}
</script>

<template>
  <div class="lineup-modal" @click.self="close">
    <div class="lineup-box">
      <div class="lineup-head">
        <h3>选择阵容模板</h3>
        <button class="ghost" @click="close">✕</button>
      </div>
      <div v-for="lineup in lineups" :key="lineup.name" class="lineup-card" @click="emit('load', lineup)">
        <div class="lineup-name">{{ lineup.name }}</div>
        <div class="lineup-desc">{{ lineup.description }}</div>
        <div class="lineup-agents">
          <span
            v-for="agent in lineup.agents"
            :key="agent.name"
            class="chip-sm"
            :style="{ borderColor: agent.color }"
          >
            {{ agent.name }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lineup-modal {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.lineup-box {
  background: var(--panel); border-radius: var(--radius); padding: 20px;
  width: 440px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
}
.lineup-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.lineup-head h3 { font-size: 16px; }
.lineup-card {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px;
  margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.lineup-card:hover { border-color: var(--primary); background: var(--code-bg); }
.lineup-name { font-weight: 600; font-size: 15px; }
.lineup-desc { font-size: 12px; color: var(--muted); margin: 4px 0 8px; }
.lineup-agents { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-sm { font-size: 11px; padding: 2px 8px; border: 1px solid; border-radius: 999px; }
</style>
