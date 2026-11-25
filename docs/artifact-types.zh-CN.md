# Artifact 类型总览

[English](artifact-types.md)

Open Artifact 内置了 **9 种 Artifact 类型**。每种类型都包含一套清晰的本地文件格式、一个专属交互式网页编辑器、锚定评论、版本历史、导出能力，以及一份独立的 skill（`artifact-types/<type>/SKILL.md`），让任何 AI Agent 都能按规范创建和修改它。唯一的例外是 `page`：Agent 整张写好的自由 HTML 页面，没有自己的编辑器和导出。

## 9 种内置类型一览

| 类型 ID | 详细指南 | 适用场景 | 存储方式与标识文件 | 支持导入 | 支持导出 | 支持设计系统 |
| --- | --- | --- | --- | --- | --- | --- |
| `slides` | [Slides 幻灯片](types/slides.zh-CN.md) | 演示文稿、融资推介、分享讲稿、汇报 PPT | 项目文件（`project/deck.json`） | 图片、视频、字体 | PDF、PPTX、HTML、PNG | 支持 |
| `design` | [Design 设计画布](types/design.zh-CN.md) | UI 界面、落地页、App 原型、可点击交互原型、海报、印刷品 | 项目文件（`project/canvas.json`） | 图片、字体、CSS/JS | PNG、JPEG、PDF、HTML（含 Figma 采集页、整画布 ZIP） | 支持 |
| `design-system` | [Design System 设计系统](types/design-system.zh-CN.md) | 品牌手册、设计令牌（tokens）、字体规范、实时组件预览、品牌素材库 | 项目文件（`project/design-system.json`） | 代码仓库、设计稿文件、品牌素材 | 供其他类型安装复用（自动生成 `tokens.css`、`manifest.json`、`api/`） | —（作为来源） |
| `whiteboard` | [Whiteboard 白板](types/whiteboard.zh-CN.md) | 头脑风暴、复盘、流程图、架构图、思维导图、工作坊 | 实时文档库（`db/board/meta.json`） | 图片、SVG、交互网页嵌入 | PNG（及 `.zip` 归档） | 否 |
| `sheets` | [Sheets 电子表格](types/sheets.zh-CN.md) | 预算表、进度追踪、排期表、记录清单、带公式的财务模型 | 工作簿操作日志（`sheet/sheet.json`） | CSV | XLSX、CSV（及 `.zip` 归档） | 否 |
| `data` | [Data 数据看板](types/data.zh-CN.md) | 实时看板、KPI 记分卡、交互图表、周期报表、滚动叙事报告 | 实时文档库（`db/dash/meta.json`） | CSV、TSV、JSON、文本、Excel（经 Agent 转换）、实时 MCP 连接器 | PDF、HTML、JSON（及 `.zip` 归档） | 支持 |
| `docs` | [Docs 协作文档](types/docs.zh-CN.md) | 方案、规格说明、计划书、报告、手册、备忘录、会议纪要 | 多标签页块/字符库（`doc/doc.json`） | Markdown、纯文本、Word（`.docx`）、PDF | Markdown、Word（`.docx`）、PDF、HTML（及 `.zip` 归档） | 否 |
| `motion` | [Motion 短动画](types/motion.zh-CN.md) | 产品宣传片、原理科普动画、发布短片、功能演示、片头片尾、动图 GIF | 实时文档库（`db/film/meta.json`） | 图片、字体、视频/音频素材 | MP4、GIF、独立 HTML 播放器、源码 ZIP | 支持 |
| `page` | [Page 自由页面](types/page.zh-CN.md) | 其他类型都不合适的小型交互页面：小部件、小工具、计算器、小游戏、解释页、投票和清单 | 文件夹本身（`index.html`，能力声明在 `.artifact.json`） | 页面要加载的任意文件 | —（可发布到 Node 或 Cloudflare 站点） | 否 |

## 应该选哪种类型？

无论是用户还是 Agent，都可以用以下原则快速选型：

- **Slides 还是 Docs？** 需要按页展示（16:9 或 4:3）、配合演讲者备注和逐项动画做汇报时选 **`slides`**；需要长文阅读、多标签页方案/规格、修订建议或导出 Word/Markdown 时选 **`docs`**。
- **Design 还是 Whiteboard？** 关注视觉质感、像素级 UI 排版、字体细节、可点击高保真原型或海报打印时选 **`design`**；需要空间化发散讨论、贴便利贴、画流程图/架构草图、多人自由协作时选 **`whiteboard`**。
- **Data 还是 Sheets？** 需要管理层看板、定制 d3 可视化、滚动叙事报告，或直连 MCP 数据源自动刷新数据时选 **`data`**；需要单元格网格、电子表格公式、带筛选的数据表、下拉菜单或交付 Excel（`.xlsx`）时选 **`sheets`**。
- **Motion 还是 Slides？** 核心是时间轴动效、节奏编排、配乐/旁白以及导出 MP4 或 GIF 时选 **`motion`**；需要演讲者手动翻页控制节奏时选 **`slides`**。
- **最后才选 Page**：只有上面的类型都不合适时才选 **`page`**：Agent 写成一张 HTML 页面的小型交互内容（小工具、计算器、小游戏、解释页），按声明开放运行时能力。
- **先建 Design System**：如果已有品牌规范、前端组件库，或要持续产出多份同一品牌的视觉作品，建议先做一份 **`design-system`**，之后 **`design`**、**`slides`**、**`data`** 和 **`motion`** 都能一键安装并复用同一套配色、字体和组件。

> **给 Agent 的提示：** 如果用户没有在 `/open-artifact` 后指定类型 ID，调用 `Artifact {action: "quickstart", intent: "<用户意图>"}`，daemon 会推荐最匹配的已安装类型，并在 `related` 中列出可复用的现有作品（例如已有的 `design-system`）。

## 数据存储模型（面向 Agent 与开发者）

Open Artifact 内部有三种存储模式，外加自由页面，了解它们就能立刻知道 Agent 该如何读写对应类型：

1. **项目文件型（`slides`、`design`、`design-system`）**
   - 内容以易读文件存放在 `<root>/project/` 下（索引 JSON + HTML/CSS/Markdown/tokens）。
   - Agent 直接使用常规文件工具写入 `<root>/project/`（或调用 `Artifact {action: "publish", url, files}`），并用 `Artifact {action: "call", url, name: "check"}` 校验。
2. **实时 JSON 文档库型（`whiteboard`、`data`、`motion`）**
   - 内容以小型 JSON 文档存放在 `<root>/db/<collection>/<id>.json`，通过 `@open-artifact/live-store` 实时同步。
   - 在宿主下使用 `ArtifactData`（`get`、`list`、`query`、`set`、`update`、`delete`、`str_replace`、`batch`），独立模式下使用 `open-artifact read-db` / `write-db`。
3. **结构化操作日志/节点库型（`sheets`、`docs`）**
   - 内容以结构化修订和操作流存储（Sheets 为 `sheet/edits.jsonl`；Docs 为带块/字符 ID 的标签页树）。
   - Agent 绝不直接手改底层 JSON，而是通过 `Artifact {action: "call", url, name: "read" | "update" | "batch" | ...}`（或独立 CLI 的 `read` / `update` / `batch`）操作。
4. **自由页面（`page`）**
   - 就是文件夹本身：`<root>/index.html` 是 Agent 整张写好的页面，旁边放它要用的文件。它没有自己的编辑器，数据通过声明的运行时能力保存（`db/`、`_blobs/`、`comments.json`）。
   - Agent 用文件工具（或 `Artifact {action: "publish", url, files}`）写 `index.html`，用 `publish` 的 `capabilities` 参数声明能力。

所有类型共用 `<root>/_blobs/`（通过 `upload` 写入的内容寻址附件）、`<root>/comments.json` 和 `<root>/history/`。

## 跨类型协同工作流

- **Design System → Design / Slides / Data / Motion**：一次建好品牌设计系统（`design-system`），之后做界面设计、演示文稿、数据看板或宣传动画时，只要告诉 Agent“用我们的 XX 设计系统”，Agent 就会自动安装它的 tokens、字体和（针对 Design 的）实时组件包，编辑器里的配色与字体选择器也会同步展示品牌规范。
- **自己做的类型**：因为每个类型都是包含 `artifact-type.json` 的独立文件夹，你也可以自己做：`open-artifact types new <id>`（或主页类型标签页里的 **新建类型**）生成一个拿来就能用的类型，`open-artifact types from <page 作品 | 保存下来的页面>` 把页面（或从 claude.ai 保存下来的页面）变成类型，`open-artifact types check` 指出哪里有问题。项目里的类型在信任项目之前是受限的（和安装的类型一样）；任何类型都可以停用。`open-artifact types publish <id>` 把自己做的类型放到 Node 网站上，这样它的作品也能发布到那里。详见 [自己做作品类型](custom-types.zh-CN.md)。Agent 可通过 `Artifact {action: "list", scope: "types"}` 动态发现全部可用类型。

## 各类型详细指南

- [Slides（幻灯片）](types/slides.zh-CN.md) — 16:9 / 4:3 演示文稿、演讲者备注、逐项动画、全屏演示、面板和照片的多边形裁剪、导出 PDF/PPTX
- [Design（设计画布）](types/design.zh-CN.md) — 由实时 `.dc.html` 画板组成的无限画布、可点击原型、响应式与打印导出
- [Design System（设计系统）](types/design-system.zh-CN.md) — 品牌手册、多主题令牌与对比度检查、实时组件预览、素材分组
- [Whiteboard（白板）](types/whiteboard.zh-CN.md) — 多人共享无限白板、便利贴、图形、智能箭头、手绘、表格、交互网页嵌入
- [Sheets（电子表格）](types/sheets.zh-CN.md) — 多工作表表格、Rust/WASM 公式引擎、筛选表、图表、交互控制面板、XLSX/CSV
- [Data（数据看板）](types/data.zh-CN.md) — 连接 MCP 数据源/本地文件/实时计算的交互看板、Sources 溯源与 Remix 重构
- [Docs（协作文档）](types/docs.zh-CN.md) — 多标签页活文档、智能芯片、修订建议、Mermaid 图表、Word/PDF 导入导出
- [Motion（短动画）](types/motion.zh-CN.md) — 按时间渲染的 HTML/CSS/JS 动画短片、合成配乐、旁白字幕、手动微调、MP4/GIF 导出
- [Page（自由页面）](types/page.zh-CN.md) — Agent 自己写的 HTML 页面，按声明开放运行时能力（数据库、上传、评论、实时消息）
