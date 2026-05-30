<script setup>
defineProps({
  dialog: { type: Object, default: null },
})
const emit = defineEmits(['resolve'])

function resolve(value) {
  emit('resolve', value)
}
</script>

<template>
  <div v-if="dialog" class="dialog-overlay" @click.self="resolve(false)">
    <div class="dialog-box" role="dialog" aria-modal="true">
      <h3>{{ dialog.title }}</h3>
      <p>{{ dialog.message }}</p>
      <div class="dialog-actions">
        <button v-if="dialog.kind === 'confirm'" class="ghost" @click="resolve(false)">
          {{ dialog.cancelText || '取消' }}
        </button>
        <button :class="dialog.danger ? 'danger' : 'primary'" @click="resolve(true)">
          {{ dialog.confirmText || '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed; inset: 0; z-index: 400; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
}
.dialog-box {
  width: 360px; max-width: 90vw; background: var(--panel); color: var(--text);
  border-radius: 8px; padding: 20px; box-shadow: 0 16px 48px rgba(0,0,0,0.25);
}
.dialog-box h3 { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
.dialog-box p { font-size: 14px; color: var(--muted); line-height: 1.6; white-space: pre-wrap; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.dialog-actions button { padding: 8px 20px; }
</style>
