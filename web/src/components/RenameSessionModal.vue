<script setup>
import { nextTick, ref, watch } from 'vue'
import { SESSION_TITLE_MAX_LENGTH } from '../constants.js'

const props = defineProps({
  session: { type: Object, required: true },
})
const emit = defineEmits(['close', 'submit'])

const title = ref('')
const inputEl = ref(null)

function focusInput() {
  nextTick(() => inputEl.value?.focus())
}

watch(
  () => props.session,
  (session) => {
    title.value = session?.title || ''
    focusInput()
  },
  { immediate: true },
)

function close() {
  emit('close')
}

function submit() {
  const nextTitle = title.value.trim()
  if (!nextTitle) {
    inputEl.value?.focus()
    return
  }
  emit('submit', nextTitle)
}
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="rename-modal">
      <h3>重命名会话</h3>
      <input
        ref="inputEl"
        v-model="title"
        class="rename-input"
        :maxlength="SESSION_TITLE_MAX_LENGTH"
        placeholder="输入新的会话名称"
        @keydown.enter="submit"
        @keydown.esc="close"
      />
      <div class="rename-actions">
        <button class="ghost" @click="close">取消</button>
        <button class="primary" @click="submit">确定</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 300;
}
.rename-modal {
  background: var(--panel); border-radius: 14px; padding: 22px 24px;
  width: 360px; max-width: 90vw; box-shadow: 0 16px 48px rgba(0,0,0,0.25);
}
.rename-modal h3 { font-size: 16px; font-weight: 600; margin-bottom: 14px; }
.rename-input {
  width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text);
}
.rename-input:focus { border-color: var(--primary); outline: none; }
.rename-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.rename-actions button { padding: 8px 20px; }
</style>
