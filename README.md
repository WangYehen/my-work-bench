# Personal AI Workbench

一个本地优先的个人工作管理平台。产品定位是对接**钉钉**、**邮箱（Outlook）**数据，并借助 **LLM 进行数据分析**；工作数据**完全存放到本地**，多用户按身份隔离。

> **产品方向说明**：本项目中的 Markdown 知识库（Vault）模块**暂不开发、不对用户开放**。Overview 总览、知识图谱、Wiki、素材库、书架、内容主题、文档阅读器和全文搜索等知识库相关模块的入口已隐藏，不作为对外功能；社媒洞察与抖音数据读取仍保留。

项目默认只在本机运行，并提供 synthetic demo 数据。真实邮箱、日历、账号数据和密钥都应保存在仓库之外。

## 功能概览

- 工作管理（产品主线）：今日工作（Today）、待办、周重点、周报和 AI 周报摘要。
- 日报与团队协作：本地日报草稿、Electron 本地存储、团队日报服务、管理员汇总和审计日志。
- Outlook：Microsoft Graph OAuth 连接、邮件同步、AI 待办分类、归档和断开连接。
- 钉钉：OAuth 连接、日程与待办同步，并为团队日报提供组织身份认证。
- 内容展示：每日热点（AI HOT 公开匿名 API）、Social Insights 与 Douyin（读取 Vault 中已整理的脱敏或 synthetic 数据，不在 Workbench 内抓取账号）。
- 多种运行形态：本地 Web、Electron 桌面端，以及面向静态托管的构建产物。

> **暂不开放**：知识库相关模块（Overview、Wiki、Materials、Books、文档阅读器、全文搜索、知识图谱与内容主题）——当前产品方向不开发、不对用户开放，导航入口已隐藏。

## 快速开始

要求：Node.js 20 或更高版本。

```bash
cd Workbench
npm install
copy .env.example .env        # Windows；macOS/Linux 使用 cp .env.example .env
npm run dev
```

启动后访问 `http://127.0.0.1:5174`。不配置外部服务时，相关页面会显示未配置状态。

## 常用命令

```bash
npm run dev              # 启动 Web Workbench 与 Team Server
npm run build            # 构建客户端及托管产物
npm run preview          # 预览生产构建
npm test                 # 构建并运行完整测试集
npm run privacy:scan     # 扫描仓库和 Demo Vault 的隐私边界
npm run demo:generate    # 重新生成 synthetic Douyin Demo 数据
npm run electron:dev     # 启动 Electron 桌面端开发模式
npm run electron:build   # 构建桌面安装包
```

## 接入自己的 Vault（仅用于社媒/抖音数据读取）

> 产品方向下，知识库浏览不开放，因此**不需要**接入完整 Vault。仓库旁边的 `个人知识库/` 是演示 Vault，仅用于社媒洞察与抖音数据等已整理数据的读取。

如确需替换数据来源，在 `Workbench/.env` 中设置：

```dotenv
PERSONAL_DASHBOARD_VAULT_ROOT=D:/path/to/your-vault
```

建议先阅读 [`Workbench/docs/vault-data-contracts.md`](Workbench/docs/vault-data-contracts.md)。缺失字段应保持为空，不要用虚构数据填充。真实数据必须放在公开仓库之外。

## 可选服务配置

所有配置示例都在 [`Workbench/.env.example`](Workbench/.env.example)：

- Outlook 需要 Microsoft Entra 应用、`Mail.Read` / `offline_access` 权限和本地 OAuth 回调；详见 [`Workbench/docs/outlook-one-click-setup.md`](Workbench/docs/outlook-one-click-setup.md)。
- 钉钉需要应用凭证、OAuth 回调和本地 Token 加密密钥，可同步日程与待办。
- Outlook 邮件分类需要 `DEEPSEEK_API_KEY`。邮件正文会在用户明确同意后发送给 DeepSeek，应用不在本地保存原始正文。
未配置这些服务时，核心 Vault 浏览和本地工作管理功能仍可使用。

## 项目结构

```text
person_dashboard/
├─ Workbench/
│  ├─ src/          React 页面、组件和前端状态
│  ├─ server/       Vite API、Vault 索引、Outlook、钉钉和工作管理服务
│  ├─ shared/       前后端共享契约与 AI 辅助逻辑
│  ├─ electron/     桌面端主进程、preload 和本地日报存储
│  ├─ worker/       静态托管 Worker 入口
│  ├─ scripts/      构建、测试、隐私扫描和 Demo 数据脚本
│  └─ tests/        Node 内置测试运行器测试
├─ 个人知识库/      synthetic Demo Vault，不放真实个人数据
├─ AGENTS.md        Agent 协作与仓库维护约定
└─ LICENSE          MIT 许可证
```

更完整的模块边界、数据流和 API 分组见 [`Workbench/docs/architecture-overview.md`](Workbench/docs/architecture-overview.md)。

## 隐私与安全边界

- 默认 loopback-only，不要在未配置认证时暴露到局域网或公网。
- 不要提交 `Workbench/.env`、`Workbench/.local/`、真实 Vault、导出文件、Cookie、Token、截图或本地路径。
- OAuth Token 在本地状态或团队服务中加密保存；Electron 启用 context isolation、sandbox，并通过最小化 preload API 通信。
- Markdown 渲染使用 sanitize；服务端会校验 Vault 根目录、相对路径和允许读取的文件范围。
- 发布前必须运行 `npm test`、`npm run build` 和 `npm run privacy:scan`。

## 维护建议

修改数据契约时，请同步更新索引逻辑、API、页面 fallback、文档和对应测试。保持 Vault 内容、SQLite 应用状态和团队 MySQL 数据的职责边界，避免同一事实在多个存储中产生不一致。

## 许可证

MIT，见 [`LICENSE`](LICENSE)。
