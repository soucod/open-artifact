# 什么是 Open Artifact？

[English](overview.md)

**Open Artifact 让任何编码 Agent 都能产出可打开、可直接编辑、可评论、可导出的活作品，而不只是静态文件或聊天框里的一长段文字。**

当你让 AI Agent 制作幻灯片、UI 设计稿、设计系统、白板、电子表格、实时数据看板、协作文档或短动画时，Agent 只需在你的电脑上写出一个普通文件夹。本地的 Open Artifact 守护进程（daemon）会在专属的网页编辑器（外层包着统一的 **Shell** 框架）中打开它：你可以直接修改文字、拖拽元素、调整公式或样式、在具体位置留下评论、查看版本历史、分享，并导出为常见格式（PDF、PPTX、XLSX、DOCX、PNG、MP4、GIF 等）。点击 **Send to agent**，你的评论就会直接回到 Agent 的当前会话，由它结合上下文继续修改。

```text
  你 ── "/open-artifact slides 为这个仓库做一个 6 页推介 PPT" ──▶ 编码 Agent（Claude Code、Codex、Cursor、Copilot……）
                                                                      │ 写入普通文件夹
                                                                      ▼
                                                      ./artifacts/my-pitch/project/deck.json + slides/*.html
                                                                      │ 由本地 Open Artifact daemon 提供服务
                                                                      ▼
  你 ◀── 查看 · 直接编辑 · 评论 · 导出 ── http://127.0.0.1:<port>/a/<id>（Shell + 专属编辑器）
   └──────────────── "Send to agent" ─────────────────────────▶ 评论直接回到 Agent 会话
```

## 为什么选择 Open Artifact？核心优势

| 核心优势 | 实际价值 |
| --- | --- |
| **直接编辑 + AI 评论闭环** | 改个标题、挪张便利贴、调个公式或文案，自己动手一秒搞定，不必每次微调都给 Agent 发提示词；需要大改时，在具体幻灯片、画板、单元格、文本或视频时间点上锚定评论，点 **Send to agent** 即可交回 Agent 处理。 |
| **开放格式、本地优先** | 每个作品都是硬盘上的普通文件夹（`project/`、`db/`、`sheet/`、`doc/`）。无厂商锁定、无需账号、不强制上传云端，离线可用，天然方便备份和 Git 管理。 |
| **不绑定任何 Agent 或模型** | 一套本地 daemon、一个 `/open-artifact` skill、标准 MCP 工具（`Artifact`、`ArtifactData`、`ArtifactComments`、`ShowArtifact`）外加命令行回退。支持 Claude Code、Codex、Cursor、GitHub Copilot、Antigravity、ZCode、DeepSeek Harness、ChatGPT 以及任意支持命令行的 Agent，模型任选。 |
| **专用编辑器 + 真正可用的导出** | 不是简陋的通用 HTML 预览框，而是针对每种场景打造的原生级体验：WebGL2 无限画布、Rust/WASM 电子表格公式引擎、全屏演讲者模式、直连 MCP 数据源的实时看板、带修订建议的文档、按时间渲染的动画引擎，支持导出 PPTX、PDF、XLSX、DOCX、PNG、MP4、GIF、HTML 等格式。 |
| **可复用的设计系统** | 在 **Design System** 作品中一次沉淀品牌色、字体、间距、实时组件预览和素材，即可安装到 **Design**、**Slides**、**Data** 和 **Motion** 中复用，保证视觉与品牌一致。 |
| **默认私密，按需自托管** | 默认仅在本机 `127.0.0.1` 运行。需要协作时可一键局域网分享，或发布到你自己的 Open Artifact [站点](hosting.zh-CN.md)（内网服务器、自有服务器 Docker + Caddy，或 Cloudflare Workers + D1 + Durable Objects），即使关机也能多人实时协作。 |
| **易于扩展** | 每种 Artifact 类型都是独立的 skill 目录（`artifact-type.json` + `SKILL.md` + `reference/` + 编辑器）；自托管站点还支持[插件机制](plugins.zh-CN.md)，可接入企业 SSO 登录、自定义权限、策略规则与事件通知。 |

## 各部分如何配合

1. **一个本地 daemon**：本机只运行一个后台 `open-artifact` 进程，负责管理作品库、按需启动各类型服务、向 Agent 应用暴露 MCP 工具，并把页面评论路由回对应的 Agent 会话。
2. **一个统一 Shell 框架**：所有作品都通过 `http://127.0.0.1:<port>/a/<id>` 打开（支持 [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) 的应用还会通过 `ShowArtifact` 直接嵌在对话里）。Shell 提供标题栏、版本历史、**Share（分享）**、**Export（导出）** 和 **Send to agent**，内部嵌入对应类型的专属编辑器。
3. **九种内置 Artifact 类型**：`slides`、`design`、`design-system`、`whiteboard`、`sheets`、`data`、`docs`、`motion`、`page`（自由 HTML 页面）。详见 [Artifact 类型总览](artifact-types.zh-CN.md)。
4. **可选的站点自托管**：通过 `open-artifact remote add` 把本机连到自己的站点，即可获得长期有效的分享链接和多人实时编辑能力。详见[把作品放到站点上](hosting.zh-CN.md)。

## 用户快速上手

1. **为你的 Agent 应用安装插件**（需要 **Node.js 22.18+**）：从 [GitHub Releases](https://github.com/JimLiu/open-artifact/releases) 下载 `open-artifact-plugins.zip`，按 [README.zh-CN.md](../README.zh-CN.md#1-作为-agent-应用的插件推荐) 中的安装表配置（DeepSeek Harness 直接从 npm 安装 `dsh-open-artifact`）。
2. **在对话中使用 `/open-artifact <type> <要做什么>`**：
   ```text
   /open-artifact slides 为这个仓库做一个 6 页推介 PPT
   /open-artifact design 给一家精品咖啡店设计 3 套落地页方案
   /open-artifact design-system 从我们的前端代码库整理一套设计系统
   /open-artifact whiteboard 上个迭代的复盘白板
   /open-artifact sheets 按类别统计并汇总的月度预算表
   /open-artifact data 基于 signups.csv 制作按月注册增长数据看板
   /open-artifact docs 一份 2027 年招聘计划，包含岗位、预算和时间线
   /open-artifact motion 为这个应用做一段 20 秒的发布宣传动画
   ```
3. **在实时页面里协同打磨**：直接手动编辑，在需要 AI 修改的地方留评论并点击 **Send to agent**，完成后点 **Share → Export** 导出交付文件。

## Agent 快速上手

如果你是负责创建或修改 Open Artifact 的 AI Agent：

- 阅读 [Agent 使用指南](agent-guide.zh-CN.md)，了解完整工具集（`Artifact`、`ArtifactData`、`ArtifactComments`、`ShowArtifact`）、命令行回退方式（`open-artifact.mjs`）、标准生命周期与安全边界。
- 阅读 [Artifact 类型总览](artifact-types.zh-CN.md)，快速判断该选哪种类型以及各类作品的数据存储方式。
- 调用 `Artifact {action: "publish", type_url: "open-artifact://type/<type>", title}` 创建作品后，务必严格遵循返回结果中的类型 `instructions`（源自 `artifact-types/<type>/SKILL.md`）。

## 下一步

- [Artifact 类型总览](artifact-types.zh-CN.md) — 对比全部 9 种类型，快速选型。
- [Agent 使用指南](agent-guide.zh-CN.md) — 面向 AI Agent 的调用流程、工具参考与协作规则。
- [把作品放到站点上](hosting.zh-CN.md) — 在内网、自有服务器或 Cloudflare 上部署协作站点。
