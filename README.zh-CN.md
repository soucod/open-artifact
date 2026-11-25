# Open Artifact

[English](README.md) · 简体中文 · [日本語](README.ja.md)

> **前身是 `baoyu-design`。** 本项目由 [baoyu-design](https://github.com/JimLiu/baoyu-design)（旧地址会自动跳转到这里）
> 演变而来。baoyu-design 把 claude.ai 风格的 Artifact 类型带到了本地编码 Agent 上，每种类型一个 skill。Open Artifact
> 把它们重做成一套开放、不绑定任何 Agent 的格式：一个本地守护进程（daemon）、一个页面框架、一个 `/open-artifact`
> skill，再为每个 Agent 应用各配一个插件。

**Open Artifact 让任何编码 Agent 都能做出可以打开、编辑、评论的东西，而不只是一堆文件。** 你让 Agent 做一份幻灯片、
一套 UI 设计、一个设计系统、一块白板、一张表格、一个数据看板、一份文档或一段短动画，Agent 写出一个普通的文件夹；本地页面用真正的编辑器打开它，你可以直接改标题、
挪便利贴、留评论、导出。点"Send to agent"，你的评论就回到 Agent 的会话里。

一切都在你自己的电脑上运行：不需要账号，不用上传，也不限定模型或厂商。

```
  你 ──"/open-artifact slides a 6-slide pitch"──▶ Agent（Claude Code、Codex、Cursor、Copilot……）
                                                    │ 写文件
                                                    ▼
                                          ./my-deck/project/deck.json + slides/*.html
                                                    │ 由本地 daemon 提供页面
                                                    ▼
  你 ◀── 编辑 · 评论 · 导出（PDF/PPTX/PNG/HTML）── http://127.0.0.1:<port>/a/<id>
   └──────────────── "Send to agent" ──────────────▶ 评论回到 Agent 的会话
```

## 文档指南

完整的双语（中/英）用户与 Agent 文档在 [docs/](docs/README.zh-CN.md)：

- [什么是 Open Artifact？](docs/overview.zh-CN.md) — 核心概念、核心优势与快速上手。
- [Artifact 类型总览](docs/artifact-types.zh-CN.md) — 对比全部 9 种类型、选型建议与存储模型。
- [Agent 使用指南](docs/agent-guide.zh-CN.md) — MCP 工具、CLI 回退、生命周期、评论处理与安全边界。

### 在做 Agent 产品？

如果你发布的是一个 Agent 应用（桌面应用、IDE 扩展、命令行，或带本地助手的网页应用），可以把 Open Artifact 做进去：你的 Agent 通过它自己的工具创建作品，页面显示在你的界面里，人从页面发出的评论送到正确的会话。从[把 Open Artifact 接入 Agent 产品](docs/integrating.zh-CN.md)开始；Node SDK 是 [`@open-artifact/harness-kit`](packages/harness-kit/README.md)，[examples/](examples/README.md) 里有可以运行的适配器。不是用 JavaScript 写的应用用 stdio 桥（`open-artifact harness --stdio`）。

## Artifact 类型

| 类型 | 你得到什么 | 标识文件 | 导出格式 | 指南 |
|---|---|---|---|---|
| **Slides** | 1920×1080（或 4:3）的演示文稿：幻灯片栏、总览、演讲者备注、逐项动画、转场、演示模式、多边形相框 | `project/deck.json` | PDF、PPTX、HTML、PNG | [指南](docs/types/slides.zh-CN.md) · [SKILL](artifact-types/slides/SKILL.md) |
| **Design** | 由实时 `.dc.html` 画板组成的无限画布：界面、组件、可点击原型、便签、多页面 | `project/canvas.json` | PNG、JPEG、PDF、HTML | [指南](docs/types/design.zh-CN.md) · [SKILL](artifact-types/design/SKILL.md) |
| **Design System** | 品牌手册：设计令牌（tokens）、带对比度检查的颜色、字体样张、实时组件预览、素材。Design、Slides、Data 和 Motion 都可以安装它 | `project/design-system.json` | — | [指南](docs/types/design-system.zh-CN.md) · [SKILL](artifact-types/design-system/SKILL.md) |
| **Whiteboard** | 多人共享的无限白板：便利贴、形状、箭头、手绘、图片、表格、嵌入网页、实时光标、计时器 | `db/board/meta.json` | PNG | [指南](docs/types/whiteboard.zh-CN.md) · [SKILL](artifact-types/whiteboard/SKILL.md) |
| **Sheets** | 多人共享的电子表格：多工作表单元格、完整公式引擎、数字格式、边框、合并单元格、带筛选的数据表、下拉菜单、复选框、条件格式、冻结与分组行列、基于单元格的图表、CSV 导入、单元格历史 | `sheet/sheet.json` | XLSX、CSV | [指南](docs/types/sheets.zh-CN.md) · [SKILL](artifact-types/sheets/SKILL.md) |
| **Data** | 实时数据看板或报告：支持 CSV/JSON/文本上传、实时 MCP 连接器查询或脚本计算，由原生 HTML/CSS/d3 渲染；Sources 展示每个数字的来源；支持筛选、手改文字与 Remix 草稿 | `db/dash/meta.json` | PDF、HTML、JSON | [指南](docs/types/data.zh-CN.md) · [SKILL](artifact-types/data/SKILL.md) |
| **Docs** | 分标签页的在线文档：标题、列表、表格、图片、日期、提及和下拉选项；可接受或拒绝的修改建议、评论、每个标签页各自的版本历史；可导入 Markdown、Word 和 PDF | `doc/doc.json` | Markdown、Word、PDF、HTML | [指南](docs/types/docs.zh-CN.md) · [SKILL](artifact-types/docs/SKILL.md) |
| **Motion** | 短动画影片：场景是按时间绘制的 HTML/CSS/JS，自动生成配乐，先粗剪再定稿，字幕和旁白；可以手改文字、配色、字体、场景长度和单个元素的样式；评论可以钉在某一时刻或画面上的某一点 | `db/film/meta.json` | MP4、GIF、HTML、ZIP | [指南](docs/types/motion.zh-CN.md) · [SKILL](artifact-types/motion/SKILL.md) |
| **Page** | Agent 整张写好的自由 HTML 页面：小部件、小工具、小游戏或解释页，按声明开放运行时能力（共享数据库、上传、评论、实时消息）；可发布到自建的 Node 站点或 Cloudflare 站点 | `index.html` | — | [指南](docs/types/page.zh-CN.md) · [SKILL](artifact-types/page/SKILL.md) |

每个类型文件夹都是一个独立的 skill：`SKILL.md` 告诉 Agent 怎么写，`reference/` 说明文件格式，`artifact-type.json`
向宿主描述这个类型，`scripts/`（构建产物）里是命令行工具和编辑器。

## 快速开始

### 1. 作为 Agent 应用的插件（推荐）

安装 **Node.js 22.18+**，然后到 [GitHub Releases](https://github.com/JimLiu/open-artifact/releases) 的
**Assets** 下载 `open-artifact-plugins.zip`。解压到一个长期保留的位置，用解压出的 `open-artifact-plugins/`
目录按下表安装。包内已包含 skill、后台服务和编辑器。DeepSeek Harness 直接从 npm 安装预构建包。

| Agent 应用 | 安装方法 |
|---|---|
| [Claude Code](plugins/claude-code/README.md)（CLI、桌面版、IDE） | 把解压目录添加为插件市场，再安装 `open-artifact@open-artifact`。 |
| [Codex](plugins/codex/README.md)（CLI、应用）和 ChatGPT 桌面版 | 用 `codex plugin marketplace add` 添加解压目录，再到 Plugins 安装 **Open Artifact**。 |
| [Cursor](plugins/cursor/README.md) | 把解压出的 `cursor/` 复制到 `~/.cursor/plugins/local/open-artifact`，再运行 **Developer: Reload Window**。 |
| [GitHub Copilot](plugins/copilot/README.md) CLI | 把解压目录添加为插件市场，再安装 `open-artifact@open-artifact`。 |
| VS Code 里的 [GitHub Copilot](plugins/copilot/README.md) | 运行 **Chat: Install Plugin from Source**，选择解压出的 `copilot/`。 |
| [Antigravity](plugins/antigravity/README.md) | 用 `agy plugin install` 安装解压出的 `antigravity/`，或把目录复制到 `~/.gemini/config/plugins/open-artifact`，然后重启应用。 |
| [ZCode](plugins/zcode/README.md) | 在插件市场里把解压出的 `zcode/` 添加为插件市场，再从列表安装 **Open Artifact**。 |
| [网页版 ChatGPT](plugins/chatgpt/README.md) | 从解压出的 `chatgpt/` 运行预构建连接器，再通过 HTTPS 接入。 |
| [DeepSeek Harness](https://www.npmjs.com/package/dsh-open-artifact) | 在插件页面选择「添加插件」，输入 npm 包名 `dsh-open-artifact`。CLI 的 web profile 可用 `dsh plugin --profile web add dsh-open-artifact`。 |

升级时下载新版 ZIP，把解压目录替换到原来的路径，再按表中对应的指南刷新插件。如果原来的插件市场还指向源码仓库，
按对应指南把市场切换到解压目录。

DeepSeek Harness 有新版时，可以在 Open Artifact 页面点击「更新」。如果之前链接的是本地源码目录，先在插件页面
移除该插件，再从 npm 添加 `dsh-open-artifact`。

在新会话里试试下面的提示语。

```text
/open-artifact slides a 6-slide pitch for this repo
/open-artifact design three landing page options for a coffee shop
/open-artifact whiteboard a retro board for last sprint
/open-artifact sheets 按类别统计并汇总的月度预算表
/open-artifact data 基于 signups.csv 制作按月注册看板
/open-artifact docs 一份 2027 年的招聘计划，包括岗位、预算和时间线
/open-artifact motion a 20-second launch animation for this app
/open-artifact page a team lunch poll that remembers every vote
```

插件会添加 `Artifact`、`ArtifactData` 和 `ArtifactComments` 三个 MCP 工具、这个 skill，以及把页面评论带回会话的
hooks。每个应用怎样收到评论、各自测过什么，见 [plugins/README.md](plugins/README.md)。

如果应用能显示 [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps)，Agent 还会多一个 `ShowArtifact`
工具：它把 Artifact 的实时页面直接放进对话里，你不用离开聊天就能编辑、评论，也能全屏、在浏览器里打开，或把评论发回给
Agent。不支持 MCP Apps 的应用看不到这个工具。Codex 的卡片只显示 https 页面，所以在 Codex 里卡片会改为提供“在浏览器中打开”（Open in browser）按钮和页面地址。

### 2. 作为 skill 给其他 Agent 用

把解压目录里的 `codex/skills/open-artifact/` 复制到 Agent 的 skill 目录。它自带后台服务，Agent 可以通过命令行使用。
在解压目录中可以运行：

```bash
node codex/skills/open-artifact/scripts/open-artifact.mjs artifact '{"action":"list","scope":"types"}'
```

### 3. 单独使用某一种类型

[从源码构建](#从源码构建)后，每个类型文件夹都可以独立运行：

```bash
node artifact-types/design/scripts/cli.mjs open ./my-design --type design   # 启动本地服务并打印页面地址
node artifact-types/design/scripts/cli.mjs wait ./my-design                 # 一直等到有人点 "Send to agent"
```

其他命令：`check`、`generate`、`upload`、`context`、`comments`、`history`、`share`、`status`、`stop` 等。不带参数运行
CLI 可以看到完整列表。

## 部署到自己的服务器

站点给你的作品一个网址，你的电脑关机也能打开：别人登录后打开分享给自己的作品，一起编辑、评论，你的 Agent 把作品发布到
这里。指南在 [docs/](docs/README.zh-CN.md)：

- [把作品放到站点上](docs/hosting.zh-CN.md)：站点怎么工作、该选哪一种。从这里开始。
- [家里或办公室内网的站点](docs/hosting-lan.zh-CN.md)：不要域名，走 http。
- [带域名的自有服务器站点](docs/hosting-server.zh-CN.md)：Docker Compose 加 Caddy、登录方式、AWS。
- [Cloudflare 上的站点](docs/hosting-cloudflare.zh-CN.md)：一个 Worker，加 D1 和 Durable Objects。
- [连接你的电脑和 Agent](docs/connecting-agents.zh-CN.md)：`open-artifact remote add`、发布、自动发布新建的作品、安装时的
  预设、远程 MCP、仪表盘的数据。
- [插件](docs/plugins.zh-CN.md)：接入公司账号登录、来自你自己服务的权限、操作规则、事件通知和邀请邮件；怎么用插件，怎么写插件。

## 开发

### 从源码构建

在源码目录里安装依赖，构建工作区和插件。

```bash
npm ci
npm run build
node scripts/build-plugins.mjs
```

开发时可以用 `dist/plugins/` 代替各插件安装说明中的解压目录。

```bash
npm run typecheck
npm test             # 单元测试（node --test）
npm run e2e          # 端到端测试：用 CLI 和 Chrome 驱动构建好的类型，见 e2e/README.md
```

`crates/` 里的 Rust crate 会编译成 WebAssembly，产物已经提交在 `packages/wasm-*/generated/` 下，所以只有改了 crate
才需要 Rust 工具链：

```bash
node scripts/build-wasm.mjs   # 需要 cargo + wasm32-unknown-unknown、wasm-bindgen、wasm-opt
```

### 发布

`node scripts/build-npm.mjs` 把要发布的包整理到 `dist/npm/`：`@open-artifact/*` 库包（编译成 JavaScript，带类型声明）、
`@open-artifact/cli`（自带 daemon 的 `open-artifact` 命令）和 `dsh-open-artifact`。发布新版的步骤：

1. 改高版本号（所有包和插件清单共用一个版本号）。
2. 运行 `node scripts/changelog.mjs` 列出上一个 tag 以来的提交，据此在 [CHANGELOG.md](CHANGELOG.md) 顶部加一节
   `## [x.y.z] - 日期`，按 Added / Changed / Fixed 写清用户能感知的变化，并在文末补上对比链接。
3. 提交后推送 tag（如 `v0.9.0`）。CHANGELOG.md 里没有这个版本的条目时，[Publish to npm](.github/workflows/publish-npm.yml)
   工作流会直接停下。有对应条目时，工作流通过 trusted publishing 发布 npm 上还没有的版本，并在该 tag 的 GitHub Release
   上传 `open-artifact-plugins.zip`，用该条目作为发布说明。

在本机也可以运行 `node scripts/publish-npm.mjs` 发布 npm 包，可加 `--dry-run` 预览。
新包首次发布时，用 `node scripts/publish-npm.mjs --claim` 发布已准备好的包，并将工作流设为其 trusted publisher。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `artifact-types/` | 九种类型，各自是一个 skill：`SKILL.md`、`reference/`、`artifact-type.json`（`page` 没有自己的编辑器和 CLI）。 |
| `skills/open-artifact/` | 统一的 `/open-artifact <type>` skill；`vendor/`（构建产物）里是 daemon。 |
| `plugins/` | 为各个 Agent 应用打包的 skill，带 hooks 和 MCP 配置（[README](plugins/README.md)）。 |
| **平台** | |
| `packages/daemon` | `open-artifact` daemon：类型注册、artifact 库、Agent 工具、MCP、唤醒路由、Harness API。 |
| `packages/shell` | daemon 的页面：包住每个 artifact 的 Shell 框架，以及首页。 |
| `packages/protocol` | daemon、harness 适配器、类型服务、Shell 和页面之间共享的类型化协议。 |
| `packages/harness-kit` | Agent 应用用来连接 daemon、显示页面和接收唤醒的 SDK（[README](packages/harness-kit/README.md)）。 |
| `packages/runtime` | `window.openartifact`，页面使用的能力 API（文件、上传、用户、Agent、在线状态、下载）。 |
| `packages/type-server`、`packages/server-sdk` | 每种类型的本地服务和 `cli.mjs`；服务端共享代码。 |
| **类型** | |
| `packages/slides-core`、`slides-editor` | Slides 的数据模型（HTML 子集、`deck.json`）和编辑器。 |
| `packages/design-core`、`design-editor`、`dc` | Design 的数据模型（`canvas.json`）、编辑器，以及 `.dc.html` 画板格式。 |
| `packages/design-system-core`、`design-system-editor` | Design System 的数据模型（令牌语法、CSS 编译器）和编辑器。 |
| `packages/whiteboard-core`、`whiteboard-editor` | Whiteboard 的数据模型（schema、实时同步、几何计算）和编辑器。 |
| `packages/sheets-core`、`sheets-editor` | Sheets 的数据模型（工作簿、单元格、样式、数据表、图表）和编辑器。 |
| `packages/data-core`、`data-editor` | Data 的数据模型（数据集、查询、规则、看板页面）和编辑器。 |
| `packages/docs-core`、`docs-editor` | Docs 的数据模型（带 ID 的块与字符、ops、修订建议、Markdown）和编辑器。 |
| `packages/motion-core`、`motion-stage`、`motion-audio`、`motion-export`、`motion-editor` | Motion 的数据模型（影片文档、场景、手改记录）、沙箱舞台和它的 `kit`、配乐合成、MP4/GIF/HTML/ZIP 导出，以及播放器。 |
| **共享** | |
| `packages/live-store` | Whiteboard、Data 与 Motion 共用的实时文档同步库。 |
| `packages/ui`、`editor-kit`、`export-kit` | UI 组件库（Base UI + Tailwind）、各编辑器共用的部分（评论、历史、在线状态……）、浏览器端导出。 |
| `packages/canvas-engine`、`wasm-*`、`crates/` | WebGL2 画布引擎，以及背后的 Rust/WebAssembly crate（画布、导出、白板几何、数据规则、表格公式引擎与动效编码/频闪分析）。 |
| `examples/` | 可以运行的 Agent 应用接入示例（[README](examples/README.md)）。 |
| `e2e/` | 端到端测试。 |
| `scripts/` | `build.mjs`、`build-plugins.mjs`、`build-skill.mjs`、`build-wasm.mjs`。 |

## 许可证

[Apache License 2.0](LICENSE)。Copyright 2026 Jim Liu 宝玉，详见 [NOTICE](NOTICE)。
