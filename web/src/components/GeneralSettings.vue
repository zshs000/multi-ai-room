<script setup>
import {
  DEFAULT_ORCHESTRATION,
  MODERATOR_ORCHESTRATION,
} from '../constants.js'

defineProps({
  providers: { type: Array, required: true },
  moderatorModels: { type: Array, required: true },
  savedTip: { type: String, default: '' },
  rounds: { type: [Number, String], required: true },
  orchestration: { type: String, required: true },
  moderatorProviderId: { type: String, default: '' },
  moderatorModel: { type: String, default: '' },
  maxTurns: { type: [Number, String], required: true },
  summarize: { type: Boolean, default: false },
})
const emit = defineEmits([
  'update:rounds',
  'update:orchestration',
  'update:moderatorProviderId',
  'update:moderatorModel',
  'update:maxTurns',
  'update:summarize',
  'save',
])
</script>

<template>
  <div class="form">
    <label>编排模式</label>
    <select :value="orchestration" @change="emit('update:orchestration', $event.target.value)">
      <option :value="DEFAULT_ORCHESTRATION">🔄 固定轮流（每个 Agent 按顺序各发言 N 轮）</option>
      <option :value="MODERATOR_ORCHESTRATION">🎤 主持人调度（由 AI 主持人决定谁发言、何时收尾）</option>
    </select>

    <template v-if="orchestration === DEFAULT_ORCHESTRATION">
      <label>讨论轮数（每个 Agent 各发言几轮）</label>
      <input
        type="number"
        :value="rounds"
        min="1"
        max="10"
        class="number-short"
        @input="emit('update:rounds', $event.target.value)"
      />
    </template>

    <template v-else>
      <label>主持人使用的供应商</label>
      <select :value="moderatorProviderId" @change="emit('update:moderatorProviderId', $event.target.value)">
        <option v-for="provider in providers" :key="provider.id" :value="provider.id">
          {{ provider.name }} ({{ provider.protocol }})
        </option>
      </select>
      <label>主持人模型（建议用便宜快速的）</label>
      <select :value="moderatorModel" @change="emit('update:moderatorModel', $event.target.value)">
        <option value="">（用该供应商首个模型）</option>
        <option v-for="model in moderatorModels" :key="model" :value="model">{{ model }}</option>
      </select>
      <label>最大发言轮次（防止无限讨论）</label>
      <input
        type="number"
        :value="maxTurns"
        min="2"
        max="30"
        class="number-short"
        @input="emit('update:maxTurns', $event.target.value)"
      />
    </template>

    <label>讨论结束后自动总结</label>
    <div class="row">
      <label class="switch">
        <input
          type="checkbox"
          :checked="summarize"
          @change="emit('update:summarize', $event.target.checked)"
        />
        <span>开启总结（额外一次 LLM 调用，输出共识与结论）</span>
      </label>
    </div>

    <div class="form-actions">
      <button class="primary" :disabled="savedTip === 'saving'" @click="emit('save')">
        {{ savedTip === 'saving' ? '保存中…' : '保存设置' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.form-actions { display: flex; gap: 10px; justify-content: flex-end; align-items: center; margin-top: 20px; }
.number-short { width: 120px; }
.switch { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }
.switch input { width: auto; }
.switch span { font-size: 13px; color: var(--text); }
</style>
