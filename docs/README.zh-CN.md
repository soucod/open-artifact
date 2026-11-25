# Open Artifact 文档中心

[English](README.md)

这里的文档同时面向**用户**（快速上手、功能说明、使用示例）和 **AI Agent**（确切工具、命令行、选型规则与安全边界）。

## 入门与核心概念

| 文档 | 什么时候看 |
| --- | --- |
| [什么是 Open Artifact？](overview.zh-CN.md) | 想快速了解 Open Artifact 是什么、有什么核心优势、本地 daemon/Shell/Agent 如何闭环协作，以及如何上手。 |
| [Artifact 类型总览](artifact-types.zh-CN.md) | 想对比全部 9 种内置 Artifact 类型、判断某个需求该选哪种类型，或了解各种存储模型。 |
| [Agent 使用指南](agent-guide.zh-CN.md) | 你是 AI Agent（或正在为 Agent 配置工作流），需要快速掌握 MCP 工具、CLI 回退、创建流程、评论处理与安全规则。 |
| [自己做作品类型](custom-types.zh-CN.md) | 想把反复要做的一种页面做成自己的类型：新建、检查、试用，把页面变成类型，停用类型，信任项目里的类型。 |

## 各 Artifact 类型详细指南

每种内置类型的功能拆解、用户用法与 Agent 用法：

| 类型 | 详细指南 | 适用场景 | 导出格式 |
| --- | --- | --- | --- |
| `slides` | [Slides（幻灯片）](types/slides.zh-CN.md) | 16:9 / 4:3 演示文稿、演讲者备注、逐项动画、全屏演示 | PDF、PPTX、HTML、PNG |
| `design` | [Design（设计画布）](types/design.zh-CN.md) | 实时 `.dc.html` 画板组成的无限画布、可点击原型、海报印刷 | PNG、JPEG、PDF、HTML（含 Figma、ZIP） |
| `design-system` | [Design System（设计系统）](types/design-system.zh-CN.md) | 品牌手册、多主题令牌、实时组件预览、素材分组 | 供 Design、Slides、Data、Motion 安装复用 |
| `whiteboard` | [Whiteboard（白板）](types/whiteboard.zh-CN.md) | 多人共享无限白板：便利贴、图形、智能箭头、手绘、表格、交互网页嵌入 | PNG |
| `sheets` | [Sheets（电子表格）](types/sheets.zh-CN.md) | 多工作表表格、Rust/WASM 公式引擎、筛选表、图表、交互控制面板 | XLSX、CSV |
| `data` | [Data（数据看板）](types/data.zh-CN.md) | 直连 MCP 数据源、本地 CSV/JSON 或实时计算的交互看板与报表 | PDF、HTML、JSON |
| `docs` | [Docs（协作文档）](types/docs.zh-CN.md) | 多标签页活文档、智能芯片、修订建议、Mermaid 图表 | Markdown、Word（`.docx`）、PDF、HTML |
| `motion` | [Motion（短动画）](types/motion.zh-CN.md) | 按时间 `t` 绘制的短动画、合成配乐、旁白字幕、手改微调 | MP4、GIF、独立 HTML 播放器、ZIP |
| `page` | [Page（自由页面）](types/page.zh-CN.md) | Agent 自己写的 HTML 页面，按声明开放运行时能力 | — |

## 自托管站点与扩展

讲怎么把作品放到**站点**上（站点是一台服务器，给作品一个网址，你的电脑关机也能打开），以及怎么把电脑和 Agent 连到站点：

| 指南 | 什么时候看 |
| --- | --- |
| [把作品放到站点上](hosting.zh-CN.md) | 想先弄清站点怎么工作、该选哪一种。从这里开始。 |
| [家里或办公室内网的站点](hosting-lan.zh-CN.md) | 大家都在同一个网络里；不要域名，走 http。含 systemd、launchd 和 Docker 的配置。 |
| [带域名的自有服务器站点](hosting-server.zh-CN.md) | VPS 或 EC2，用 Docker Compose 加 Caddy；登录方式、AWS CloudFormation、备份。 |
| [Cloudflare 上的站点](hosting-cloudflare.zh-CN.md) | 不想自己维护服务器：一个 Worker，加 D1 和 Durable Objects。 |
| [连接你的电脑和 Agent](connecting-agents.zh-CN.md) | 连接电脑、发布、自动发布新建的作品、各个 Agent 应用的预设、远程 MCP、仪表盘的数据。 |
| [插件](plugins.zh-CN.md) | 想让大家用公司账号登录，权限来自你自己的服务或一张表，按规定拒绝某些操作，或者让别的系统知道发生了什么。在 Node 和 Cloudflare 上使用插件、五个实际演练的例子，以及怎么写插件。 |

每篇部署指南同时写给人和替人操作的 Agent：步骤均有编号，给出确切命令、预期输出、检查方法和排错提示，并在开头列出 Agent 必须先问人、不能自行猜测的问题。

## 把 Open Artifact 接入 Agent 产品

写给发布 Agent 应用（桌面应用、IDE 扩展、命令行 Agent、带本地助手的网页应用）的工程师：让应用里的 Agent 能做作品，作品页面显示在应用里，人在页面上写的评论能回到 Agent：

| 指南 | 什么时候看 |
| --- | --- |
| [接入 Open Artifact](integrating.zh-CN.md) | 从这里开始：从一个 skill 文件到在你的界面里显示页面的各个层级，附示例代码和上线前检查清单。 |
| [Agent 工具](integrating/tools.zh-CN.md) | 调用方、用于审批提示的操作类别、哪些数据会离开电脑、会话权限、归属。 |
| [唤醒](integrating/wake.zh-CN.md) | 评论和页面请求怎么到达正确的会话；所有者与协作者的区别。 |
| [在你的界面里显示页面](integrating/embedding.zh-CN.md) | 框架与顶层视图、允许的源、Shell 的请求、缩略图。 |
| [远程类型](integrating/remote-types.zh-CN.md) | 页面在另一台电脑上的类型。 |
| [运行时与更新](integrating/runtime.zh-CN.md) | 随应用附带运行时、哪一份会启动、更新策略。 |
| [非 JavaScript 应用](integrating/non-node.zh-CN.md) | stdio 桥，附 Python 示例。 |
| [安全](integrating/security.zh-CN.md)、[测试](integrating/testing.zh-CN.md)、[已知限制](integrating/limits.zh-CN.md) | 信任边界、假 daemon 与 `doctor`、目前还不能用的部分。 |
| [Harness API](spec/harness-api.zh-CN.md)、[Embed](spec/embed.zh-CN.md)、[Profile](spec/profile.zh-CN.md) 参考 | 每个方法、消息和字段。 |

可运行的代码：[examples/](../examples/README.md)。

## 给运维与贡献者的更多参考（英文）

- [AGENTS.md](../AGENTS.md) 与 `docs/references/` — 编码 Agent 指南、系统架构、构建测试发布流程与文档同步规则。
- [plugins/README.md](../plugins/README.md) — 各 Agent 应用插件机制、Hooks 与 MCP 配置。
- [packages/host/README.md](../packages/host/README.md) — Node 站点的全部设置。
- [deploy/cloudflare/README.md](../deploy/cloudflare/README.md) — Cloudflare Worker 的内部结构、限制与费用。
- [deploy/aws/README.md](../deploy/aws/README.md) — AWS 部署说明。
