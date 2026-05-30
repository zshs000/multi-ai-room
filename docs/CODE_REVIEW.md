# 项目规范审查建议

审查日期：2026-05-30

## 结论

项目核心功能已经可用，近期提交也修掉了几个会影响真实使用的风险点。初始审查发现四类主要规范问题：

1. 会话文件 IO 仍会吞掉损坏 JSON，与已修复的 config 安全策略不一致。
2. `server.js`、`web/src/App.vue`、`web/src/components/SettingsDrawer.vue` 文件过大，职责边界不清。
3. 默认值、特殊 ID、UI 常量和交互时长散落在服务端、前端组件和测试中，后续修改容易漂移。
4. 前端设置抽屉同时承载状态、表单转换、模板载入、确认弹窗和样式，已经超过单组件合理复杂度。

## 已认可的近期修复

以下修复与本次规范审查方向一致，建议保留：

| 提交 | 结论 | 证据 |
| --- | --- | --- |
| `ca5a3e4` `config 改原子写 + 写锁，损坏时报错而非静默丢 key` | 认可。配置文件含 API key，解析失败不能静默覆盖；原子写和串行写锁是必要的。 | `src/store.js:15`、`src/store.js:33`、`test/store-io.test.js` |
| `92f03f8` `主持人模式续聊也收敛轮数，不再跑满 maxTurns` | 认可。续聊跑满全局 `maxTurns` 会带来不可控 API 消耗。 | `src/orchestrator.js:182`、`test/orchestrator.test.js:72` |
| `ffc5ae4` `总结从 session.messages 构建，消除与 history 的双写漂移` | 认可。总结应以落盘消息为权威来源。 | `server.js:175`、`src/orchestrator.js:153` |
| `ae89d87` `实现 SSE 心跳，兑现文档承诺` | 认可。长时间模型首 token 延迟时需要心跳维持连接。 | `server.js:33`、`server.js:394`、`docs/API.md` |
| `781b639` `添加 GitHub Actions 自动构建与测试` | 部分认可。规范问题修复需要 CI 守门，但安装方式仍应从 `npm install` 改成 `npm ci`。 | `.github/workflows/ci.yml` |

## 子代理复核结论

已开独立 explorer 子代理复核本审查方向。子代理结论：可以据此形成审查文档并继续逐项修复；最近 5 个提交整体认可为合理修复。子代理额外指出两项应提高优先级的问题：

- `src/sessions.js` 的 `getSession()` 和 `listSessions()` 仍会吞掉损坏会话 JSON。
- `saveSession()` 写锁清理没有放在 `finally`，失败路径会遗留锁表条目。

本文件已合并这些反馈，并将会话 IO 调整为第一修复顺序。

## 本轮修复进展

| 问题 | 修复提交 | 验证 |
| --- | --- | --- |
| 会话损坏 JSON 静默吞掉、会话写锁失败路径不清理 | `a4e3da8` `fix(#5): 损坏会话不再静默消失` | `node test/sessions.test.js`、`npm test`、`npm run build` |
| CI 与根构建脚本绕过锁文件 | `fbe2cd5` `ci(#6): 使用 npm ci 固定前端依赖安装` | `npm test`、`npm run build` |
| 后端默认值、特殊 ID、颜色常量分散 | `702f131` `refactor(#7): 后端默认值和特殊标识集中到常量` | `npm test`、`npm run build` |
| Vite 开发代理端口硬编码 | `6bb4619` `fix(#8): Vite 开发代理支持自定义后端端口` | `npm test`、`npm run build` |
| 服务端入口混合 HTTP/SSE/provider 探活/讨论编排/API 路由 | `18c839a`、`a5c37a9`、`a325d0e` | `server.js` 降到约 41 行；`npm test`、`npm run build` |
| 前端显示常量分散 | `72ae788` `refactor(#10): 前端显示常量集中管理` | `npm test`、`npm run build` |
| `SettingsDrawer.vue` 静态行内样式 | `402734b` `style(#11): SettingsDrawer 静态行内样式改为类名` | `npm test`、`npm run build`；剩余 `:style` 均为动态颜色绑定 |
| `SettingsDrawer.vue` 职责过多 | `5247778`、`4dc4fcf`、`5deb28d`、`e35df41` | 拆出 `LineupModal.vue`、`GeneralSettings.vue`、`ProviderSettings.vue`、`AgentSettings.vue`；`npm test`、`npm run build` |
| `App.vue` 职责过多 | `02463f3`、`1398088`、`78ad9e1`、`bce2b9c`、`2d98904` | 拆出 `RenameSessionModal.vue`、`SessionSidebar.vue`、`ChatMessages.vue`、`ComposerBar.vue`、`useTheme.js`；`npm test`、`npm run build` |
| 原生 `confirm` / `alert` 混在业务组件中 | `75515d2` `refactor(#15): 统一前端确认弹窗` | `rg '\b(confirm\|alert)\(' web/src` 无匹配；`npm test`、`npm run build` |

当前仍可继续改进的方向：`App.vue` 仍保留 SSE 事件归并、会话载入和导出 Markdown；`SettingsDrawer.vue` 仍保留 API 状态协调。它们已经不再承载大块模板和样式，但如果后续要补前端单元测试，可以继续抽 `useDiscussionSession()`、`useMarkdownExport()`、`useSettingsState()` 等 composable。

## 原始待修复问题

### P0. 会话文件损坏被静默吞掉

证据：

- `src/sessions.js:63` 的 `getSession()` 捕获所有异常后返回 `null`，无法区分“不存在”和“JSON 已损坏”。
- `src/sessions.js:114` 的 `listSessions()` 对单个会话解析失败执行空 catch，损坏文件会从列表静默消失。
- 这与 `src/store.js:15` 对 config 损坏时抛错的策略不一致。

建议：

- 新增 `SessionCorruptError` 或复用严格 JSON 读取辅助函数。
- `getSession(id)` 仅对 `ENOENT` 返回 `null`，JSON 解析失败必须抛错。
- `listSessions()` 不应静默忽略损坏会话；至少返回可见的损坏摘要，或抛错让 API 层返回明确错误。第一阶段建议抛错，避免误导用户以为历史会话不存在。
- 补充测试：不存在会话返回 `null`；损坏会话读取和列表操作会报错。

收益：

- 避免历史会话无声消失。
- 防止后续保存路径把“损坏”误当“空会话”处理。
- 与 config 的数据安全策略一致。

### P1. 会话写锁失败路径没有清理

证据：

- `src/sessions.js:77` 维护每会话写锁。
- `src/sessions.js:86` 直接 `await task`，`src/sessions.js:88` 的清理只在成功路径执行。

建议：

- 参照 `src/store.js:44`，把锁表清理放进 `finally`。

收益：

- 避免失败 Promise 长期留在 `writeLocks`。
- IO 并发代码风格与 config 写锁保持一致。

### P1. 服务端入口承担过多职责

证据：

- `server.js` 约 378 行。
- 同一文件同时包含 HTTP 工具、SSE 心跳、连通性测试、讨论编排、静态文件服务、配置路由、Provider 路由、Agent 路由、Settings 路由和 Session 路由。
- 关键位置：`server.js:14`、`server.js:36`、`server.js:46`、`server.js:67`、`server.js:199`、`server.js:211`。

建议：

- 拆出 `src/http.js`：`readJsonBody`、`sendJson`、`sse`。
- 拆出 `src/sse.js`：`startHeartbeat` 和心跳默认值。
- 拆出 `src/provider-service.js`：供应商连通性测试和错误脱敏。
- 后续再拆 `src/discussion-service.js` 或 `src/routes/*`，让 `server.js` 只负责装配。

收益：

- 降低入口文件改动冲突。
- 心跳、JSON 响应、连通性测试可以独立测试。
- 后续添加认证、日志、CORS 或限流时不会继续堆到 `server.js`。

### P1. 前端设置抽屉过大且职责混杂

证据：

- `web/src/components/SettingsDrawer.vue` 约 444 行。
- 同一组件处理 tabs、Provider CRUD、Agent CRUD、内联 Provider 创建、Agent 排序、阵容模板载入、通用设置保存、toast、modal 和大量样式。
- 关键位置：`SettingsDrawer.vue:22`、`SettingsDrawer.vue:45`、`SettingsDrawer.vue:89`、`SettingsDrawer.vue:126`、`SettingsDrawer.vue:160`、`SettingsDrawer.vue:179`、`SettingsDrawer.vue:204`、`SettingsDrawer.vue:414`。

建议：

- 先拆纯逻辑常量到 `web/src/constants.js`。
- 再拆视图组件：`SettingsDrawer.vue` 保留抽屉外壳和 tab 状态，新增 `AgentSettings.vue`、`ProviderSettings.vue`、`GeneralSettings.vue`、`LineupModal.vue`。
- 表单转换函数如 `modelsText <-> models[]` 可放到 `web/src/settingsForms.js`。

收益：

- Agent 和 Provider 的编辑逻辑可以独立维护。
- 避免一个小 UI 调整导致整个设置抽屉冲突。
- 更容易补前端单元测试或组件测试。

### P1. 主应用组件过大，聊天、会话、主题、导出混在一起

证据：

- `web/src/App.vue` 约 431 行。
- 同一组件包含 SSE 消息状态机、会话侧栏、主题切换、toast、重命名弹窗、Markdown 导出和主布局样式。
- 关键位置：`App.vue:68`、`App.vue:93`、`App.vue:143`、`App.vue:176`、`App.vue:198`、`App.vue:231`、`App.vue:347`。

建议：

- 先拆出低风险纯函数：消息转换、Markdown 导出文件名、SSE 事件归并。
- 再拆 UI：`SessionSidebar.vue`、`ChatMessages.vue`、`ComposerBar.vue`、`RenameSessionModal.vue`。
- 主题状态可封装为 `useTheme()`。

收益：

- SSE 状态机与 UI 样式分离，后续更容易测“token 追加、done 刷新、error 重试”等行为。
- 会话侧栏和重命名弹窗可以独立演进。

### P2. 默认值与特殊标识硬编码分散

证据：

- `round-robin` 默认值散在 `server.js:104`、`server.js:139`、`server.js:366`、`src/store.js:147`、`src/sessions.js:55`、`web/src/App.vue:11`、`SettingsDrawer.vue:12`。
- `maxTurns` 默认值 `8` 散在 `server.js:369`、`src/store.js:150`、`SettingsDrawer.vue:15`、`SettingsDrawer.vue:30`、`SettingsDrawer.vue:188`。
- 总结特殊 ID `__summary__` 和颜色 `#5856d6` 散在 `server.js:176`、`src/orchestrator.js:156`、`src/orchestrator.js:164`、`web/src/App.vue:79`、`web/src/App.vue:153`。
- 默认颜色 `#888` / `#888888` 散在 `server.js:123`、`server.js:316`、`src/store.js:90`。
- 前端 toast 时长 `1500` 散在 `web/src/App.vue:23`、`SettingsDrawer.vue:196`。

建议：

- 后端新增 `src/constants.js`：`DEFAULT_ORCHESTRATION`、`DEFAULT_MAX_TURNS`、`DEFAULT_ROUNDS`、`SUMMARY_AGENT_ID`、`SUMMARY_AGENT_NAME`、`SUMMARY_AGENT_COLOR`、`DEFAULT_AGENT_COLOR`、`USER_MESSAGE_COLOR`。
- 前端新增 `web/src/constants.js`：复用显示层需要的 `SUMMARY_AGENT_ID`、`TOAST_DURATION_MS`、`AUTO_SCROLL_THRESHOLD_PX`、`SESSION_TITLE_MAX_LENGTH`、`AGENT_COLOR_PRESETS`。
- 不建议把所有文案都抽走；普通中文提示文案保持在使用点更可读。只抽会影响跨模块一致性的值。

收益：

- 避免后端写入的特殊 ID 与前端判断漂移。
- 修改默认轮数、默认主持人上限、默认颜色时只改一处。
- 测试能引用同一常量，减少“测试复制实现细节”的风险。

### P2. 开发代理端口硬编码

证据：

- 后端端口支持 `PORT`：`server.js:10`。
- Vite 开发代理仍固定到 `http://localhost:3000`：`web/vite.config.js:10`。

建议：

- Vite 代理目标改为读取 `VITE_API_PROXY_TARGET`，默认仍为 `http://localhost:3000`。
- README 记录：如果用 `PORT=4000 npm start`，前端开发服务需设置 `VITE_API_PROXY_TARGET=http://localhost:4000`。

收益：

- 开发时改后端端口不会让前端代理失配。
- 前后端配置边界更清楚。

### P2. CI 安装不可重复

证据：

- `.github/workflows/ci.yml` 使用 `npm install`。
- `package.json` 的根 `build` 脚本也在 `web` 目录执行 `npm install`。
- 仓库已有 `web/package-lock.json`，更适合用 `npm ci` 固定依赖树。

建议：

- CI 中构建前端改为 `npm ci && npm run build`。
- 根 `build` 脚本改为 `cd web && npm ci && npm run build`。

收益：

- CI 和本地构建更接近锁文件定义的依赖版本。
- 避免安装时顺手更新依赖解析结果。

### P2. 原生 `confirm` / `alert` 仍混在业务组件中

证据：

- `web/src/App.vue:171` 删除会话使用 `confirm`。
- `SettingsDrawer.vue:73` 强制删除 Provider 使用 `confirm`。
- `SettingsDrawer.vue:120` 删除 Agent 使用 `confirm`。
- `SettingsDrawer.vue:165` 缺 Provider 使用 `alert`。
- `SettingsDrawer.vue:168` 载入阵容使用 `confirm`。

建议：

- 短期可以保留功能，但在文档中标记为 UI 规范债。
- 后续新增统一确认弹窗组件或 composable，如 `useConfirm()`，替代原生阻塞弹窗。

收益：

- 体验与已完成的“重命名居中弹框”保持一致。
- 更容易在确认弹窗里展示影响范围、危险态和撤销提示。

### P3. 行内样式影响样式统一

证据：

- `SettingsDrawer.vue:228` 使用 `style="margin-bottom:10px"`。
- `SettingsDrawer.vue:263` 使用 `style="flex:1"`。
- `SettingsDrawer.vue:275`、`SettingsDrawer.vue:276`、`SettingsDrawer.vue:280`、`SettingsDrawer.vue:281`、`SettingsDrawer.vue:282` 使用 `style="margin-top:8px"`。
- `SettingsDrawer.vue:361`、`SettingsDrawer.vue:375` 使用 `style="width: 120px"`。

建议：

- 改为语义类名，如 `.hint-spaced`、`.row-fill`、`.stack-input`、`.number-short`。

收益：

- 样式集中管理，减少模板噪音。
- 后续拆组件时样式迁移更清晰。

## 修复顺序建议

1. 先修 `sessions.js` IO 安全：损坏 JSON 不静默吞、写锁失败路径清理。
2. 再修 CI 可重复性：`npm install` 改 `npm ci`，避免锁文件被绕过。
3. 再抽常量：风险小，能减少后续拆分时的漂移。
4. 再拆服务端 HTTP/SSE/provider service：边界清晰，测试成本低。
5. 再拆前端设置抽屉：优先拆 Provider/Agent/General 三个面板。
6. 最后拆 `App.vue`：先抽纯函数和小组件，再处理会话侧栏与消息列表。
7. 统一确认弹窗和行内样式可以穿插在前端拆分之后做。

## 提交策略

- 每个问题单独提交。
- 每个提交必须包含对应测试或验证。
- 涉及行为变化的提交先补测试；纯文档和纯样式/组件移动提交可用构建验证。
- 提交信息可以追加 `Co-Authored-By:`。
