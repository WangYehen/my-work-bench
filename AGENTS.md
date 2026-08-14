# 仓库指南

## 产品方向

本项目定位为**本地优先的个人工作管理平台**：对接钉钉与 Outlook 邮箱数据，借助 LLM 进行数据分析；**所有数据（含团队日报、组织关系、审计）全部存放到本地 SQLite**，不再使用独立团队服务与 MySQL，多用户按身份隔离。**Markdown 知识库（Vault）模块暂不开发、不对用户开放**——Overview、知识图谱、Wiki、素材库、书架、内容主题、文档阅读器与全文搜索，以及社媒洞察、抖音数据等 Vault 内容展示模块的入口均已隐藏，不作为对外功能；每日热点（AI HOT 匿名 API）仍保留。任何知识库/社媒/抖音模块的开放/隐藏调整都必须同步更新本仓库全部相关文档。

## 项目结构与模块组织

`Workbench/` 包含基于 Vite、React 和 Electron 的应用。前端页面与组件位于 `Workbench/src/`；API 和 Vault 索引逻辑位于 `Workbench/server/`（钉钉日报同步、团队日报与组织关系等数据逻辑也全部在其中，数据存本地 SQLite，不再依赖独立团队服务或 MySQL）；共享数据契约位于 `Workbench/shared/`；桌面端代码位于 `Workbench/electron/`。测试统一放在 `Workbench/tests/`，静态资源和技术文档分别放在 `Workbench/public/` 与 `Workbench/docs/`。`个人知识库/` 是合成演示 Vault；修改其内容前，先阅读该目录下的 `AGENTS.md`。

## 构建、测试与开发命令

使用 Node.js 22 或更高版本，并从 `Workbench/` 目录运行：

```bash
npm install              # 按锁文件安装依赖
npm run dev              # 启动 Vite 工作台
npm run electron:dev     # 以开发模式运行桌面端
npm run build            # 生成生产及托管构建产物
npm test                 # 构建并运行完整测试套件
npm run privacy:scan     # 发布前扫描隐私数据
```

开发时可运行 `npm run test:materials`、`npm run test:graph-motion` 或 `npm run test:social-insights` 等专项测试。使用 `npm run preview` 在本地预览生产构建。

## 编码风格与命名规范

遵循相邻 JavaScript/JSX 文件的现有风格：两个空格缩进、使用分号和双引号，多行结构保留尾随逗号，并采用 ES Modules。React 组件和页面使用 `PascalCase.jsx`，例如 `GraphPage.jsx`；Hook 使用 `useCamelCase.js`，例如 `useVaultSync.js`；其他模块沿用现有的小写短横线命名。功能相关的 CSS、数据契约与工具代码应就近存放。仓库未配置全局格式化或检查工具，请避免无关的格式调整。

## 测试规范

测试使用 `node:test` 和 `node:assert/strict`，文件名遵循 `*.test.mjs`。行为变更必须补充回归测试，尤其关注数据契约、API 边界和隐私控制。仓库未设定数值化覆盖率门槛。提交前先运行相关专项测试，再执行 `npm test` 和 `npm run privacy:scan`。

## 提交与拉取请求规范

Git 历史采用简短、祈使语气的提交标题，例如 `Refresh README for current features`，不强制使用 Conventional Commits。每个提交只处理一个明确主题。拉取请求需说明用户可见影响、受影响模块、关联 Issue 和验证命令；涉及界面调整时，应附上前后对比截图或录屏。

## 安全与配置提示

禁止提交真实 Vault 内容、凭据、Token、导出文件、截图或本地路径。将 `Workbench/.env.example` 复制为 `.env` 保存本地配置；个人覆盖项应放在已忽略的文件中，例如 `Workbench/config/attention.local.json`。除非已经明确审查认证和网络暴露风险，否则服务必须仅监听本机回环地址。

## 本地优先钉钉与团队日报约定

- 当前页面数据必须走 `Workbench/server/vite-plugin-workbench.mjs` 的本地接口；独立的 `8787` 团队服务与 MySQL 已移除，不要重新引入，也不要以演示数据作为认证失败或同步失败的回退。团队日报、组织关系与审计数据全部存本地 SQLite。
- 本地业务身份固定为 `dingtalk:<企业 userid>`。`unionId/openId` 仅用于钉钉日程和待办 v1 路径，不能用作 `owner_identity_id`，也不能与企业 `userid` 混用。
- 所有个人数据（`work_items`、`goals`、`daily_reports` 及其查询）必须带当前身份的 `owner_identity_id` 条件；无所有者的历史数据不展示、不自动认领。账号切换、退出与未登录时必须清空前端内存状态并保持隐私锁定。
- 登录只完成当前账号的轻量身份识别；完整部门树和组织成员关系通过独立组织同步补全，禁止把全量组织扫描放进 OAuth 回调，以免登录超时。旧的 `unionId` 账号档案需要迁移到企业 `userid` 档案后再计算团队权限。
- 团队可见范围仅由本地 `org_members.manager_identity_id` 递归下级关系推导。主管的个人页面仍只能读取自己；只有团队日报、风险和团队周报可以读取下级数据。客户端不得传递任意用户范围绕过服务端授权。
- 钉钉日程 `/v1.0/calendar/users/:userId/...` 和待办 v1 API 必须传 OAuth `unionId/openId`；钉钉日报 `/topapi/report/list` 的个人筛选字段 `userid` 必须传企业 `userid`。
- “今日工作 → 同步日志”必须查询昨天的个人日报，将“明日工作计划”按当前身份幂等写入任务；日报与团队日报同步必须真实调用 `/topapi/report/list` 并入库，不能返回空成功响应。
