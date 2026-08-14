# Personal AI Workbench 技术架构

> 分析对象：`person_dashboard/Workbench` 及其旁边的 `个人知识库` Demo Vault  
> 分析时间：2026-08-13  
> 结论来源：项目源码、`package.json`、`vite.config.mjs`、测试目录和现有文档。本文描述当前工作区中的实现，不代表未来规划。

> **产品方向声明**：本项目的 Markdown 知识库（Vault）模块**暂不开发、不对用户开放**。产品定位为**本地优先的工作管理平台**，核心能力是对接钉钉与 Outlook 邮箱数据，并借助 LLM 进行数据分析；**所有数据（含团队日报、组织关系、审计）全部存放到本地 SQLite**，不再使用独立团队服务与 MySQL，多用户按身份隔离。Overview、知识图谱、Wiki、素材库、书架、内容主题、文档阅读器与全文搜索等知识库相关模块，以及社媒洞察、抖音数据等 Vault 内容展示模块的入口均已隐藏；每日热点（AI HOT 匿名 API）仍保留。

## 1. 架构摘要

Personal AI Workbench 是一个“本地优先、Agent 可调用”的个人工作管理台。产品主线是把钉钉（日程/待办/日报/组织）与 Outlook（邮件）数据同步到本地，由 React 前端统一聚合为“今日工作 → 日报 → 团队复盘”的工作流，并借助 LLM 提供邮件分类、日报草稿、周报摘要等分析能力；需要持久化的本地交互状态放在 SQLite 或 Electron 本地存储中。

> 代码仓库仍保留 Markdown Vault 的索引与展示能力，但知识库浏览/阅读/搜索以及社媒/抖音内容展示模块在产品上不开放；Vault 仅作为演示数据保留。

```mermaid
flowchart LR
    U[用户] --> UI[React + React Router 前端]
    UI --> API[Vite Workbench API 插件\n/api/*]
    API --> IDX[Vault Index\n扫描 / 解析 / 搜索 / 图谱]
    IDX --> V[个人知识库\nMarkdown / CSV / JSON / 图片]
    API --> DB[(SQLite\n任务 / 周重点 / 日报 / 团队数据 / 审计等)]
    API --> EXT[可选外部服务\nOutlook / DingTalk / DeepSeek / AI HOT]
    API --> AG[Codex Runner\nAgent 工作流与解释任务]
    DESK[Electron 主进程] --> UI
    DESK --> LOCAL[本地日报存储]
```

核心判断：它不是典型的前后端分离项目，而是以 Vite 开发服务器为宿主、由自定义插件同时承载前端开发和本地 API 的一体化应用。生产构建后，前端静态产物可用于 hosted/site 场景；桌面版通过 Electron 加载同一套前端，并额外暴露受控 IPC 能力。

## 2. 运行时与部署形态

### 2.1 本地 Web 开发模式

`Workbench/package.json` 的 `dev` 脚本启动 Vite 前端开发服务器，默认绑定 `127.0.0.1:5174`。

`vite.config.mjs` 注册了 `workbenchApiPlugin()`。该插件通过 `configureServer()` 拦截 `/api/*` 请求，因此本地页面、Vault API 和大部分业务逻辑共享同一个 loopback 服务。

### 2.2 Electron 桌面模式

`electron/main.mjs` 创建安全配置的 `BrowserWindow`：启用 `contextIsolation`、关闭 `nodeIntegration`、启用 sandbox，并通过 `preload.mjs` 只暴露日报相关 IPC 方法。Electron 主进程还负责：

- 在用户数据目录维护本地日报草稿和待同步数据。
- 定时同步待提交日报。
- 提供系统托盘入口。

因此 Electron 不是另一套业务前端，而是本地 Web Workbench 的桌面容器，加上一层本地离线日报能力。

### 2.3 Hosted / Worker 形态

`worker/index.js` 采用 Cloudflare Worker 风格的静态资源转发：普通请求交给 `env.ASSETS`，根路径 fallback 到 `index.html`。`Workbench/.openai/hosting.json` 当前没有配置 D1/R2 绑定，说明仓库本身更偏向静态/托管前端展示，完整本地 Vault 能力仍依赖本地 Node 运行时。

## 3. 代码分层

```text
Workbench/
├─ src/                 React 应用、页面、组件、前端状态与展示逻辑
│  ├─ pages/            路由级页面
│  ├─ components/       AppShell、抽屉、图谱、阅读器、领域组件
│  ├─ lib/              API 客户端、Markdown、阅读器、图谱等纯前端逻辑
│  ├─ graph/            知识图谱模型、布局、渲染、命中测试与动效
│  └─ hooks/            Vault 同步等 React Hooks
├─ server/              Vite 内置 API、Vault 索引、领域服务和安全校验
├─ shared/              前后端共享的数据契约、AI 摘要与 Token 工具
├─ electron/            Electron 主进程、preload 和本地日报存储
├─ worker/              静态托管 Worker 入口
├─ scripts/             构建、测试编排、隐私扫描、Demo 数据生成
├─ tests/               Node 内置 test runner 测试
└─ public/、docs/       静态资源与项目文档
```

前端路由集中在 `src/App.jsx`，导航入口在 `src/components/AppShell.jsx` 中配置。当前对用户开放的页面为工作管理（今日工作/待办/周重点/周报）、会议日程、日报与团队三页、Outlook、每日热点与系统页。Overview、Wiki、Materials、Books、Graph、内容主题、社媒洞察等页面仅保留路由与代码，导航入口已隐藏，不对用户开放（见文件头部产品方向声明）。

## 4. 数据架构

### 4.1 Vault：已整理数据的只读来源

在产品方向下，Vault 已无对外功能用途（知识库、社媒洞察与抖音数据模块均不开放），仅作为演示数据目录保留。默认 Vault 是项目旁边的 `个人知识库`；也可以通过 `PERSONAL_DASHBOARD_VAULT_ROOT` 指向仓库外的数据目录。`server/vault-index.mjs` 仍负责递归扫描、排除目录、解析 Markdown frontmatter、识别书籍/材料/Wiki/社媒数据，并构造文档索引（能力保留，不对外展示）。

Vault 的设计重点是“文件可读、来源可追溯”：

- 知识、社媒报告和账户数据以目录及文件契约组织。
- `searchIndex()` 为搜索和集合页提供统一入口（知识类页面不开放）。
- 文档通过稳定 ID/相对路径在前端、阅读器和图谱之间传递。
- 图片读取先经过允许根目录和路径校验，避免任意文件读取。
- `PUBLIC_HIDDEN_PATH_PREFIXES` 等规则将私有工作流目录排除在公开构建、搜索和最近项目之外。

### 4.2 SQLite：本地交互状态

`vite-plugin-workbench.mjs` 将 `.local/workbench.sqlite` 作为默认本地数据库路径，并在服务端组合任务、周重点、日报草稿等本地状态（阅读笔记、材料阅读状态等服务随知识库模块不开放而不再对外）。它保存的是“应用状态”和派生交互数据，不取代外部同步数据的存储职责。

### 4.3 钉钉日报与团队数据

钉钉日报的真实拉取与入库由 `server/dingtalk-reports.mjs` 与 `server/identity-context.mjs` 承担：前者通过 `/topapi/report/list` 拉取个人或下属日报，后者按 `dingtalk:<userid>` 身份写入本地 SQLite 的 `daily_reports`，并基于 `org_members` 推导团队可见范围。日报、团队日报、风险与团队周报均通过本地 `/api/local-daily-reports/*`、`/api/local-team/*` 接口提供。

### 4.4 外部集成与派生数据

当前代码中存在以下可选数据通道：

- Outlook：OAuth、同步、待办分类和归档，模型配置可使用 DeepSeek。
- DingTalk：OAuth、事件/日历与待办同步，以及团队日报认证。
- AI HOT：通过 `shared/ai-hot.mjs` 读取公开热点数据。
- Codex Runner：启动/取消/确认 Agent 工作流，支持 SSE 事件订阅。
- Douyin / Social Insights：读取 Vault 中已经整理好的脱敏或 synthetic 数据（模块不开放，代码能力保留）。

## 5. 请求与数据流

### 5.1 普通知识浏览

```text
页面组件
  → src/lib/api.js
  → fetch('/api/...')
  → vite-plugin-workbench.mjs
  → vault-index / domain service
  → Vault 或 SQLite
  → JSON 响应
  → 页面渲染
```

`src/lib/api.js` 统一处理超时、HTTP 错误和 fallback。部分读取型页面在 API 不可用时返回 `src/data/fallback.js` 中的安全演示数据；这使 UI 可以展示空服务状态，但不应被理解为真实业务数据。

### 5.2 Vault 热更新

`useVaultSync.js` 订阅 `/api/vault/events` 的 `EventSource`，服务端发现 Vault 变化后递增 revision。App 使用 revision 参与路由渲染 key，使集合页、图谱和相关页面能够重新读取索引。

### 5.3 阅读器与 Agent 解释

阅读器先从文档 API 获取正文，再通过 reader 相关服务维护锚点、笔记和解释线程。解释任务可以由服务端调用 Codex Runner；结果可继续追问，或保存为阅读笔记。Wiki ingest 和 XHS workflow 采用 job 模型，并以状态查询或 SSE 向前端报告进度。

### 5.4 工作管理与日报

任务、周重点和 AI 周报通过本地 `/api/tasks`、`/api/weekly-focus` 和 `/api/weekly-report/ai-summary` 接口工作。日报走本地 `/api/local-daily-reports/*` 接口；Electron 桌面优先通过 IPC 使用本地日报存储。

## 6. API 能力分组

API 路由目前集中在 `server/vite-plugin-workbench.mjs`，主要可分为：

| 分组 | 典型接口 | 主要后端模块 |
| --- | --- | --- |
| Vault 与搜索 | `/api/overview`、`/api/collections/*`、`/api/search`、`/api/documents/*` | `vault-index.mjs` |
| 阅读器 | `/api/reader-notes`、`/api/reader-explanations` | `reader-notes.mjs`、`reader-explanations.mjs` |
| Wiki 工作流 | `/api/wiki-ingest`、`/api/wiki-ingest/jobs/*` | `wiki-ingest-runner.mjs` |
| 图谱与内容 | `/api/graph`、`/api/materials`、`/api/books` | `vault-index.mjs`、`materials.mjs`、`books.mjs` |
| 本地工作管理 | `/api/tasks`、`/api/weekly-focus` | `tasks.mjs`、`weekly-focus.mjs` |
| 外部集成 | `/api/outlook/*`、`/api/dingtalk/*`、`/api/integrations/*` | `outlook.mjs`、`dingtalk.mjs` |
| 社媒与日报 | `/api/douyin/works`、`/api/social-insights`（社媒/抖音模块不开放）、`/api/local-daily-reports/*`、`/api/local-team/*` | 对应领域服务；日报与团队数据走本地 SQLite |
| 运行时与文件 | `/api/runtime`、`/api/refresh`、`/api/open` | 插件内运行时适配 |
| Agent 工作流 | `/api/reader-explanations`、`/api/workflows/*` | `codex-runner.mjs`、领域 runner |

## 7. 安全与隐私边界

项目的安全策略主要依赖“默认本地、显式连接、白名单读取”：

- 开发服务器默认只绑定 loopback。
- 真实 Vault 应放在公开 Git 仓库之外，通过环境变量连接。
- 前端读取文件时使用文档索引 ID，服务端再校验相对路径、允许根目录和文件大小。
- Markdown 渲染引入 `rehype-sanitize`，降低原始 HTML 风险。
- Electron 使用 context isolation、sandbox 和最小化 preload API。
- OAuth Token 在本地状态中加密保存，不直接暴露给前端。
- 仓库自带 `privacy:scan`，用于发布前扫描真实个人数据、凭据、导出文件和本地路径。
- Demo Vault 与示例数据应保持 synthetic；真实账号数据和真实知识内容不应提交到公开仓库。

需要特别注意：`Workbench/.env`、`.local/workbench.sqlite*`、外部 Vault 和已生成的 `dist/` 可能包含本机状态或派生数据。发布前应以隐私扫描结果和 `.gitignore` 为准，不应仅凭文件名判断安全。

## 8. 构建、测试与发布链路

```text
npm run build
  → scripts/build.mjs
  → Vite 构建 dist/client
  → 生成/整理 dist/server 等托管产物

npm test
  → npm run build
  → scripts/test.mjs
  → Node --test 执行 tests/*.test.mjs

npm run privacy:scan
  → 扫描仓库及旁边 Demo Vault 的敏感内容边界
```

测试按领域拆分，当前可以看到图谱、阅读器、材料/书籍、社媒、日报、钉钉、Outlook、工作管理、Vault 同步、Wiki ingest、站点 Worker 和隐私边界等测试（其中图谱/阅读器/社媒等领域的测试对应已隐藏模块的代码能力）。典型变更应至少运行对应领域测试，发布前运行 `npm test`、`npm run build` 和 `npm run privacy:scan`。

## 9. 架构优点与维护关注点

### 优点

1. Vault 与 UI 解耦：Markdown 仍可被 Obsidian 或其他工具直接使用（Vault 当前仅作演示保留）。
2. 本地优先降低隐私暴露面，外部集成是可选的。
3. 前端 API 客户端有 fallback 和统一错误处理，演示环境不依赖所有外部服务。
4. 工作管理、日报、身份权限等已按领域拆出服务/测试，便于逐步演进。
5. Web、Electron 和 hosted 形态共享前端，产品能力可复用。

### 维护关注点

1. `vite-plugin-workbench.mjs` 集中了大量路由和依赖，已经是主要的复杂度中心；继续扩展时宜将路由处理拆到领域 router 或 service adapter。
2. **知识库与社媒/抖音模块不开放是产品红线**：Overview、图谱、Wiki、素材、书架、主题、阅读器与搜索，以及社媒洞察、抖音数据均不对用户开放，调整隐藏范围必须同步所有相关文档（见头部产品方向声明）。
3. Vault 的目录、frontmatter 和 CSV/JSON 字段是隐式 API（当前模块已隐藏、无对外用途）；若日后恢复开放，修改契约时应同步更新索引、页面 fallback、文档和测试。
4. **所有数据统一存本地 SQLite**：团队日报、组织关系、审计与个人状态同库存储，不再有独立团队服务/MySQL；保持"内容/演示数据"与"本地应用状态"的职责边界，避免把同一事实写入两处后产生不一致。
5. Hosted/Worker 形态不能自然获得本地 Node API；部署文档应明确哪些页面是静态可用、哪些页面需要本地运行时。
6. 外部 OAuth、AI 模型调用和平台导出都属于高变依赖，应该保留配置缺失、超时、限流和数据不完整时的显式状态，而不是用 0 或虚构数据补齐。

## 10. 推荐的阅读顺序

新维护者可以按以下顺序理解项目：

1. `README.md`、`AGENTS.md`：项目目标、数据边界和开发约定。
2. `package.json`、`vite.config.mjs`：启动脚本、依赖和运行时接线。
3. `src/App.jsx`、`src/components/AppShell.jsx`、`src/lib/api.js`：路由、导航入口和 API 调用方式。
4. `server/vite-plugin-workbench.mjs`：API 路由总入口与服务组合。
5. `server/` 领域服务（`tasks.mjs`、`weekly-focus.mjs`、`dingtalk-reports.mjs` 等）：工作管理与钉钉同步。
6. `server/codex-runner.mjs`：Agent/异步工作流。
7. `electron/`、`worker/`：桌面和托管形态。
8. `tests/` 与 `docs/vault-data-contracts.md`：行为约束和数据契约。

## 11. 一句话结论

这是一个以钉钉/Outlook 工作数据为同步来源、以 Vite 自定义 API 插件为应用后端、以 React 为交互层、以本地 SQLite/Electron 承载全部状态与协作数据的模块化个人工作管理平台；知识库与社媒/抖音等 Vault 内容模块暂不开放，其核心工程风险在于集中式 API 插件、数据契约与多运行时边界的长期一致性。
