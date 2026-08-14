# 开发 Prompt（可直接复制给 AI 编码助手）

> 用法：把下面的内容整体复制给 AI（如 opencode/Claude Code），
> 替换 `【范围】` 段落中你要的里程碑（M1~M5 见 PRD 第 8 节）即可。
> 完整需求细节见 `Workbench/docs/prd-work-management-and-team-collaboration.md`。

---

## Prompt 正文

你是一位资深全栈工程师，参与完善 **Personal AI Workbench**（个人 AI 工作台）项目。项目位于 `D:\AI学习\个人工作台2\person_dashboard\Workbench`。开始前请先阅读 `Workbench/docs/architecture-overview.md`、`Workbench/docs/prd-work-management-and-team-collaboration.md` 和仓库根目录 `AGENTS.md`，并在动手前向我复述一遍你对以下关键事实的理解，确认无误后再编码。

### 项目关键事实（数据流转）

- 前端：React 19 + Vite + React Router，页面在 `Workbench/src/pages/`，API 客户端统一走 `src/lib/api.js`（含 fallback 机制，`src/data/fallback.js` 提供演示兜底）。
- 后端：API 由 `server/vite-plugin-workbench.mjs` 拦截 `/api/*` 提供；领域服务在 `server/`（如 `tasks.mjs`、`weekly-focus.mjs`）。
- 存储：Vault（Markdown 内容事实源，只读索引） / SQLite（`Workbench/.local/workbench.sqlite`，本地任务、笔记等应用状态） / Team Server（`team-server/`，MySQL，日报、用户、审计） / Electron 本地草稿（桌面离线）。
- 团队 API：`team-server/server.mjs` 提供 `/api/team/*`（钉钉 OAuth 登录、日报 PUT/GET、dashboard、weekly-summary、members、审计），Bearer Token 会话。
- 外部集成：Outlook（OAuth + DeepSeek 邮件分类）、钉钉（日程/待办/团队登录）、AI HOT、Codex（阅读解释/工作流）。

### 本次开发范围

【范围】执行 PRD 中的以下需求（从 M1 开始，一次只做当前里程碑，做完并验证后再做下一个）：

- M1 行动闭环：A-1（Today 行动卡片来源/逾期徽标与回源跳转）、A-2（任务状态字段 + 截止时间 + 筛选）、A-3（逾期分组与顺延）
- M2 个人日报确定性：B-1（送达/已读状态）、B-2（漏交提醒）
- M3 主管效率：B-3（我的下属视图 + 单日速览）、B-5（决策回流）

（如未指定里程碑，默认只做 M1。）

### 硬性约束

1. 遵循 KISS 原则：函数 ≤ 20 行、单一职责、避免过度设计；不做无关重构、不扩展范围。
2. 代码注释必须使用中文；React 组件 `PascalCase.jsx`、Hook `useCamelCase.js`，沿用现有代码风格（2 空格缩进、分号、ES Modules）。
3. 数据契约变更必须同步：`shared/` 契约、`src/data/fallback.js`、相关文档与测试；老数据兼容（新增字段要有默认值）。
4. 不破坏现有功能：原有 API 语义向前兼容；Web / Electron / 托管三形态行为一致。
5. 隐私边界：不新增存储邮件正文/凭据；保持 loopback-only；不提交 `.env`、`.local/`、真实数据。
6. 不得把大逻辑堆进 `server/vite-plugin-workbench.mjs`，新逻辑放对应领域服务文件。

### 交付与验证

每完成一个里程碑：
1. 列出改动文件清单与每个文件的改动要点；
2. 运行相关专项测试（`npm run test:materials` 等对应领域）+ `npm test` + `npm run build`；
3. 运行 `npm run privacy:scan` 确认隐私边界；
4. 给我一段"验证步骤"，说明如何在浏览器/桌面端手工复验该里程碑的用户故事（PRD 第 6 节验收标准）。

最后用表格汇总本次所有改动与验证结果。如果发现 PRD 与现状代码冲突（例如接口已存在、字段名不同），先指出冲突点并给出你的建议方案，不要擅自按 PRD 硬改。
