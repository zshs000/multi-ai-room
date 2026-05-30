<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../api.js'
import AgentSettings from './AgentSettings.vue'
import DialogModal from './DialogModal.vue'
import GeneralSettings from './GeneralSettings.vue'
import LineupModal from './LineupModal.vue'
import ProviderSettings from './ProviderSettings.vue'
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
        <AgentSettings
          v-if="tab === 'agents'"
          :agents="agents"
          :providers="providers"
          :editing-agent="editingAgent"
          :editing-agent-models="editingAgentModels"
          :inline-provider="inlineProvider"
          :prov-templates="provTemplates"
          @show-lineups="showLineups = true"
          @move-agent="moveAgent"
          @new-agent="newAgent"
          @edit-agent="editAgent"
          @delete-agent="delAgent"
          @agent-provider-change="onAgentProviderChange"
          @start-inline-provider="startInlineProvider"
          @apply-inline-template="applyInlineTemplate"
          @save-inline-provider="saveInlineProvider"
          @cancel-inline-provider="inlineProvider = null"
          @save-agent="saveAgent"
          @cancel-agent="editingAgent = null"
        />

        <ProviderSettings
          v-if="tab === 'providers'"
          :providers="providers"
          :editing-provider="editingProvider"
          :prov-templates="provTemplates"
          :test-result="testResult"
          @new-provider="newProvider"
          @edit-provider="editProvider"
          @delete-provider="delProvider"
          @test-provider="testProvider"
          @apply-template="applyTemplate"
          @save-provider="saveProvider"
          @cancel-edit="editingProvider = null"
        />

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
</style>
