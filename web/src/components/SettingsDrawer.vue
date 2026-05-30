<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../api.js'
import DialogModal from './DialogModal.vue'
import GeneralSettings from './GeneralSettings.vue'
import LineupModal from './LineupModal.vue'
import { useDialog } from '../composables/useDialog.js'
import {
  AGENT_COLOR_PRESETS,
  DEFAULT_MAX_TURNS,
  DEFAULT_ORCHESTRATION,
  MODERATOR_ORCHESTRATION,
  TOAST_DURATION_MS,
} from '../constants.js'

const props = defineProps({ config: Object })
const emit = defineEmits(['close', 'changed'])

const tab = ref('agents') // 'agents' | 'providers' | 'settings'
const providers = ref([])
const agents = ref([])
const rounds = ref(2)
const orchestration = ref(DEFAULT_ORCHESTRATION)
const moderatorProviderId = ref('')
const moderatorModel = ref('')
const maxTurns = ref(DEFAULT_MAX_TURNS)
const summarize = ref(false)
const savedTip = ref('') // '' | 'saving' | 'saved' | 'error'
const { dialog, confirmDialog, alertDialog, resolveDialog } = useDialog()
let savedTimer = null
const provTemplates = ref([])
const lineups = ref([])

async function reload() {
  const cfg = await api.getConfig()
  providers.value = cfg.providers
  agents.value = cfg.agents
  rounds.value = cfg.rounds
  orchestration.value = cfg.orchestration || DEFAULT_ORCHESTRATION
  moderatorProviderId.value = cfg.moderatorProviderId || (cfg.providers[0]?.id || '')
  moderatorModel.value = cfg.moderatorModel || ''
  maxTurns.value = cfg.maxTurns || DEFAULT_MAX_TURNS
  summarize.value = !!cfg.summarize
  emit('changed')
}
onMounted(async () => {
  await reload()
  provTemplates.value = await api.providerTemplates()
  lineups.value = await api.lineupTemplates()
})

const moderatorModels = computed(() => {
  const p = providers.value.find((x) => x.id === moderatorProviderId.value)
  return p?.models || []
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
  editingProvider.value = { ...editingProvider.value, name: t.name, protocol: t.protocol, baseUrl: t.baseUrl, modelsText: (t.models || []).join(', ') }
}
async function saveProvider() {
  const e = editingProvider.value
  const data = {
    name: e.name, protocol: e.protocol, baseUrl: e.baseUrl,
    models: e.modelsText.split(',').map((s) => s.trim()).filter(Boolean),
  }
  if (e.apiKey) data.apiKey = e.apiKey // 空则不覆盖
  let saved
  if (e.id) saved = await api.updateProvider(e.id, data)
  else saved = await api.createProvider(data)
  editingProvider.value = null
  await reload()
  return saved
}
async function delProvider(p) {
  const r = await api.deleteProvider(p.id)
  if (r.ok === false && r.referencedBy) {
    const confirmed = await confirmDialog({
      title: '强制删除供应商',
      message: `有 ${r.referencedBy.length} 个 Agent 引用「${p.name}」。强制删除后这些 Agent 将失效。`,
      confirmText: '强制删除',
      danger: true,
    })
    if (confirmed) {
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
function newAgent() {
  const firstProv = providers.value[0]
  editingAgent.value = {
    name: '', color: AGENT_COLOR_PRESETS[agents.value.length % AGENT_COLOR_PRESETS.length],
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
  const confirmed = await confirmDialog({
    title: '删除 Agent',
    message: `删除 Agent「${a.name}」？`,
    confirmText: '删除',
    danger: true,
  })
  if (confirmed) {
    await api.deleteAgent(a.id)
    await reload()
  }
}

// ---------- Agent 内联新建供应商 ----------
const inlineProvider = ref(null) // 在 Agent 表单内弹出的新建 provider 草稿
function startInlineProvider() {
  inlineProvider.value = { name: '', protocol: 'openai', baseUrl: '', apiKey: '', modelsText: '' }
}
function applyInlineTemplate(t) {
  inlineProvider.value = { ...inlineProvider.value, name: t.name, protocol: t.protocol, baseUrl: t.baseUrl, modelsText: (t.models || []).join(', ') }
}
async function saveInlineProvider() {
  const e = inlineProvider.value
  const data = {
    name: e.name, protocol: e.protocol, baseUrl: e.baseUrl,
    models: e.modelsText.split(',').map((s) => s.trim()).filter(Boolean),
  }
  if (e.apiKey) data.apiKey = e.apiKey
  const saved = await api.createProvider(data)
  await reload()
  // 自动回填到正在编辑的 agent
  editingAgent.value.providerId = saved.id
  editingAgent.value.model = saved.models?.[0] || ''
  inlineProvider.value = null
}

// ---------- Agent 排序 ----------
async function moveAgent(index, dir) {
  const arr = agents.value
  const j = index + dir
  if (j < 0 || j >= arr.length) return
  const order = arr.map((a) => a.id)
  ;[order[index], order[j]] = [order[j], order[index]]
  await api.reorderAgents(order)
  await reload()
}

// ---------- 阵容模板载入 ----------
const showLineups = ref(false)
async function loadLineup(lineup) {
  const firstProv = providers.value[0]
  if (!firstProv) {
    await alertDialog({
      title: '需要供应商',
      message: '请先添加至少一个供应商，再载入阵容。',
    })
    return
  }
  const confirmed = await confirmDialog({
    title: '载入阵容模板',
    message: `载入阵容「${lineup.name}」？将新增 ${lineup.agents.length} 个角色，统一使用供应商「${firstProv.name}」（可逐个改）。`,
    confirmText: '载入',
  })
  if (!confirmed) return
  for (const a of lineup.agents) {
    await api.createAgent({
      name: a.name, color: a.color, systemPrompt: a.systemPrompt,
      providerId: firstProv.id, model: firstProv.models?.[0] || '',
    })
  }
  showLineups.value = false
  await reload()
}

async function saveSettings() {
  savedTip.value = 'saving'
  if (savedTimer) clearTimeout(savedTimer)
  try {
    await api.updateSettings({
      rounds: Number(rounds.value) || 1,
      orchestration: orchestration.value,
      moderatorProviderId: moderatorProviderId.value,
      moderatorModel: moderatorModel.value,
      maxTurns: Number(maxTurns.value) || DEFAULT_MAX_TURNS,
      summarize: summarize.value,
    })
    await reload()
    savedTip.value = 'saved'
  } catch (e) {
    savedTip.value = 'error'
  }
  savedTimer = setTimeout(() => { savedTip.value = '' }, TOAST_DURATION_MS)
}

function providerName(id) {
  return providers.value.find((p) => p.id === id)?.name || '（已失效）'
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <!-- 居中保存提示 -->
    <transition name="toast">
      <div v-if="savedTip === 'saved' || savedTip === 'error'" class="save-toast" :class="savedTip">
        <span class="toast-icon">{{ savedTip === 'saved' ? '✓' : '✕' }}</span>
        <span>{{ savedTip === 'saved' ? '已保存' : '保存失败，请重试' }}</span>
      </div>
    </transition>
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
            <div class="toolbar">
              <button @click="showLineups = true">⚡ 载入阵容模板</button>
            </div>
            <p class="hint hint-spaced">提示：修改角色只影响新讨论；已有会话保留创建时的角色快照。</p>
            <div v-for="(a, idx) in agents" :key="a.id" class="card" :style="{ borderLeftColor: a.color }">
              <div class="order-btns">
                <button class="mini" :disabled="idx === 0" @click="moveAgent(idx, -1)">▲</button>
                <button class="mini" :disabled="idx === agents.length - 1" @click="moveAgent(idx, 1)">▼</button>
              </div>
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
              <span v-for="c in AGENT_COLOR_PRESETS" :key="c" class="color-dot" :class="{ sel: editingAgent.color === c }" :style="{ background: c }" @click="editingAgent.color = c"></span>
            </div>
            <label>供应商</label>
            <div class="row">
              <select v-model="editingAgent.providerId" @change="onAgentProviderChange" class="row-fill">
                <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }} ({{ p.protocol }})</option>
              </select>
              <button @click="startInlineProvider" title="新建供应商">+</button>
            </div>

            <!-- 内联新建供应商 -->
            <div v-if="inlineProvider" class="inline-box">
              <div class="inline-title">新建供应商</div>
              <div class="templates">
                <button v-for="t in provTemplates" :key="t.name" class="tpl" @click="applyInlineTemplate(t)">{{ t.name }}</button>
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
                <button @click="inlineProvider = null">取消</button>
                <button class="primary" @click="saveInlineProvider" :disabled="!inlineProvider.name">创建并选用</button>
              </div>
            </div>

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

        <GeneralSettings
          v-if="tab === 'settings'"
          v-model:rounds="rounds"
          v-model:orchestration="orchestration"
          v-model:moderator-provider-id="moderatorProviderId"
          v-model:moderator-model="moderatorModel"
          v-model:max-turns="maxTurns"
          v-model:summarize="summarize"
          :providers="providers"
          :moderator-models="moderatorModels"
          :saved-tip="savedTip"
          @save="saveSettings"
        />
      </div>
    </div>

    <LineupModal
      v-if="showLineups"
      :lineups="lineups"
      @close="showLineups = false"
      @load="loadLineup"
    />
    <DialogModal :dialog="dialog" @resolve="resolveDialog" />
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
.card-desc { font-size: 13px; color: var(--muted); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-actions { display: flex; flex-direction: column; gap: 6px; }
.card-actions button { padding: 5px 12px; font-size: 13px; white-space: nowrap; }
.badge { font-size: 11px; background: var(--code-bg); color: var(--primary); padding: 2px 8px; border-radius: 999px; }
.badge-warn { font-size: 11px; background: var(--danger-bg); color: var(--danger); padding: 2px 8px; border-radius: 999px; }

.block { width: 100%; padding: 12px; margin-top: 6px; }
.form-actions { display: flex; gap: 10px; justify-content: flex-end; align-items: center; margin-top: 20px; }
.hint-spaced { margin-bottom: 10px; }
.row-fill { flex: 1; }
.stack-input { margin-top: 8px; }

/* 居中偏上的保存提示 toast（与主界面 app-toast 统一）*/
.save-toast {
  position: fixed; top: 10%; left: 50%; transform: translate(-50%, -50%);
  z-index: 200; display: flex; align-items: center; gap: 7px;
  padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 500;
  color: #fff; background: #323233; box-shadow: 0 6px 20px rgba(0,0,0,0.18);
  pointer-events: none;
}
.save-toast .toast-icon { font-size: 14px; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
.colors { display: flex; gap: 10px; }
.color-dot { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 3px solid transparent; }
.color-dot.sel { border-color: #00000030; transform: scale(1.1); }
.templates { display: flex; flex-wrap: wrap; gap: 8px; }
.tpl { font-size: 13px; }
.test-result { font-size: 12px; margin-top: 8px; padding: 6px 10px; border-radius: 6px; background: var(--code-bg); }
.test-result.ok { background: #e8f9ee; color: #1a8c3a; }
.test-result.bad { background: var(--danger-bg); color: var(--danger); }

.toolbar { margin-bottom: 12px; }
.order-btns { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.mini { padding: 2px 7px; font-size: 11px; line-height: 1; }
.inline-box { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 8px 0; }
.inline-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--primary); }

</style>
