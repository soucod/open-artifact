# Design（设计画布）

[English](design.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Design** 是一个由 WebGL2 驱动的无限画布，承载以本地文件保存的实时 `.dc.html` 画板（Design Components）。适合 UI 界面设计、落地页多方案对比、App 流程稿、可点击交互原型、精致图表、海报传单与印刷排版。

> **什么时候不用 Design：** 不适合按页放映的演示文稿（请用 [Slides](slides.zh-CN.md)），也不适合自由发散的便利贴白板协作（请用 [Whiteboard](whiteboard.zh-CN.md)）。

## 核心功能

- **无限多页面画布**：并排摆放多个画板，支持最多 40 个画布页面（pages），并可添加分区大标题、便签、图形、箭头和手绘标注。
- **实时 `.dc.html` 画板与可点击原型**：画板由真实的 HTML/CSS/JS 实时渲染；启用 `is_interactive: true` 后可点击 **Play** 进入可交互原型运行模式。
- **多端响应式预览与长图导出**：在 Play 模式下切换 Fill/Fit 以及手机（`390`）、平板（`768`）、`1024`、`1280`、`1440`、`1920` 等宽度，并可按所选宽度导出 1× 或 2× 完整长图 PNG。
- **直接可视化编辑**：直接在画板上改文案、移动缩放画框、调整颜色与文字样式、并排对比多套视觉方案。
- **深度集成设计系统**：安装 [Design System](design-system.zh-CN.md) 后，品牌色与文字样式会接入编辑器选择器，还可以直接挂载设计系统导出的真实组件包（`window.<Ns>`）。
- **打印与分页排版**：支持 Letter / A4 纸张及流式分页（`print: "flow"`），导出规范的多页打印 PDF。
- **丰富的导出方式**：
  - **PNG / JPEG**（单画板或按预览宽度导出的 1×/2× 整页长图）
  - **PDF**（固定画幅或自动分页打印）
  - **HTML** — 独立网页、**Figma 采集专用 HTML**（在 Chrome 打开后用 Figma 插件一键采集），或 **整画布 ZIP 包**（包含全部画板、素材、运行时、索引与 README）

## 用户怎么用

### 创建设计画布
```text
/open-artifact design 给精品咖啡烘焙品牌做三套不同风格的落地页方案
/open-artifact design 移动端注册引导流程（4 个界面），带可点击 Play 原型
/open-artifact design 用我们的品牌设计系统做一张 A4 大会海报
```

### 编辑、预览与导出
- **浏览与修改**：自由平移缩放画布、移动画板、点击文字直接改写，或在侧边栏切换画布页面。
- **运行原型**：点击工具栏 **Play** 按钮体验交互原型并切换不同屏幕宽度。
- **向 Agent 提修改意见**：在画板上锚定评论，点 **Send to agent**。
- **修复报错**：画板运行出错时，下方会出现提示条，点 **Ask agent to fix** 交给 Agent 修；右上角的 **N errors** 列出本页所有出错的画板，可以一次让 Agent 全部修好。用 **×** 关掉提示条后，画板名旁会留一个警告标记，点它就能把提示条找回来。Agent 连不上时，请求会留在这个列表里，供你复制到它的对话中。
- **直达链接**：在 URL 后附加 `#artboard-<name>`、`#play-<name>` 或 `#page-<id>` 直接定位到指定画板或页面。
- **导出**：打开 **Share → Export** 导出 PNG、JPEG、PDF、Figma 采集 HTML 或整画布 ZIP。

## Agent 怎么用

- **类型 ID**：`design`（`type_url: "open-artifact://type/design"`）
- **存储结构**：项目文件位于 `<root>/project/`：
  - `project/canvas.json` — 索引文件（`v: 3`、`createdOnFiles`、`title`、`launch`、`pages`、`boards`、`order`、`notes`、`designSystems`）。
  - `project/<path>.dc.html` — 每个画板对应一个 `.dc.html` 文件（入口通常命名为 `Main.dc.html`，画框宽高 40–8000 px）。
  - `project/ds/<folder>/` — 安装设计系统时复制的 `tokens.json`、`tokens.css`、组件包、字体与素材。
- **限制**：单个画布最多 512 个文件、总计 256 MB；`canvas.json` 小于 1 MiB。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/design/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/design", title, open: "after_first_write"}` | `open-artifact open <root> --type design --title "<标题>" --json` |
| 写入画板 | 用文件工具写 `<root>/project/canvas.json` 和 `*.dc.html`（或带 `if_match` 调用 `Artifact publish`） | 直接写入 `<root>/project/` |
| 上传素材 | `Artifact {action: "call", url, name: "upload", args: {file: "<绝对路径>"}}` | `open-artifact upload <root> <file>...` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| 查看选中项 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Agent 关键规则
1. 设计前先检查是否已有可复用的 `design-system`；如果它包含组件包（`window.<Ns>`），必须挂载其真实组件而不要手写仿制品，并将其文件复制到 `project/ds/<folder>/`。
2. 先写 `project/canvas.json` 和第一个画板并展示页面，之后按 `order` 顺序**每轮只写一个画板**，让用户清晰看到每个画板逐步落地。
3. 图片、字体等素材必须通过 `upload` 上传为 `/_blob/<id>`，禁止使用 `data:` URI 或裸文件名。
4. 完成后运行 `check` 并修复所有报错（如缺失 `support.js`、`$preview` 尺寸不匹配、无效 `/_blob/` 引用或过期的设计系统副本）。

完整 `.dc.html` 语法、布局、着色器与打印参考见 [artifact-types/design/SKILL.md](../../artifact-types/design/SKILL.md) 及 `artifact-types/design/reference/`。
