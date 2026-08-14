# Personal AI Workbench 开发入门指南

> 适用对象：新接手的资深开发工程师
> 目标：30 分钟内跑起来并看懂"代码在哪个文件、数据走什么链路、改某块功能该碰哪些文件"，之后能独立开始开发。
> 配套文档：[`architecture-overview.md`](./architecture-overview.md)（现状架构）、[`vault-data-contracts.md`](./vault-data-contracts.md)（Vault 数据契约）、[`development-prompt.md`](./development-prompt.md)（给 AI 编码助手的约束模板）。

## 1. 一句话定位

**本地优先、Vault 驱动、Agent 可调用的个人知识与工作管理台。** Markdown 文件是内容事实源，React 前端负责浏览与交互，Vite 自定义插件同时当开发服务器和本地 API 后端，SQLite / Electron / Team 服务承载各类状态与协作数据。

它不是传统"前后端分离"项目，而是 **Vite 插件 + React + Node 领域服务的一体化应用**。`npm run dev` 只起一个 Vite 进程，`/api/*` 请求被 `server/vite-plugin-workbench.mjs` 直接接管。

## 2. 快速启动

前置：Node.js 22+（README 写 20+，但仓库推荐 22+），仅本机运行。

```bash
cd Workbench
npm install
copy .env.example .env        # Windows；macOS/Linux: cp .env.example .env
npm run dev
```

- 访问 `http://127.0.0.1:5174`（端口写死在 `vite.config.mjs`，`WORKBENCH_PORT` 可改）。
- 不配任何外部服务也能用：核心 Vault 浏览、阅读器、任务、周重点都能跑，页面会显示"未配置"状态。

### 2.1 关于 .env

`.env.example` 注释即文档。最小可跑只需要配置 Vault 路径（不配则用仓库旁 `个人知识库/`）：

```dotenv
# 接自己的真实 Vault 时设置；真实 Vault 必须放在 Git 仓库之外
PERSONAL_DASHBOARD_VAULT_ROOT=D:/path/to/your-vault
```

Outlook / 钉钉 / DeepSeek 都属于可选配置，全部缺省时不影响本地核心功能。Token 加密密钥要求 32 字节 Base64。

## 3. 运行形态（同一个前端，四种壳）

| 形态 | 入口 | 说明 | 是否需要 |
| --- | --- | --- | --- |
| 本地 Web | `npm run dev` | Vite + `/api/*` 本地 API，功能最全 | 日常开发用这个 |
| Electron 桌面 | `npm run electron:dev` | 同一套前端 + 离线日报草稿（`electron/local-report-store.mjs`）+ 受控 IPC | 桌面场景 |
| Hosted/静态 | `npm run build` + Worker | `worker/index.js` 静态转发，无本地 Node API，部分页面不可用 | 发布托管 |

前端通过 `import.meta.env.VITE_WORKBENCH_HOSTED === "true"` 区分本地/托管，托管时不挂载 Outlook、Social Insights 等路由。

## 4. 代码目录导览（按开发频率排序）

```
Workbench/
├─ server/                      # 核心后端：全部 /api/* 的实现
│  ├─ vite-plugin-workbench.mjs # ★ API 路由总入口 + 服务组合（约 2000 行，复杂度中心）
│  ├─ vault-index.mjs           # Vault 扫描 / frontmatter 解析 / 搜索 / 图谱索引（约 2900 行）
│  ├─ identity-context.mjs      # ★ 身份与组织权限模型（钉钉身份、下属推导、日报权限）
│  ├─ tasks.mjs                 # 任务（work_items）
│  ├─ weekly-focus.mjs          # 周重点（goals）
│  ├─ reader-notes.mjs          # 阅读笔记
│  ├─ reader-explanations.mjs   # 阅读解释（Codex Agent 线程）
│  ├─ materials.mjs             # 材料库（10_raw 目录）
│  ├─ books.mjs                 # 书籍（10_raw/books）
│  ├─ outlook.mjs / dingtalk.mjs# OAuth 外部集成
│  ├─ security.mjs              # Vault 路径白名单校验（防任意文件读取）
│  ├─ db/local-first.mjs        # SQLite 打开 + 迁移执行
│  └─ db/migrations/*.sql       # 001 核心表 / 002 身份归属 / 003 多部门
├─ src/                         # 前端
│  ├─ App.jsx                   # ★ 路由、隐私锁、跨页面协调（打开文档/搜索/Vault revision）
│  ├─ lib/api.js                # ★ 所有 API 客户端统一入口，含 fallback
│  ├─ lib/api-errors.js         # 错误标准化
│  ├─ data/fallback.js          # 演示兜底数据（API 不可用时）
│  ├─ pages/                    # 路由级页面（19 个，PascalCase.jsx）
│  ├─ components/               # AppShell、阅读器、图谱、领域组件
│  ├─ hooks/useVaultSync.js     # Vault 热更新（EventSource 订阅 revision）
│  ├─ graph/                    # 知识图谱模型/布局/渲染/动效
│  └─ styles/ styles.css        # 样式
├─ shared/                      # 前后端共享：AI 摘要、钉钉 Token 管理、AI HOT loader
├─ electron/                    # 桌面主进程 / preload / 本地日报存储
├─ worker/                      # 静态托管 Worker
├─ scripts/                     # build / test / privacy-scan / demo 生成
├─ tests/                       # ★ node:test 测试（42 个领域测试文件）
├─ docs/                        # 架构与契约文档
└─ 个人知识库/                  # synthetic Demo Vault（仓库外），非真实数据
```

## 5. 核心数据流

### 5.1 一次普通请求

```
页面组件（src/pages/*.jsx）
  → src/lib/api.js（统一 fetch、超时 12s、错误标准化）
  → GET/POST /api/*
  → server/vite-plugin-workbench.mjs（路由分发）
  → 领域服务（tasks.mjs / vault-index.mjs / outlook.mjs ...）
  → Vault 文件 / SQLite / 外部 API
  → JSON 响应 → 页面渲染
```

要点：

- **前端永远通过 `src/lib/api.js` 发请求**，不要页面里直接 `fetch`。它统一处理超时与错误，且大部分读取接口带 `withFallback()`——后端不可用时返回 `src/data/fallback.js` 的演示数据并标记 `source: "fallback"`。
- **fallback 是"空服务状态展示"，不是真实数据**。别把 fallback 当业务回退逻辑用。
- 所有请求默认 12s 超时；同步邮件、AI 调用等重操作单独传 `timeout`（如 `syncOutlook` 120s）。

### 5.2 Vault 热更新

`useVaultSync.js` 用 `EventSource` 订阅 `/api/vault/events`；服务端检测到 Vault 变化后递增 revision。`App.jsx` 把 revision 拼进路由 key（`/wiki:${revision}`），触发集合页、图谱等页面重新拉索引。**改动索引相关代码时，注意 revision 失效机制。**

### 5.3 身份与权限模型（最重要的心智模型）

本地业务身份固定为 **`dingtalk:<企业 userid>`**（`identity-context.mjs` 的 `identityId()`）。

- 登录只做"当前账号轻量身份识别"；完整部门树/下属通过独立的组织同步补全（`applyOrganization`），**禁止在 OAuth 回调里做全量组织扫描**。
- **团队可见范围只由 `org_members.manager_identity_id` 递归推导**（`descendants()`）。`context.visibleIdentityIds` = `[自己, ...下属]`。
- 主管个人页只能读自己；**只有团队日报/风险/团队周报能读下级数据**，且服务端强制校验 `context.canViewTeamReports`。
- 所有个人数据（`work_items`、`goals`、`daily_reports` 查询）必须带 `owner_identity_id` 条件；**无所有者的数据不展示、不自动认领**。
- 钉钉日历/待办 v1 API 传 OAuth `unionId/openId`；钉钉日报 `/topapi/report/list` 的 `userid` 字段必须传企业 `userid`。二者不可混用。

> 前端侧：`App.jsx` 里 `teamUser` 为空（未登录/退出）时，除 `/system` 外全部渲染 `PrivacyLockedPage`，并清空搜索/文档抽屉等内存状态。做新页面时记得遵守这个隐私锁。

## 6. 数据存储：三层职责边界

| 存储 | 位置 | 内容 | 责任 |
| --- | --- | --- | --- |
| Vault（事实源） | `个人知识库/` 或 `PERSONAL_DASHBOARD_VAULT_ROOT` | Markdown/CSV/JSON，只读索引 | 内容归属，可被 Obsidian 直接读 |
| SQLite（应用状态） | `Workbench/.local/workbench.sqlite`（WAL） | work_items、goals、daily_reports、identities、org_members、笔记等 | 交互状态与派生数据 |
| Electron 本地 | 用户数据目录 | 日报草稿、待同步队列 | 桌面离线场景 |

**硬性边界**：同一事实只能有一个权威来源。"Vault 内容"和"SQLite 状态"不要互相复制造成不一致。改 schema 时在 `server/db/migrations/` 加新迁移文件（编号递增），`local-first.mjs` 会自动执行未应用的迁移，并对旧库做 `migrateLegacy` 数据搬移。

## 7. ★ 本地优先架构：别走回头路

`AGENTS.md` 明确了几条新接手者最易踩的坑：

- **当前页面数据必须走 `server/vite-plugin-workbench.mjs` 的本地接口**（`/api/...`）。**独立的 8787 团队服务已删除，不要重新引入**，也不要以演示数据作为认证失败/同步失败的回退。
- 钉钉日报与团队日报同步**必须真实调用 `/topapi/report/list` 并入库**，不能返回空成功响应。
- "今日工作 → 同步日志"必须查询昨天的个人日报，把"明日工作计划"按当前身份**幂等写入任务**。
- 服务只监听 loopback（`127.0.0.1`），除非已审查认证与网络暴露。

## 8. 页面与路由一览

路由集中在 `src/App.jsx`，导航在 `src/components/AppShell.jsx`：

| 路由 | 页面 | 数据来源 |
| --- | --- | --- |
| `/` | TodayWorkPage（今日工作） | `/api/tasks`、`/api/dingtalk/events` 等 |
| `/overview` | OverviewPage | `/api/overview` |
| `/wiki` `/topics` | CollectionPage | `/api/collections/*` |
| `/materials` | MaterialsPage | `/api/materials*` |
| `/books` `/books/:id` | BooksPage | `/api/books` |
| `/graph` | GraphPage | `/api/graph` |
| `/daily-hot` | DailyHotPage | AI HOT loader（`shared/ai-hot.mjs`） |
| `/todos` `/weekly-focus` `/weekly-report` | WorkManagementPage | `/api/tasks`、`/api/weekly-focus`、AI 摘要 |
| `/meetings` | MeetingsPage | 钉钉日程 |
| `/outlook` | OutlookPage | Microsoft Graph OAuth |
| `/daily-report` | DailyReportPage | 本地日报 / 钉钉同步 |
| `/team-reports` `/team-risks` `/team-weekly-report` | 团队三页 | 仅主管可见，走本地日报接口 |
| `/social-insights*` `/douyin` | 社媒/抖音 | Vault 中的脱敏/synthetic 数据 |
| `/system` | SystemPage | `/api/runtime`、集成状态 |

## 9. 动手开发：三类常见任务的改法

### 9.1 加一个新页面

1. `src/pages/MyNewPage.jsx`（PascalCase 文件名，2 空格缩进、分号、双引号）。
2. 在 `src/App.jsx` 加 `<Route>`，若需要进侧边栏，在 `AppShell.jsx` 的 `primaryNavigation` 加导航项。
3. 数据通过 `src/lib/api.js` 的新函数获取（见下）。

### 9.2 加一个新 API

1. **先看这个接口属于哪个领域**。优先在对应领域服务文件（`server/tasks.mjs` 等）实现逻辑。
2. 在 `src/lib/api.js` 加封装函数（带超时；读取类可包 `withFallback`）。
3. 在 `server/vite-plugin-workbench.mjs` 的请求分发处加一个 `if (req.method === "GET" && url.pathname === "/api/...")` 分支。
4. **不要在 vite-plugin-workbench.mjs 里堆大逻辑**——它已是公认复杂度中心（约 2000 行）。新逻辑放领域服务，插件只做路由转发。

### 9.3 改数据契约（Vault 或 API 字段）

改动字段名/结构时，**必须同步四件套**（AGENTS.md 硬约束）：

1. 索引逻辑：`server/vault-index.mjs` 或对应领域服务。
2. 前端 fallback：`src/data/fallback.js` 的演示数据。
3. 文档：`docs/vault-data-contracts.md`、`docs/architecture-overview.md`。
4. 测试：新增字段要有默认值、老数据兼容，并补回归测试。

## 10. 测试与验证

测试用 Node 内置 `node:test` + `node:assert/strict`，文件命名 `*.test.mjs` 放在 `Workbench/tests/`，无覆盖率门槛。

```bash
npm run test:materials        # 单个领域专项测试
npm test                      # 完整链路：build + 全部测试（并发=1，串行）
npm run build                 # 生产构建
npm run privacy:scan          # 发布前隐私扫描（扫真实数据/凭据/导出文件/本地路径）
```

提交前规范：跑对应专项测试 → `npm test` → `npm run privacy:scan`。新增行为必须补回归测试，尤其数据契约、API 边界、隐私控制。

## 11. 编码约定（AGENTS.md + CLAUDE.md 提炼）

- **KISS 原则**：函数 ≤ 20 行、单一职责、条件 ≤ 3 层用卫语句、组件职责单一；不做大规模/无关改动。
- **注释必须中文**，每个方法要有注释。
- 命名：React 组件/页面 `PascalCase.jsx`，Hook `useCamelCase.js`，模块小写短横线；`shared/` 契约、CSS、工具就近存放。
- 风格：ES Modules（`"type": "module"`），2 空格缩进，分号，双引号，多行尾逗号。仓库无 lint/format 工具，避免无关格式调整。
- 不破坏现有功能：老 API 语义向前兼容；Web / Electron / Hosted 三形态行为一致。
- 安全：不提交 `.env`、`.local/`、真实 Vault、凭据、导出文件、截图、本地路径；OAuth Token 加密存储（AES-256-GCM）；Markdown 渲染走 `rehype-sanitize`；服务端校验 Vault 根目录与相对路径。

## 12. 常见坑速查

| 坑 | 说明 |
| --- | --- |
| 端口 | 开发 5174（`WORKBENCH_PORT`），OAuth 回调注册地址必须与之一致 |
| 身份 | 一律 `dingtalk:<userid>`，不要用 unionId/openId 当 `owner_identity_id` |
| 团队权限 | 只靠 `org_members` 递归推导，客户端不得传任意范围绕过服务端授权 |
| fallback 语义 | 空服务演示，不是业务回退；认证/同步失败不能落到演示数据 |
| 大逻辑 | 别写进 `vite-plugin-workbench.mjs`，放领域服务文件 |
| 契约一致性 | 改字段 = 索引 + fallback + 文档 + 测试四件套 |
| 中文乱码 | 控制台读 JSX 中文可能乱码（本仓库 UTF-8 正常），用编辑器看 |

## 13. 推荐的阅读顺序（新接手者）

1. 本指南 + `AGENTS.md` + 根 `README.md`：边界与约定。
2. `package.json` + `vite.config.mjs`：脚本、依赖、运行时接线。
3. `src/App.jsx` + `src/lib/api.js`：路由与 API 调用方式。
4. `server/vite-plugin-workbench.mjs`：API 总入口与服务组合。
5. `server/identity-context.mjs`：身份与权限核心。
6. `server/vault-index.mjs` + `docs/vault-data-contracts.md`：Vault 契约。
7. 按需看 `electron/`、`worker/` 两种形态。

## 14. 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地 Web（127.0.0.1:5174） |
| `npm run dev:team` | Vite + 独立团队服务 |
| `npm run electron:dev` | Electron 桌面开发 |
| `npm run build` / `npm run preview` | 构建 / 预览生产 |
| `npm test` | 构建 + 全部测试 |
| `npm run privacy:scan` | 隐私边界扫描 |
| `npm run demo:generate` | 重新生成 synthetic Douyin demo 数据 |
| `npm run test:<领域>` | 专项测试（materials / books / graph-motion / social-insights / daily-hot ...） |
