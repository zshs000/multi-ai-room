<script setup>
import { AGENT_COLOR_PRESETS } from '../constants.js'

const props = defineProps({
  agents: { type: Array, required: true },
  providers: { type: Array, required: true },
  editingAgent: { type: Object, default: null },
  editingAgentModels: { type: Array, required: true },
  inlineProvider: { type: Object, default: null },
  provTemplates: { type: Array, required: true },
})
const emit = defineEmits([
  'show-lineups',
  'move-agent',
  'new-agent',
  'edit-agent',
  'delete-agent',
  'agent-provider-change',
  'start-inline-provider',
  'apply-inline-template',
  'save-inline-provider',
  'cancel-inline-provider',
  'save-agent',
  'cancel-agent',
])

function providerName(id) {
  return props.providers.find((provider) => provider.id === id)?.name || '（已失效）'
}
</script>

<template>
  <div>
    <div v-if="!editingAgent">
      <div class="toolbar">
        <button @click="emit('show-lineups')">⚡ 载入阵容模板</button>
      </div>
      <p class="hint hint-spaced">提示：修改角色只影响新讨论；已有会话保留创建时的角色快照。</p>
      <div v-for="(agent, index) in agents" :key="agent.id" class="card" :style="{ borderLeftColor: agent.color }">
        <div class="order-btns">
          <button class="mini" :disabled="index === 0" @click="emit('move-agent', index, -1)">▲</button>
          <button class="mini" :disabled="index === agents.length - 1" @click="emit('move-agent', index, 1)">▼</button>
        </div>
        <div class="card-main">
          <div class="card-title">
            {{ agent.name }}
            <span v-if="agent.invalid" class="badge-warn">配置失效</span>
          </div>
          <div class="card-sub">{{ providerName(agent.providerId) }} · {{ agent.model }}</div>
          <div class="card-desc">{{ agent.systemPrompt }}</div>
        </div>
        <div class="card-actions">
          <button @click="emit('edit-agent', agent)">编辑</button>
          <button class="danger" @click="emit('delete-agent', agent)">删除</button>
        </div>
      </div>
      <button class="primary block" :disabled="!providers.length" @click="emit('new-agent')">
        + 新增角色
      </button>
      <p v-if="!providers.length" class="hint">请先到「供应商」标签添加至少一个供应商。</p>
    </div>

    <div v-else class="form">
      <label>名字</label>
      <input v-model="editingAgent.name" placeholder="如：产品经理" />
      <label>颜色</label>
      <div class="colors">
        <span
          v-for="color in AGENT_COLOR_PRESETS"
          :key="color"
          class="color-dot"
          :class="{ sel: editingAgent.color === color }"
          :style="{ background: color }"
          @click="editingAgent.color = color"
        ></span>
      </div>
      <label>供应商</label>
      <div class="row">
        <select v-model="editingAgent.providerId" class="row-fill" @change="emit('agent-provider-change')">
          <option v-for="provider in providers" :key="provider.id" :value="provider.id">
            {{ provider.name }} ({{ provider.protocol }})
          </option>
        </select>
        <button title="新建供应商" @click="emit('start-inline-provider')">+</button>
      </div>

      <div v-if="inlineProvider" class="inline-box">
        <div class="inline-title">新建供应商</div>
        <div class="templates">
          <button
            v-for="template in provTemplates"
            :key="template.name"
            class="tpl"
            @click="emit('apply-inline-template', template)"
          >
            {{ template.name }}
          </button>
        </div>
        <input v-model="inlineProvider.name" placeholder="名称" class="stack-input" />
        <select v-model="inlineProvider.protocol" class="stack-input">
          <option value="openai">OpenAI 兼容</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </select>
        <input v-model="inlineProvider.baseUrl" placeholder="https://api.deepseek.com" class="stack-input" />
        <input v-model="inlineProvider.apiKey" type="password" placeholder="API Key" class="stack-input" />
        <input v-model="inlineProvider.modelsText" placeholder="模型，逗号分隔" class="stack-input" />
        <div class="form-actions">
          <button @click="emit('cancel-inline-provider')">取消</button>
          <button class="primary" :disabled="!inlineProvider.name" @click="emit('save-inline-provider')">
            创建并选用
          </button>
        </div>
      </div>

      <label>模型</label>
      <select v-model="editingAgent.model">
        <option v-for="model in editingAgentModels" :key="model" :value="model">{{ model }}</option>
      </select>
      <label>人设 (System Prompt)</label>
      <textarea v-model="editingAgent.systemPrompt" placeholder="描述这个角色的身份、视角、说话风格…"></textarea>
      <div class="form-actions">
        <button @click="emit('cancel-agent')">取消</button>
        <button class="primary" :disabled="!editingAgent.name" @click="emit('save-agent')">保存</button>
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
.card-desc {
  font-size: 13px; color: var(--muted); margin-top: 6px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card-actions { display: flex; flex-direction: column; gap: 6px; }
.card-actions button { padding: 5px 12px; font-size: 13px; white-space: nowrap; }
.badge-warn { font-size: 11px; background: var(--danger-bg); color: var(--danger); padding: 2px 8px; border-radius: 999px; }
.block { width: 100%; padding: 12px; margin-top: 6px; }
.form-actions { display: flex; gap: 10px; justify-content: flex-end; align-items: center; margin-top: 20px; }
.hint-spaced { margin-bottom: 10px; }
.row-fill { flex: 1; }
.stack-input { margin-top: 8px; }
.colors { display: flex; gap: 10px; }
.color-dot { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 3px solid transparent; }
.color-dot.sel { border-color: #00000030; transform: scale(1.1); }
.templates { display: flex; flex-wrap: wrap; gap: 8px; }
.tpl { font-size: 13px; }
.toolbar { margin-bottom: 12px; }
.order-btns { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.mini { padding: 2px 7px; font-size: 11px; line-height: 1; }
.inline-box { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 8px 0; }
.inline-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--primary); }
</style>
