# PRD：团队日报阻塞点与"待领导决策"聚合展示

> 文档版本：v1.0（草案）
> 编写日期：2026-08-14
> 编写视角：高级产品经理
> 范围对象：Personal AI Workbench（person_dashboard/Workbench，本地优先个人工作管理平台）
> 关联文档：[`architecture-overview.md`](architecture-overview.md)、[`prd-work-management-and-team-collaboration.md`](prd-work-management-and-team-collaboration.md)、[`dingtalk-daily-report-sync.md`](dingtalk-daily-report-sync.md)

---

## 1. 背景与目标

### 1.1 背景

作为团队主管，最想看到的是：**收集团队日报后，团队当前阻塞点有哪些、哪些需要我决策**。

当前钉钉日报同步链路已打通：同步时已从日报模板提取 `blockers`（今日遗留工作）、`cooperationNeeds`（需要协作工作）、`nextActions`（明日工作计划）并写入本地 SQLite `daily_reports.raw_payload_ref`。但"主管看板"仍是断的：

| 环节 | 现状 | 证据 |
| --- | --- | --- |
| 日报数据入库 | ✅ 已完成 | `server/dingtalk-reports.mjs` 提取 → `identity-context.saveReports()` 入库 |
| 服务端团队聚合 | ❌ 空数组 | `identity-context.mjs` `dashboard()` 的 `summary.{blockers,decisions,nextActions}` 硬编码为 `[]` |
| 日报明细字段 | ❌ 缺失 | `dashboard()` 的 `reportRows` 未展开 `raw_payload_ref`，前端日报明细 `blockers/cooperationNeeds` 显示"无" |
| 前端三个面板 | ⚠️ 壳子就绪 | `TeamReportsAdminPage.jsx` 面板结构已渲染，但登录后数据为空 |

### 1.2 目标（本期范围）

在团队日报页，让主管看到**从真实日报聚合而来的**三块内容：
1. **团队共同阻塞**：跨成员去重、标注涉及成员与部门、给出严重度；
2. **需要领导决策**：由日报内容识别出的待主管拍板事项（含优先级）；
3. **明日关键行动**：成员日报"明日工作计划"的聚合。

### 1.3 用户决策（本期已确认）

- **识别方式**：用 LLM（DeepSeek）对当日全部日报做结构化分析；未配置 `DEEPSEEK_API_KEY` 或调用失败时，**降级为规则聚合**（不依赖外部服务、不使用演示数据）。
- **本期范围**：只做聚合与展示；"标记决策"落库、决策回流成员、日报已读（B-1）均留二期。

### 1.4 非目标

- 不做决策落库/回流/催办/表扬/已读（二期）。
- 不改变日报同步、组织关系同步、权限守卫（`TEAM_REPORT_FORBIDDEN`）的现有逻辑。
- 不引入独立团队服务或 MySQL（保持本地 SQLite）。

---

## 2. 数据契约

`/api/local-team/dashboard` 响应的 `summary` 结构（前后端一致，沿用现有面板字段并补充）：

```jsonc
{
  "blockers": [
    { "text": "测试环境接口不稳定，影响联调", "affectedMembers": ["周明", "孙悦"], "departments": ["接口服务组", "前端开发组"], "severity": "high" }
  ],
  "decisions": [
    { "text": "数据权限方案需确认交付范围", "owner": "王敏（产品组）", "dueAt": "2026-08-15", "priority": "P0", "reason": "阻塞数据权限优化排期" }
  ],
  "nextActions": [
    { "text": "完成接口稳定性修复", "owner": "接口服务组", "departmentName": "前端开发组" }
  ],
  "mode": "llm"
}
```

- `severity`：`low | medium | high | critical`；`priority`：`P0 | P1 | P2`。
- `mode` 随响应返回，供前端标注"AI 分析 / 规则聚合"。

---

## 3. 详细设计

### 3.1 服务端

#### A. `server/identity-context.mjs`
- `dashboard()` 的 `reportRows` 映射增加 `...safeJson(row.rawPayload)`，使每条 report 含 `blockers / cooperationNeeds / attachments / templateName / remark`（对齐 `ownReports()` 已有的展开方式），同时修复前端日报明细显示"无"的问题。
- 汇总当日全部可见成员日报的 `{ 成员名, 部门, blockers, cooperationNeeds, nextActions }` 供上层分析（不加逻辑到插件）。

#### B. `shared/team-daily-summary-ai.mjs`（新建）
完全复用 `shared/weekly-report-ai.mjs` 的模式：
- `normalizeTeamSummary(value)`：校验并归一化 `blockers/decisions/nextActions` 输出结构；
- `parseTeamSummaryResponse(content)`：剥离 ```json 包裹后 `JSON.parse`，失败抛 `TEAM_SUMMARY_INVALID`；
- `buildTeamSummaryPrompt(input)`：中文 prompt——"只输出 JSON、不补造事实、资料不足返回空数组"；
- `createTeamSummaryService({ config, fetchImpl, timeoutMs })`：DeepSeek `chat/completions`，`response_format: { type: "json_object" }`，`temperature 0.2`，`max_tokens 1200`；
- 错误码：`TEAM_SUMMARY_INVALID`、`DEEPSEEK_NOT_CONFIGURED`、`DEEPSEEK_REQUEST_FAILED`、`DEEPSEEK_TIMEOUT`。

#### C. `server/team-summary.mjs`（新建）
- `aggregateTeamSummary(reports)`：**规则回退聚合**
  - `blockers`：文本归一化（去首尾空白/多余换行）后去重；合并 `affectedMembers`（成员名）与 `departments`（部门名）；涉及人数 ≥ 3 或跨部门 → `high`，否则 `medium`；
  - `decisions`（回退态）：将 `cooperationNeeds` 非空条目作为待协调候选，按关键词（审批/确认/决策/资源/支持/协调/排期 等）赋 `priority`，`owner/dueAt` 留空；
  - `nextActions`：聚合去重。
- `analyzeTeamSummary(reports, { config, fetchImpl })`：
  - 配置了 DeepSeek → 调用 LLM，成功返回 `{ mode: "llm", ...parsed }`；
  - 未配置或调用失败 → 返回 `{ mode: "rule", ...aggregate }`（**降级是功能回退，不是演示数据回退**）。

#### D. `server/vite-plugin-workbench.mjs`
- 复用现有 `outlookConfig`（含 `deepseekApiKey/BaseUrl/Model`）初始化团队摘要服务（与 `createWeeklySummaryService` 并列）。
- `/api/local-team/dashboard`：在取得 `dashboard` 后，用其 `reports` 调 `analyzeTeamSummary` 生成真实 `summary` 填入响应；保持权限守卫与组织同步状态逻辑不变。
- 缓存：内存 `Map<date, summary>`（当日一次 LLM 调用）；`POST /api/local-daily-reports/sync`（scope=team-reports）成功时清除对应日期的缓存；限制缓存条目数防内存泄漏。

### 3.2 前端 `src/pages/TeamReportsAdminPage.jsx`
- 三面板（团队共同阻塞 / 需要领导决策 / 明日关键行动）读真实 `dashboard.summary`，现有渲染结构基本不变；
- 空态文案：无数据时显示"今日暂无阻塞 / 待决策 / 行动"，避免空白；
- 面板增加 `summary.mode` 标识（"AI 分析" / "规则聚合"）；
- 日报明细 `blockers/cooperationNeeds` 随服务端展开自动有值；空态文案由"演示视图不包含日报原文"改为"当日暂无日报"；
- 移除未引用的 `demo` 常量；未登录仍保留现有 `work-notice` 文案与空态；
- "标记已决策"按钮本期保留前端临时态，不接后端（二期改落库）。

---

## 4. 验收标准

- [ ] 配置 `DEEPSEEK_API_KEY` 时，团队日报页三面板展示**真实日报聚合**结果，且带"AI 分析"标识；
- [ ] 未配置 `DEEPSEEK_API_KEY` 时，三面板展示**规则聚合**结果，且带"规则聚合"标识，不报错、不展示演示数据；
- [ ] 日报明细中 `阻塞 / 协作 / 下一步` 显示真实文本（不再一律"无"）；
- [ ] 权限守卫不变：非主管仍被 `TEAM_REPORT_FORBIDDEN` 拦截；
- [ ] 同日重复请求命中缓存，不再重复调用 LLM；同步日志成功后缓存失效并刷新。

---

## 5. 非功能需求

| 类别 | 要求 |
| --- | --- |
| 隐私 | LLM 仅接收当日日报文本用于结构化分析；原文不本地留存，与现有周报摘要策略一致；变更后过 `npm run privacy:scan` |
| 兼容 | `summary` 数据结构向后兼容前端现有面板渲染；Web/Electron 行为一致 |
| 性能 | 当日一次 LLM 调用 + 内存缓存；不引入全表扫描以上量级 |
| 测试 | 数据契约/降级路径/API 边界必须补回归测试 |
| 可维护 | 遵循 KISS：逻辑放领域服务文件，不在 `vite-plugin-workbench.mjs` 堆代码；中文注释 |

---

## 6. 里程碑与二期规划

| 里程碑 | 内容 | 交付验证 |
| --- | --- | --- |
| **M1 聚合展示（本期）** | 真实日报聚合三面板 + LLM/规则双模式 + 空态 | 主管在团队日报页看到真实阻塞/待决策/行动 |
| M2 决策闭环（二期） | 标记决策落库（`report_feedback`）、回流成员、日报已读（B-1） | 决策结果成员可见，主管决策留痕 |
| M3 团队健康度（储备） | 提交率趋势、催办、表扬 | 团队节奏可视化 |

---

## 7. 风险与依赖

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| LLM 输出格式不稳定 | 面板数据异常 | `parse + normalize` 校验，失败自动降级规则聚合 |
| 未配置 DeepSeek 或调用失败 | 无 AI 分析 | 规则聚合降级，不抛错、不用演示数据，前端标"规则聚合" |
| token 成本 | 每日多次调用 | 按日期内存缓存 + 同步后失效 |
| 日报模板字段缺失 | 聚合为空 | 缺失字段保持空，前端显示空态文案 |

---

## 8. 涉及文件速查

- 服务端：`server/identity-context.mjs`、`server/team-summary.mjs`（新）、`server/vite-plugin-workbench.mjs`、`shared/team-daily-summary-ai.mjs`（新）。
- 前端：`src/pages/TeamReportsAdminPage.jsx`。
- 测试：`tests/team-summary.test.mjs`（新）、`tests/identity-context.test.mjs`（补充 dashboard.reports 展开断言）。

## 9. 验证命令

`npm run test:identity-context`（及相关专项）→ `npm test` → `npm run build` → `npm run privacy:scan`。
