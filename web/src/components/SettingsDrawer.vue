<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../api.js'

const props = defineProps({ config: Object })
const emit = defineEmits(['close', 'changed'])

const tab = ref('agents') // 'agents' | 'providers' | 'settings'
const providers = ref([])
const agents = ref([])
const rounds = ref(2)
const provTemplates = ref([])

async function reload() {
  const cfg = await api.getConfig()
  providers.value = cfg.providers
  agents.value = cfg.agents
  rounds.value = cfg.rounds
  emit('changed')
}
onMounted(async () => {
  await reload()
  provTemplates.value = await api.providerTemplates()
})

// ---------- Provider 编辑 ----------
const editingProvider = ref(null) // null=不在编辑；对象=正在编辑
function newProvider() {
  editingProvider.value = { name: '', protocol: 'openai', baseUrl: '', apiKey: '', modelsText: '' }
}
function editProvider(p) {
  editingProvider.value = { ...p, apiKey: '', modelsText: (p.models || []).join(', ') }
}
function applyTemplate(t) {
  editingProvider.value = { name: t.name, protocol: t.protocol, baseUrl: t.baseUrl, apiKey: '', modelsText: (t.models || []).join(', ') }
}
async function saveProvider() {
  const e = editingProvider.value
  const data = {
    name: e.name, protocol: e.protocol, baseUrl: e.baseUrl,
    models: e.modelsText.split(',').map((s) => s.trim()).filter(Boolean),
  }
  if (e.apiKey) data.apiKey = e.apiKey // 空则不覆盖
  if (e.id) await api.updateProvider(e.id, data)
  else await api.createProvider(data)
  editingProvider.value = null
  await reload()
}
async function delProvider(p) {
  const r = await api.deleteProvider(p.id)
  if (r.ok === false && r.referencedBy) {
    if (confirm(`有 ${r.referencedBy.length} 个 Agent 引用「${p.name}」。强制删除？这些 Agent 将失效。`)) {
      await api.deleteProvider(p.id, true)
      await reload()
    }
  } else {
    await reload()
  }
}

// ---------- 连通性测试 ----------
const testResult = ref({}) // { [providerId]: {ok,message,latencyMs,loading} }
async function testProvider(p) {
  testResult.value[p.id] = { loading: true }
  const r = await api.testProvider(p.id)
  testResult.value[p.id] = r
}

// ---------- Agent 编辑 ----------
const editingAgent = ref(null)
const colorPresets = ['#4f8cff', '#34c759', '#ff9f0a', '#ff3b30', '#5856d6', '#af52de', '#00c7be']
function newAgent() {
  const firstProv = providers.value[0]
  editingAgent.value = {
    name: '', color: colorPresets[agents.value.length % colorPresets.length],
    systemPrompt: '', providerId: firstProv?.id || '', model: firstProv?.models?.[0] || '',
  }
}
function editAgent(a) {
  editingAgent.value = { ...a }
}
const editingAgentModels = computed(() => {
  const p = providers.value.find((x) => x.id === editingAgent.value?.providerId)
  return p?.models || []
})
function onAgentProviderChange() {
  // 切换 provider 后，model 自动选首个
  editingAgent.value.model = editingAgentModels.value[0] || ''
}
async function saveAgent() {
  const e = editingAgent.value
  const data = { name: e.name, color: e.color, systemPrompt: e.systemPrompt, providerId: e.providerId, model: e.model }
  if (e.id) await api.updateAgent(e.id, data)
  else await api.createAgent(data)
  editingAgent.value = null
  await reload()
}
async function delAgent(a) {
  if (confirm(`删除 Agent「${a.name}」？`)) {
    await api.deleteAgent(a.id)
    await reload()
  }
}

async function saveRounds() {
  await api.updateSettings({ rounds: Number(rounds.value) || 1 })
  await reload()
}

function providerName(id) {
  return providers.value.find((p) => p.id === id)?.name || '（已失效）'
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="drawer">
      <div class="drawer-head">
        <div class="tabs">
          <button :class="{ active: tab === 'agents' }" @click="tab = 'agents'">角色 Agent</button>
          <button :class="{ active: tab === 'providers' }" @click="tab = 'providers'">供应商</button>
          <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">通用</button>
        </div>
        <button class="ghost" @click="emit('close')">✕</button>
      </div>

      <div class="drawer-body">
        <!-- ===== Agent 管理 ===== -->
        <div v-if="tab === 'agents'">
          <div v-if="!editingAgent">
            <div v-for="a in agents" :key="a.id" class="card" :style="{ borderLeftColor: a.color }">
              <div class="card-main">
                <div class="card-title">
                  {{ a.name }}
                  <span v-if="a.invalid" class="badge-warn">配置失效</span>
                </div>
                <div class="card-sub">{{ providerName(a.providerId) }} · {{ a.model }}</div>
                <div class="card-desc">{{ a.systemPrompt }}</div>
              </div>
              <div class="card-actions">
                <button @click="editAgent(a)">编辑</button>
                <button class="danger" @click="delAgent(a)">删除</button>
              </div>
            </div>
            <button class="primary block" @click="newAgent" :disabled="!providers.length">
              + 新增角色
            </button>
            <p v-if="!providers.length" class="hint">请先到「供应商」标签添加至少一个供应商。</p>
          </div>

          <!-- Agent 编辑表单 -->
          <div v-else class="form">
            <label>名字</label>
            <input v-model="editingAgent.name" placeholder="如：产品经理" />
            <label>颜色</label>
            <div class="colors">
              <span v-for="c in colorPresets" :key="c" class="color-dot" :class="{ sel: editingAgent.color === c }" :style="{ background: c }" @click="editingAgent.color = c"></span>
            </div>
            <label>供应商</label>
            <select v-model="editingAgent.providerId" @change="onAgentProviderChange">
              <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }} ({{ p.protocol }})</option>
            </select>
            <label>模型</label>
            <select v-model="editingAgent.model">
              <option v-for="m in editingAgentModels" :key="m" :value="m">{{ m }}</option>
            </select>
            <label>人设 (System Prompt)</label>
            <textarea v-model="editingAgent.systemPrompt" placeholder="描述这个角色的身份、视角、说话风格…"></textarea>
            <div class="form-actions">
              <button @click="editingAgent = null">取消</button>
              <button class="primary" @click="saveAgent" :disabled="!editingAgent.name">保存</button>
            </div>
          </div>
        </div>

        <!-- ===== Provider 管理 ===== -->
        <div v-if="tab === 'providers'">
          <div v-if="!editingProvider">
            <div v-for="p in providers" :key="p.id" class="card">
              <div class="card-main">
                <div class="card-title">{{ p.name }} <span class="badge">{{ p.protocol }}</span></div>
                <div class="card-sub">{{ p.baseUrl }}</div>
                <div class="card-sub">密钥：{{ p.hasApiKey ? p.apiKeyMask : '未设置' }} · 模型：{{ (p.models || []).join(', ') || '无' }}</div>
                <div v-if="testResult[p.id]" class="test-result" :class="{ ok: testResult[p.id].ok, bad: testResult[p.id].ok === false }">
                  <span v-if="testResult[p.id].loading">测试中…</span>
                  <span v-else>{{ testResult[p.id].ok ? '✓' : '✗' }} {{ testResult[p.id].message }} <span v-if="testResult[p.id].latencyMs">({{ testResult[p.id].latencyMs }}ms)</span></span>
                </div>
              </div>
              <div class="card-actions">
                <button @click="testProvider(p)">测试</button>
                <button @click="editProvider(p)">编辑</button>
                <button class="danger" @click="delProvider(p)">删除</button>
              </div>
            </div>
            <button class="primary block" @click="newProvider">+ 新增供应商</button>
          </div>

          <!-- Provider 编辑表单 -->
          <div v-else class="form">
            <label>从模板快速填充</label>
            <div class="templates">
              <button v-for="t in provTemplates" :key="t.name" class="tpl" @click="applyTemplate(t)">{{ t.name }}</button>
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
            <input v-model="editingProvider.apiKey" type="password" :placeholder="editingProvider.id ? '留空则不修改原密钥' : 'sk-...'" />
            <label>可用模型（逗号分隔）</label>
            <input v-model="editingProvider.modelsText" placeholder="deepseek-chat, deepseek-reasoner" />
            <div class="form-actions">
              <button @click="editingProvider = null">取消</button>
              <button class="primary" @click="saveProvider" :disabled="!editingProvider.name">保存</button>
            </div>
          </div>
        </div>

        <!-- ===== 通用设置 ===== -->
        <div v-if="tab === 'settings'" class="form">
          <label>讨论轮数（每个 Agent 各发言几轮）</label>
          <div class="row">
            <input type="number" v-model="rounds" min="1" max="10" style="width: 100px" />
            <button class="primary" @click="saveRounds">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; justify-content: flex-end; z-index: 100; }
.drawer { width: 520px; max-width: 92vw; height: 100%; background: var(--bg); display: flex; flex-direction: column; box-shadow: -4px 0 20px rgba(0,0,0,0.1); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--border); }
.tabs { display: flex; gap: 6px; }
.tabs button { background: transparent; }
.tabs button.active { background: var(--primary); color: #fff; }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px; }

.card { background: var(--panel); border-radius: var(--radius); padding: 14px; margin-bottom: 10px; display: flex; gap: 12px; border-left: 4px solid transparent; }
.card-main { flex: 1; min-width: 0; }
.card-title { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.card-sub { font-size: 12px; color: var(--muted); margin-top: 3px; word-break: break-all; }
.card-desc { font-size: 13px; color: #555; margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-actions { display: flex; flex-direction: column; gap: 6px; }
.card-actions button { padding: 5px 12px; font-size: 13px; white-space: nowrap; }
.badge { font-size: 11px; background: #eef; color: #55a; padding: 2px 8px; border-radius: 999px; }
.badge-warn { font-size: 11px; background: #fff0f0; color: var(--danger); padding: 2px 8px; border-radius: 999px; }

.block { width: 100%; padding: 12px; margin-top: 6px; }
.form-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
.colors { display: flex; gap: 10px; }
.color-dot { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 3px solid transparent; }
.color-dot.sel { border-color: #00000030; transform: scale(1.1); }
.templates { display: flex; flex-wrap: wrap; gap: 8px; }
.tpl { font-size: 13px; }
.test-result { font-size: 12px; margin-top: 8px; padding: 6px 10px; border-radius: 6px; background: #f0f0f3; }
.test-result.ok { background: #e8f9ee; color: #1a8c3a; }
.test-result.bad { background: #fff0f0; color: var(--danger); }
</style>
