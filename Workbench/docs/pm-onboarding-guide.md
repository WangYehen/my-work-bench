# Personal AI Workbench 产品经理入门指南

> 阅读对象：新接手本项目的产品经理
> 目的：在 30 分钟内建立对项目的整体认知，知道"产品是什么、功能有哪些、数据从哪来、怎么运行、如何调整、哪些是红线"，以便日后在此基础上做产品调整。
> 关联文档：[`architecture-overview.md`](architecture-overview.md)（技术架构）、[`vault-data-contracts.md`](vault-data-contracts.md)（数据契约）、[`prd-work-management-and-team-collaboration.md`](prd-work-management-and-team-collaboration.md)（既有 PRD）

---

## 〇、产品方向声明（必读）

> **本项目的 Markdown 知识库（Vault）模块当前暂不开发、不对用户开放。**
>
> 产品定位：**本地优先的工作管理平台**。核心能力是对接**钉钉**与**邮箱（Outlook）**数据，并借助 **LLM 进行数据分析**；数据**完全存放到本地**，支持**多用户数据隔离**。
>
> 因此，所有"知识库相关模块"（Overview 总览、知识图谱、Wiki、素材库、书架、主题，以及文档阅读器和全文搜索）的**导航入口已隐藏，不对用户开放**（代码与路由仍保留，不作为对外功能）。具体隐藏清单见第二节。

---

## 一、项目一句话定位

**Personal AI Workbench 是一个"本地优先、以钉钉 + 邮箱数据为工作对象"的个人工作管理平台。** 应用负责把钉钉日程/待办/日报、Outlook 邮件等数据汇总到统一的今日行动与日报闭环中，并借助 LLM 提供邮件分类、日报草稿、周报摘要等数据分析能力；数据完全存放在本地，多用户按身份隔离。默认只在本机运行，外部服务（钉钉、Outlook、DeepSeek）需配置后启用。

> 注：仓库代码中仍保留 Markdown Vault 的索引与展示能力，但作为产品方向，**知识库模块暂不开发、不对用户开放**（隐藏清单见下节）。

核心产品叙事（来自既有 PRD）：**每天从 Today 出发 → 执行并完成任务 → 提交日报 → 主管反馈 → 周度复盘 → 回到下周计划**，形成一条闭环主线。

---

## 二、功能模块地图

页面路由集中在 `src/App.jsx`。按产品能力归为 6 大域，其中"知识库相关模块"当前**全部隐藏、不对用户开放**（含代码层面保留、不作为对外功能）。

### 0. 已隐藏模块：知识库相关（暂不开发，不对用户开放）
以下页面/能力的导航入口已隐藏，不对用户开放，也不投入产品迭代（代码与路由仍保留，仅供社媒/抖音读取等能力复用）：

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 总览 | `/overview` | Vault 知识浏览（规模/健康度/最近文档） |
| 知识图谱 | `/graph` | Vault 知识星图 |
| Wiki 层 | `/wiki` | Vault 结构化知识列表 |
| 素材库 | `/materials` | Vault 原始材料浏览 |
| 书架 | `/books` | Vault 书籍阅读 |
| 内容主题 | `/topics` | Vault 选题管道 |
| 文档阅读器 | 全局抽屉 | 阅读 Vault 文档（锚点/笔记/AI 解释） |
| 全文搜索 | `Ctrl+K` 调色板 | 搜索 Vault 文档 |

### 1. 工作管理域（产品主线，数据来自本地 SQLite + 外部集成）
| 页面 | 路由 | 能力 | 数据来源 |
| --- | --- | --- | --- |
| 今日工作 | `/` | 聚合"任务 + 邮件行动 + 周目标"为行动列表，分桶排序，勾选完成；未登录时显示隐私锁定页 | 本地 SQLite + Outlook + 周重点 |
| 待办 | `/todos` | 任务 CRUD、完成/删除 | 本地 SQLite |
| 周重点 | `/weekly-focus` | 本周目标 + 手工进度滑杆 + 关联任务 | 本地 SQLite |
| 周报 | `/weekly-report` | 聚合任务/邮件/日报生成周报、AI 摘要、导出 Markdown | 本地聚合 |
| 会议 | `/meetings` | 钉钉日程月历（约每小时自动同步） | 钉钉 |

### 2. 日报与团队协作域（本地日报 + 团队数据）
| 页面 | 路由 | 能力 | 可见范围 |
| --- | --- | --- | --- |
| 日报 | `/daily-report` | 日报草稿、素材自动收集、AI 草稿、提交、历史日历 | 仅本人 |
| 团队日报 | `/team-reports` | 管理员/主管按日期、部门、成员筛选，处理阻塞/决策/行动 | 仅递归下级（无下级则重定向） |
| 团队风险 | `/team-risks` | 团队阻塞 + 未提交/迟交名单 | 仅递归下级 |
| 团队周报 | `/team-weekly-report` | 团队周报汇总（阻塞 + 下周行动） | 仅递归下级 |

### 3. 外部服务整合域（数据来自外部平台，未配置时显示未配置状态）
| 页面 | 路由 | 能力 |
| --- | --- | --- |
| Outlook | `/outlook` | Microsoft Graph OAuth、邮件同步、AI 待办分类、归档、断开 |
| 钉钉 | 系统页内 | OAuth、日程与待办同步，为团队日报提供组织身份 |

### 4. 内容展示域（读取已整理的脱敏/synthetic 数据，不抓取平台；保留开放）
| 页面 | 路由 | 数据来源 |
| --- | --- | --- |
| 每日热点 | `/daily-hot` | AI HOT 公开匿名 API |
| 社媒洞察 | `/social-insights` | Vault 中 `10_raw/social-insights/**` |
| 抖音数据 | 组件内嵌（当前未挂接到任何可见路由） | Vault 中 `30_self_media/douyin/current.json`（demoMode 标记） |

### 5. 系统页
| 页面 | 路由 | 能力 |
| --- | --- | --- |
| 系统状态 | `/system` | 钉钉登录、组织同步、集成状态、退出账号（隐私锁定入口） |

---

## 三、架构速览（产品视角，看懂"数据从哪来、存在哪"）

系统的存储职责边界清晰，**同一事实不应在两处重复维护**。产品定位下，工作数据完全存放到本地：

```text
【工作数据源】钉钉 + Outlook + 本地操作  ← 外部平台数据经同步入库，LLM 仅作分析不存原文
        │  同步/索引 server/ 各领域服务
        ▼
【本地应用状态】SQLite (.local/workbench.sqlite)  ← 任务、周重点、日报草稿等，数据完全在本机
        │  /api/*（Vite 内置 API，server/vite-plugin-workbench.mjs）
        ▼
【React 前端】页面各自拉取聚合 → Today / 周报 / 日报
        ▲
        │  /api/*（本地优先） / Electron IPC（桌面离线）
【桌面离线】Electron 本地日报草稿
【保留数据】Vault (Markdown/CSV/JSON) ← 仅用于社媒洞察/抖音等已整理数据读取；知识浏览模块不开放
```

三种运行形态（共享同一套前端）：
- **本地 Web**：`npm run dev`，Vite 服务器 + 内置 API（团队日报也走本地服务）。
- **Electron 桌面**：本地 Web 的桌面容器 + 离线日报草稿 + 系统托盘。
- **静态托管（Worker）**：仅静态页面，无本地 Node API，属于展示形态。

---

## 四、如何运行项目

要求 Node.js 22+，所有命令在 `Workbench/` 目录下执行：

```bash
npm install                  # 按锁文件安装依赖
copy .env.example .env       # Windows；macOS/Linux: cp .env.example .env
npm run dev                  # 启动 Web 工作台（默认 http://127.0.0.1:5174）
```

其他常用命令：

```bash
npm run electron:dev        # 启动 Electron 桌面端
npm run build               # 生产构建
npm test                    # 构建并运行完整测试套件
npm run privacy:scan        # 发布前隐私扫描（红线，必须执行）
npm run test:materials      # 专项测试示例（还有 graph-motion、social-insights 等）
```

未配置外部服务时，相关页面会显示"未配置"状态，核心工作管理功能不受影响。

---

## 五、关键概念与产品红线（调整前必读）

以下规则由仓库 `AGENTS.md` 强制约定，改动涉及架构级决策，需谨慎：

1. **本地业务身份 = 钉钉企业 userid**。身份统一为 `dingtalk:<userid>`；`unionId/openId` 只能用于钉钉日程/待办 API，**不能**用作数据所有者，也不能与 userid 混用。
2. **数据隔离**：所有个人数据（任务、目标、日报及其查询）必须带当前身份的 `owner_identity_id` 条件。无所有者的历史数据不展示、不自动认领。账号切换/退出/未登录时必须清空前端内存状态并保持隐私锁定。
3. **个人与团队边界**：主管的个人页面仍只能读自己；只有团队日报、风险和团队周报可以读下级数据。团队可见范围由本地 `org_members.manager_identity_id` 递归下级关系推导，客户端不得传递任意用户范围绕过服务端授权。
4. **登录与组织扫描分离**：登录只做轻量身份识别；完整部门树通过独立组织同步补全，禁止把全量组织扫描放进 OAuth 回调（会超时）。
5. **不重新引入独立的团队服务**：独立的 `8787` 团队服务已删除；当前页面数据必须走 `server/vite-plugin-workbench.mjs` 的本地接口，不要用演示数据作为认证失败或同步失败的回退。
6. **日报同步必须真实调用钉钉 `/topapi/report/list` 并入库存**，不能返回空成功响应。"今日工作 → 同步日志"必须查询昨天的个人日报，将"明日工作计划"按当前身份幂等写入任务。
7. **服务默认只监听本机回环地址（127.0.0.1）**，除非认证和网络暴露风险已被明确审查。
8. **知识库模块不开放**：Overview、图谱、Wiki、素材库、书架、主题、文档阅读器与全文搜索均不对用户开放（隐藏清单见第二节第 0 项）。社媒洞察与抖音数据仍保留；如产品上需要调整隐藏/开放范围，必须先在本指南与相关文档中同步说明。

---

## 六、如何做产品调整（常见场景的操作路径）

### 场景 A：只想改文案/提示语
- 前端文案散落在 `src/pages/*.jsx` 和 `src/components/*.jsx` 的 JSX 中，直接搜索对应中文关键词定位。
- 修改后本地 `npm run dev` 验证即可，无需改测试。

### 场景 B：改个人配置（Vault 路径、外部服务密钥、AI 模型等）
- 全部在 `Workbench/.env`（由 `.env.example` 复制而来）配置，参考键名：`PERSONAL_DASHBOARD_VAULT_ROOT`、`OUTLOOK_*`、`DINGTALK_*`、`DEEPSEEK_*`。
- `.env` 已被 Git 忽略，**禁止提交真实凭据**。
- 个人关注词等覆盖项放在 `config/attention.local.json`（已被忽略，适合个人定制）。

### 场景 C：改内容展示结构（页面依赖的数据契约）
- 在"知识库不开放"的方向下，Vault 数据契约当前**仅服务于社媒洞察与抖音数据**的读取（`10_raw/social-insights/**`、`30_self_media/douyin/current.json`）；知识浏览相关的契约改动已不再需要（对应模块已隐藏）。
- 若调整上述数据来源，仍需同步改 4 处：
  1. 索引逻辑 `server/vault-index.mjs`
  2. 页面 fallback `src/data/fallback.js`
  3. 契约文档 `docs/vault-data-contracts.md`
  4. 对应测试 `tests/*.test.mjs`
- 原则：缺失字段保持空，**不要用 0 或虚构数据补齐**。

### 场景 D：改后端行为/新增业务接口
- API 路由集中在 `server/vite-plugin-workbench.mjs`（当前最大的复杂度中心）。新增逻辑尽量放进领域服务文件（如 `server/tasks.mjs`、`server/weekly-focus.mjs`），不要在插件里堆代码。
- 前端通过 `src/lib/api.js` 统一调用 `/api/*`，自带超时、错误处理和 fallback。

### 场景 E：改团队协作/日报规则
- 团队侧逻辑在本地服务中：钉钉日报拉取在 `server/dingtalk-reports.mjs`，身份与权限在 `server/identity-context.mjs`，接口挂在 `server/vite-plugin-workbench.mjs`（`/api/local-team/*`、`/api/local-daily-reports/*`）。
- 表结构变更在 `server/db/migrations/` 新增迁移文件；改动必须补回归测试并过 `npm test`。

### 场景 F：新增/调整页面路由
- 路由集中在 `src/App.jsx` 的 `<Routes>` 中，页面文件放 `src/pages/`（`PascalCase.jsx`），组件放 `src/components/`，Hook 放 `src/hooks/`（`useCamelCase.js`）。
- 侧边导航入口在 `src/components/AppShell.jsx` 的导航配置数组中；知识库页面已不在该配置中（即导航入口已隐藏，路由代码仍保留）。

### 场景 G：调整"知识库模块"的隐藏/开放范围
- 当前隐藏范围见第二节第 0 项，由产品方向决定。导航入口在 `src/components/AppShell.jsx` 控制，路由在 `src/App.jsx` 控制。
- 任何开放/隐藏调整都必须同步更新本指南、README、架构概览等相关文档（见红线第 8 条），并评估对测试与契约文档的影响。

---

## 七、测试与发布红线

每次提交前：
1. 运行相关专项测试（`npm run test:<domain>`）；
2. 运行 `npm test`（先构建再跑全部测试）；
3. 运行 `npm run privacy:scan`（扫描真实个人数据、凭据、导出文件、本地路径）。

注意：即使扫描通过，仍需人工检查 Git 历史、截图、测试夹具、构建产物和本地配置。

---

## 八、文档与代码速查索引

| 用途 | 位置 |
| --- | --- |
| 仓库总约定（必须读） | `AGENTS.md` |
| 项目 README | `README.md`（根）与 `Workbench/README.md` |
| 技术架构 | `Workbench/docs/architecture-overview.md` |
| Vault 数据契约 | `Workbench/docs/vault-data-contracts.md` |
| 本地优先重构方案（数据模型演进方向） | `Workbench/docs/local-first-workbench-refactor.md` |
| 钉钉日报同步规则 | `Workbench/docs/dingtalk-daily-report-sync.md` |
| Outlook 接入指南 | `Workbench/docs/outlook-one-click-setup.md` |
| 公开发布边界 | `Workbench/docs/public-release-boundaries.md` |
| 既有产品 PRD（主线叙事 + 迭代规划） | `Workbench/docs/prd-work-management-and-team-collaboration.md` |

技术阅读建议顺序：`README` → `package.json`/`vite.config.mjs` → `src/App.jsx` → `src/lib/api.js` → `server/vite-plugin-workbench.mjs` → `server/vault-index.mjs` → 各领域服务 → 测试目录。

---

## 九、已知关注点（做调整前的风险提示）

1. **`server/vite-plugin-workbench.mjs` 是复杂度中心**：路由和依赖集中，迭代时优先复用领域服务文件，避免在插件中堆逻辑。
2. **知识库不开放是产品红线**：Overview/图谱/Wiki/素材/书架/主题/阅读器/搜索均不对用户开放；调整隐藏范围必须同步文档（见红线第 8 条）。
3. **Vault 契约目前仅服务社媒/抖音读取**：若继续调整这些数据，改动仍需四处同步（索引、fallback、文档、测试）。
4. **"本地 SQLite 状态"与外部工作数据的职责边界**：同一事实不要在两处写入，避免不一致。
5. **外部服务是高变依赖**：OAuth、AI 模型调用、平台导出都会变，应保留"配置缺失/超时/限流"的显式状态，不要用 0 或虚构数据补齐。
6. **Demo Vault（`个人知识库/`）是合成数据**：修改其内容前先读该目录下 `AGENTS.md`；真实账号数据和知识内容禁止进入公开仓库。
