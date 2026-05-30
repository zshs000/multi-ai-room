<script setup>
defineProps({
  modelValue: { type: String, default: '' },
  mentionTarget: { type: String, default: '' },
  agents: { type: Array, required: true },
  running: { type: Boolean, default: false },
  canInterject: { type: Boolean, default: false },
})
const emit = defineEmits([
  'update:modelValue',
  'update:mentionTarget',
  'start',
  'interject',
  'stop',
])

function submit() {
  emit(canInterject ? 'interject' : 'start')
}
</script>

<template>
  <footer>
    <select
      v-if="canInterject"
      :value="mentionTarget"
      class="mention-select"
      title="指定回应者"
      @change="emit('update:mentionTarget', $event.target.value)"
    >
      <option value="">全体</option>
      <option v-for="agent in agents" :key="agent.id" :value="agent.id">@{{ agent.name }}</option>
    </select>
    <input
      :value="modelValue"
      :placeholder="canInterject ? '追问或补充，按回车继续讨论…' : '输入讨论话题，回车开始…'"
      :disabled="running"
      @input="emit('update:modelValue', $event.target.value)"
      @keydown.enter="submit"
    />
    <button v-if="running" class="danger" @click="emit('stop')">停止</button>
    <button v-else-if="canInterject" class="primary" @click="emit('interject')">追问</button>
    <button v-else class="primary" @click="emit('start')">开始讨论</button>
  </footer>
</template>

<style scoped>
footer { background: var(--panel); border-top: 1px solid var(--border); padding: 14px 20px; display: flex; gap: 10px; }
footer input { flex: 1; }
footer button { padding: 0 24px; }
.mention-select { width: auto; flex-shrink: 0; max-width: 130px; }

@media (max-width: 600px) {
  footer { padding: 10px 14px; }
  footer button { padding: 0 16px; }
}
</style>
