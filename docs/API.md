# 多 AI 讨论室 · 接口契约 (API.md)

> 前后端契约的唯一事实来源。接口变动**先改本文件**再写代码。
> 版本：v1（对应路线图第一、二层）

## 一、数据模型

### Provider（供应商：一组凭证 + 协议）
```jsonc
{
  "id": "p_deepseek",          // 唯一 id，后端生成
  "name": "DeepSeek",          // 显示名
  "protocol": "openai",        // "openai" | "anthropic"
  "baseUrl": "https://api.deepseek.com",  // 见下方【baseUrl 约定】
  "apiKey": "sk-xxx",          // 仅存本地，永不入库、永不返回明文（见 §4）
  "models": ["deepseek-chat", "deepseek-reasoner"]  // 可选模型列表，供 Agent 下拉
}
```

> **baseUrl 约定（统一，避免 `/v1/v1` 拼错）**：`baseUrl` 一律填到**域名根**，不含 `/v1`、不含具体路径。各适配器自行拼接完整路径：
> - OpenAI 适配器 → `{baseUrl}/v1/chat/completions`
> - Anthropic 适配器 → `{baseUrl}/v1/messages`
> 后端在使用前对 baseUrl 做规范化：去掉结尾 `/`，若误填了结尾 `/v1` 则剥除。

### Agent（参与讨论的角色）
```jsonc
{
  "id": "a_pm",
  "name": "产品经理",
  "color": "#4f8cff",
  "systemPrompt": "你是一位产品经理……",
  "providerId": "p_deepseek",  // 引用某个 Provider
  "model": "deepseek-chat"      // 必须是该 provider.models 之一
}
```

### Config（整体配置，持久化于 config.json）
```jsonc
{
  "providers": [ /* Provider[] */ ],
  "agents":    [ /* Agent[] */ ],
  "rounds": 2                    // 每个 agent 各发言几轮
}
```

> **迁移说明**：旧版 config（顶层 baseUrl/apiKey/model + agents 内无 provider）在后端启动时自动迁移为新结构：生成一个默认 provider，所有旧 agent 指向它。

### 完整性与降级规则（边界情况）

引用关系可能因增删而失效，约定统一处理：

- **agent.providerId 指向不存在的 provider**：`GET` 返回该 agent 时附加 `invalid: "provider_missing"`，前端置灰并提示重新指定；发起讨论时若仍失效，对该 agent 发 `error` 事件并跳过（不崩整场）。
- **agent.model 不在其 provider.models 中**：保存 provider（删了某 model）时，后端扫描引用该 model 的 agent，将其 `model` 自动回退为该 provider 的**首个 model**，并在响应里返回 `migratedAgents: [...]` 告知前端。发起讨论时再次校验，仍不符则用首个 model 兜底。
- **删除最后一个 provider**：允许，但所有 agent 进入 `provider_missing` 失效态；前端首页应提示"请先添加供应商"。
- 校验时机：**写操作即时校验 + 发起讨论前兜底校验**，双保险。

---

## 二、REST 接口

所有响应 `Content-Type: application/json`。错误统一返回 `{ "ok": false, "error": "信息" }`，HTTP 4xx/5xx。

### 配置总览
| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/config` | 取完整配置（apiKey 脱敏，见 §4） |

返回示例：
```jsonc
{ "providers": [...], "agents": [...], "rounds": 2 }
```

### Provider 管理
| 方法 | 路径 | 请求体 | 作用 |
|---|---|---|---|
| GET | `/api/providers` | — | 列出所有 provider（apiKey 脱敏） |
| POST | `/api/providers` | `{name, protocol, baseUrl, apiKey, models}` | 新建，返回含生成的 id |
| PUT | `/api/providers/:id` | 同上（部分字段可省） | 更新；apiKey 为空或为掩码串时保留原值 |
| DELETE | `/api/providers/:id` | — | 删除。若有 agent 引用，默认返回 409 + `{error, referencedBy:[agentId...]}`；带查询 `?force=1` 则强制删除，引用它的 agent 进入 `provider_missing` 失效态 |
| POST | `/api/providers/:id/test` | — | 连通性测试，返回 `{ok, message, latencyMs?}` |
| POST | `/api/providers/test` | `{protocol, baseUrl, apiKey, model}` | 未保存时测试（建 provider 弹窗里用） |

### Agent 管理
| 方法 | 路径 | 请求体 | 作用 |
|---|---|---|---|
| GET | `/api/agents` | — | 列出所有 agent |
| POST | `/api/agents` | `{name, color, systemPrompt, providerId, model}` | 新建，返回含 id |
| PUT | `/api/agents/:id` | 同上（部分可省） | 更新 |
| DELETE | `/api/agents/:id` | — | 删除 |
| POST | `/api/agents/reorder` | `{order: ["a_x","a_y",...]}` | 批量重排发言顺序 |

### 全局设置
| 方法 | 路径 | 请求体 | 作用 |
|---|---|---|---|
| PUT | `/api/settings` | `{rounds}` | 更新讨论轮数等全局项 |

### 预置模板（只读）
| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/templates/providers` | 返回常见供应商预填模板（name/protocol/baseUrl/常见models，无 key） |
| GET | `/api/templates/lineups` | 返回阵容模板（辩论赛/头脑风暴等，含 agents 草稿） |

---

## 三、讨论流（SSE）

### 发起讨论
`POST /api/discuss`
请求体：
```jsonc
{ "topic": "我们要不要做登录功能？" }
```
响应：`Content-Type: text/event-stream`，每个事件为 `data: {json}\n\n`。
后端在流开始时先发一个 `start` 事件，携带本场 `discussionId`（后续中断/多会话据此定位）。

### SSE 事件类型
| type | 字段 | 含义 |
|---|---|---|
| `start` | `discussionId, topic, rounds` | 整场开始，返回会话 id |
| `agent_start` | `discussionId, agentId, name, color, model, providerName, round` | 某 agent 开始发言（前端建新气泡，可显示它用的模型） |
| `token` | `discussionId, agentId, text` | 流式增量文本，追加到当前气泡 |
| `agent_end` | `discussionId, agentId` | 当前 agent 发言结束 |
| `error` | `discussionId, message, agentId?` | 出错（某 agent 失败不中断整场，记录后继续下一个） |
| `done` | `discussionId` | 整场讨论结束 |

> **心跳**：后端每 ~15s 无数据时发送注释行 `: ping\n\n` 保活，前端忽略。
> **中断**（路线图 3.2）：前端关闭 fetch 的 ReadableStream 即可让后端 abort 当前 LLM 请求；如需服务端显式确认，可 `POST /api/discuss/stop` 带 `{discussionId}`。

---

## 四、密钥安全约定

- `apiKey` **持久化在本地 `config.json`，该文件已 gitignore**。
- 所有返回前端的 provider，不返回明文，改用两个派生字段：
  - `hasApiKey: boolean` —— 是否已设置 key
  - `apiKeyMask: string` —— 仅供展示，如 `sk-****1234`（保留前缀+后4位；过短则全掩码）
  - 返回体中**不含** `apiKey` 字段本身。
- 前端**更新** provider 时的覆盖规则（无歧义版）：
  - 请求体**不含** `apiKey` 字段，或 `apiKey` 为空字符串 → **保留原 key 不变**。
  - 请求体含非空 `apiKey` → **覆盖**为新值。
  - 即：永不拿掩码串做比对（掩码有损，可能误吞合法新 key）。前端"未改动 key"时直接不传该字段。
- 真实 key 仅在后端发起 LLM 请求时使用，不下发明文。

---

## 五、适配器层（后端内部接口）

按 `provider.protocol` 从注册表取适配器，调用方不感知差异。

```ts
interface ProviderAdapter {
  // 构造发往该协议的 HTTP 请求（url、headers、body）
  buildRequest(opts: {
    baseUrl: string, apiKey: string, model: string,
    systemPrompt: string, messages: ChatMsg[]
  }): { url: string, headers: object, body: object }

  // 创建一个流解析器。逐行喂入 SSE 原始行，产出标准事件。
  // 之所以用"有状态解析器"而非单行纯函数：Anthropic 的 SSE 是
  // `event:` 行 + `data:` 行配对，单行无法判断；OpenAI 也需跨行兜底。
  createStreamParser(): {
    // 喂入一行（已去除结尾换行）。返回本行解析出的事件，可能为空数组。
    push(line: string): Array<
      | { type: "delta", text: string }   // 文本增量
      | { type: "done" }                  // 流结束
    >
  }
}
```

- `ChatMsg = { role: "user"|"assistant", name?: string, content: string }`（统一内部模型，role 仅 user/assistant；其它角色发言以 user + `[名字]:` 前缀表达）。
- **system 差异由适配器吸收**：OpenAI 放进 messages 首条 `{role:"system"}`；Anthropic 放进 body 顶层 `system` 字段。
- **流式差异由 `createStreamParser` 吸收**：OpenAI 按 `data: {json}` 取 `choices[0].delta.content`，遇 `data: [DONE]` 产出 done；Anthropic 解析 `data:` 行 JSON，按其 `type` 字段判断（`content_block_delta`→取 `delta.text` 产出 delta；`message_stop`→产出 done），忽略 `ping`/`content_block_start` 等无关事件。
- **注册**：`adapters = { openai: OpenAIAdapter, anthropic: AnthropicAdapter }`。加 Gemini = 新增实现 + 注册一行。

### 各协议请求要点（实现参考）
| | OpenAI 兼容 | Anthropic |
|---|---|---|
| 完整 URL | `{baseUrl}/v1/chat/completions` | `{baseUrl}/v1/messages` |
| 认证头 | `Authorization: Bearer {key}` | `x-api-key: {key}` + `anthropic-version: 2023-06-01` |
| system | messages 首条 role=system | body 顶层 `system` 字段 |
| 流式开关 | `stream: true` | `stream: true` |
| 增量来源 | `data:` 行 → `choices[0].delta.content` | `data:` 行 JSON `type=content_block_delta` → `delta.text` |
| 结束判定 | `data: [DONE]` | `data:` 行 JSON `type=message_stop` |
| max_tokens | 可选（建议设默认如 1024） | **必填**（如 1024） |

> 注意：Anthropic 的结束标记在 SSE 里既有 `event: message_stop` 行也有对应 `data: {"type":"message_stop"}` 行。**统一以 `data:` 行 JSON 的 `type` 字段判断**，不依赖 `event:` 行，保证解析器只需处理 `data:` 内容。

---

## 六、编排逻辑（不变量）

- 共享历史 `history: {agentId, name, content}[]`。
- 轮到某 agent 时，`buildMessages`：自己历史发言→`assistant`，他人发言→`user` 且内容加 `[名字]：` 前缀，话题作为开场 user 消息。
- 双层循环：外层 `rounds` 圈，内层按 agent 顺序。
- 单个 agent 失败不终止整场：发 `error` 事件，跳过它，继续下一个。
