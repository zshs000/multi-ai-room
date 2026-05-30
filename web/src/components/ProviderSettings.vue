<script setup>
defineProps({
  providers: { type: Array, required: true },
  editingProvider: { type: Object, default: null },
  provTemplates: { type: Array, required: true },
  testResult: { type: Object, required: true },
})
const emit = defineEmits([
  'new-provider',
  'edit-provider',
  'delete-provider',
  'test-provider',
  'apply-template',
  'save-provider',
  'cancel-edit',
])
</script>

<template>
  <div>
    <div v-if="!editingProvider">
      <div v-for="provider in providers" :key="provider.id" class="card">
        <div class="card-main">
          <div class="card-title">
            {{ provider.name }} <span class="badge">{{ provider.protocol }}</span>
          </div>
          <div class="card-sub">{{ provider.baseUrl }}</div>
          <div class="card-sub">
            密钥：{{ provider.hasApiKey ? provider.apiKeyMask : '未设置' }} ·
            模型：{{ (provider.models || []).join(', ') || '无' }}
          </div>
          <div
            v-if="testResult[provider.id]"
            class="test-result"
            :class="{ ok: testResult[provider.id].ok, bad: testResult[provider.id].ok === false }"
          >
            <span v-if="testResult[provider.id].loading">测试中…</span>
            <span v-else>
              {{ testResult[provider.id].ok ? '✓' : '✗' }} {{ testResult[provider.id].message }}
              <span v-if="testResult[provider.id].latencyMs">({{ testResult[provider.id].latencyMs }}ms)</span>
            </span>
          </div>
        </div>
        <div class="card-actions">
          <button @click="emit('test-provider', provider)">测试</button>
          <button @click="emit('edit-provider', provider)">编辑</button>
          <button class="danger" @click="emit('delete-provider', provider)">删除</button>
        </div>
      </div>
      <button class="primary block" @click="emit('new-provider')">+ 新增供应商</button>
    </div>

    <div v-else class="form">
      <label>从模板快速填充</label>
      <div class="templates">
        <button
          v-for="template in provTemplates"
          :key="template.name"
          class="tpl"
          @click="emit('apply-template', template)"
        >
          {{ template.name }}
        </button>
      </div>
      <label>名称</label>
      <input v-model="editingProvider.name" placeholder="如：DeepSeek" />
      <label>协议</label>
      <select v-model="editingProvider.protocol">
        <option value="openai">OpenAI 兼容</option>
        <option value="anthropic">Anthropic (Claude)</option>
      </select>
      <label>API 地址 (Base URL)</label>
      <input v-model="editingProvider.baseUrl" placeholder="https://api.deepseek.com" />
      <div class="hint">填到域名根即可，无需加 /v1 或 /chat/completions</div>
      <label>API Key</label>
      <input
        v-model="editingProvider.apiKey"
        type="password"
        :placeholder="editingProvider.id ? '留空则不修改原密钥' : 'sk-...'"
      />
      <label>可用模型（逗号分隔）</label>
      <input v-model="editingProvider.modelsText" placeholder="deepseek-chat, deepseek-reasoner" />
      <div class="form-actions">
        <button @click="emit('cancel-edit')">取消</button>
        <button class="primary" :disabled="!editingProvider.name" @click="emit('save-provider')">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--panel); border-radius: var(--radius); padding: 14px; margin-bottom: 10px;
  display: flex; gap: 12px; border-left: 4px solid transparent;
}
.card-main { flex: 1; min-width: 0; }
.card-title { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.card-sub { font-size: 12px; color: var(--muted); margin-top: 3px; word-break: break-all; }
.card-actions { display: flex; flex-direction: column; gap: 6px; }
.card-actions button { padding: 5px 12px; font-size: 13px; white-space: nowrap; }
.badge { font-size: 11px; background: var(--code-bg); color: var(--primary); padding: 2px 8px; border-radius: 999px; }
.block { width: 100%; padding: 12px; margin-top: 6px; }
.form-actions { display: flex; gap: 10px; justify-content: flex-end; align-items: center; margin-top: 20px; }
.templates { display: flex; flex-wrap: wrap; gap: 8px; }
.tpl { font-size: 13px; }
.test-result { font-size: 12px; margin-top: 8px; padding: 6px 10px; border-radius: 6px; background: var(--code-bg); }
.test-result.ok { background: #e8f9ee; color: #1a8c3a; }
.test-result.bad { background: var(--danger-bg); color: var(--danger); }
</style>
