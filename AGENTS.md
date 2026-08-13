# 仓库指南

## 项目结构与模块组织

`Workbench/` 包含基于 Vite、React 和 Electron 的应用。前端页面与组件位于 `Workbench/src/`；API 和 Vault 索引逻辑位于 `Workbench/server/`；共享数据契约位于 `Workbench/shared/`；桌面端代码位于 `Workbench/electron/`；团队日报服务位于 `Workbench/team-server/`。测试统一放在 `Workbench/tests/`，静态资源和技术文档分别放在 `Workbench/public/` 与 `Workbench/docs/`。`个人知识库/` 是合成演示 Vault；修改其内容前，先阅读该目录下的 `AGENTS.md`。

## 构建、测试与开发命令

使用 Node.js 22 或更高版本，并从 `Workbench/` 目录运行：

```bash
npm install              # 按锁文件安装依赖
npm run dev              # 启动 Vite 与团队服务
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
