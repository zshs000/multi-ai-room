# 多 AI 讨论室

多个 AI Agent 各扮角色、接入不同厂商模型（OpenAI 兼容 / Anthropic Claude），就一个话题同台轮流讨论。

## 快速开始

```bash
# 1. 安装并构建前端（生成 public/ 下的页面）
npm run build

# 2. 配置 API Key
cp config.example.json config.json   # 然后编辑 config.json，或启动后在界面「设置」里填

# 3. 启动
npm start
# 打开 http://localhost:3000
```

## 开发模式（前端热更新）

```bash
npm start              # 终端 1：后端
npm run dev:web        # 终端 2：前端 dev server，打开 http://localhost:5173
```

## 测试

```bash
npm test               # 适配器 + 存储层单元测试
```

## 架构

- **后端** `server.js` + `src/`：Node 原生 http，REST + SSE 流式讨论。
  - `src/adapters.js`：协议适配器注册表（openai / anthropic），加新协议只需一个实现 + 注册一行。
  - `src/store.js`：配置存储、旧结构迁移、密钥脱敏、引用完整性。
  - `src/templates.js`：供应商与阵容预置模板。
- **前端** `web/`：Vite + Vue 3，构建产物输出到 `public/`。
- **配置** `config.json`：含密钥，已 gitignore；结构见 `docs/API.md`。

## 文档

- `docs/ROADMAP.md`：迭代路线图与进度。
- `docs/API.md`：前后端接口契约。
