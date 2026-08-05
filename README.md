# Personal AI Knowledge Workspace

一个本地优先、可被 AI Agent 调用并持续维护的个人知识库，以及它的可视化 Workbench。

它把 Raw 素材、Wiki 知识、阅读、灵感、内容生产、社媒研究和账号数据放进一套可读的 Markdown 目录中；Workbench 负责索引、搜索、阅读和图表展示。公开仓库只包含 synthetic demo，不包含作者的真实知识库或账号数据。

## 能做什么

- 用 Markdown 和 Obsidian 管理个人知识库，不绑定专有数据库。
- 在 Workbench 中查看 Raw、Wiki、知识关系、书架、灵感和内容状态。
- 展示脱敏的近期社媒风向与主题研究报告。
- 展示本人抖音创作者中心的作品、账号趋势、合集、留存和观众分析数据。
- 将需要推理或登录态的任务交给用户自己的 Codex、Claude Code 或其他 Agent。
- 所有真实内容和登录态都留在用户本机。

## 目录结构

```text
person_dashboard/
├── 个人知识库/   # 独立的 Markdown Vault 与 synthetic demo 数据
├── Workbench/    # 前端、服务端、测试、模板和开发工具
├── README.md
└── LICENSE
```

两层可以独立理解：

- `个人知识库/` 保存 Raw、Wiki、灵感、内容成果和抖音数据契约，可以直接用 Obsidian 或其他 Markdown 工具打开。
- `Workbench/` 不内置个人内容；默认读取旁边的 `个人知识库/`，也可以通过环境变量连接其他 Vault。

## 启动

要求 Node.js 20+。

```bash
cd Workbench
npm install
npm run dev
```

默认读取 `../个人知识库/`。如需连接自己的 Vault：

```bash
cp .env.example .env
```

然后在 `.env` 中设置：

```text
PERSONAL_DASHBOARD_VAULT_ROOT=/absolute/path/to/your-vault
```

建议把真实个人知识库放在公开 Git 仓库之外，再通过该环境变量连接，避免误提交个人资料或账号数据。

## 配套 Agent Skills

社媒洞察和抖音账号自动采集依赖配套 Skills，它们在独立仓库维护：

- [`research-social-insights`](../personal-workbench-skills/tree/main/skills/research-social-insights)
- [`douyin-account-data`](../personal-workbench-skills/tree/main/skills/douyin-account-data)

安装不要求使用特定 Agent：把 [`personal-workbench-skills`](../personal-workbench-skills) 仓库链接发给你正在使用的 Agent，让它把需要的 Skill 安装到自己的 Skill 目录即可。

Workbench 本身不会保存社媒或抖音登录态。两个 Skill 在访问需要登录的平台时依赖 [Ego Lite](https://lite.ego.app/download) 和它提供的 `ego-browser`。

### Ego Lite

Ego Lite 是一个允许本地 Agent 复用用户浏览器登录态的 Agent Browser。macOS 用户下载安装后，完成首次 onboarding；Ego Lite 会安装 `ego-browser` 命令及配套 Skill，并尝试接入本机已有的 Agent。随后在 Ego Lite 中登录需要访问的平台即可。

Ego Lite 官方当前只支持 macOS（Apple Silicon 和 Intel）：

- macOS：社媒登录态研究与抖音账号自动采集完整支持。
- Windows/Linux：社媒研究只能使用公开网页来源并明确标记覆盖降级；抖音自动采集暂不支持。
- Workbench 和仓库内的 synthetic demo 不依赖 Ego Lite，可以正常浏览。

不要把浏览器 Cookie、密码、会话参数、官方 Excel 或真实 `current.json` 提交到公开仓库。

## 抖音数据边界

配套抖音 Skill 只拉取用户本人有权访问的创作者中心数据，并生成 Workbench 读取的：

```text
<私人 Vault>/30_self_media/douyin/current.json
```

它不抓取其他账号、不读取私信、不生成内容策略，也不替用户决定下一条拍什么。官方导出和页面快照只在系统临时目录中存在；质量检查失败时不会覆盖上一版有效数据。

## 示例与隐私

`个人知识库/` 中的文章、书籍、风向快照、作品标题、账号指标和时间序列全部是从零编写的 synthetic demo，不来自任何真实个人或账号。

公开前在 Workbench 中执行：

```bash
npm test
npm run privacy:scan
```

隐私扫描覆盖整个仓库，包括与 Workbench 并列的 `个人知识库/`。

## 开发验证

```bash
cd Workbench
npm test
npm run build
npm run privacy:scan
```

## 许可证

MIT。见 [LICENSE](LICENSE)。
