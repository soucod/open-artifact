# Slides（幻灯片）

[English](slides.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Slides** 用于创建可编辑的 16:9（`1920×1080`）或 4:3（`1440×1080`）演示文稿，以普通的本地 HTML/CSS/JSON 文件保存。适合融资推介、技术分享、季度汇报、培训课件等需要编排顺序、直接改字、配演讲者备注、全屏演示和导出的场景。

> **什么时候不用 Slides：** 不适合长篇阅读文档（请用 [Docs](docs.zh-CN.md)）或一次性单文件 HTML 网页。

## 核心功能

- **所见即所得编辑**：直接在页面修改文案、移动/缩放元素、调整字体和配色，并在左侧幻灯片栏或总览网格中拖拽排序。
- **章节大纲与总览**：按章节组织幻灯片，为每个章节写一句话说明，在总览视图中一目了然。
- **演讲者备注、逐项动画与转场**：每页支持独立的演讲者备注（`<aside>`）、分步出现动画（builds）和切页转场效果。
- **全屏演示模式**：直接在浏览器全屏放映，支持键盘翻页和演讲者备注视图。
- **安装设计系统**：支持安装 [Design System](design-system.zh-CN.md)，把品牌颜色、字号样式与字体文件接入编辑器的颜色/样式选择器，保持视觉统一。
- **自定义字体与多媒体**：支持 Google Fonts 或本地上传字体（`.woff2`/`.woff`/`.ttf`/`.otf`），以及上传图片与视频片段（`.mp4`/`.webm`）。
- **多边形裁剪**支持在面板和照片上使用任意多边形，坐标可采用 px、百分比或混合 `calc()`。简单面板和照片会导出为可编辑的 PowerPoint 形状与图片。
- **评论协作与历史版本**：在具体页面上锚定评论并发送给 Agent，支持随时查看和恢复历史版本。
- **多格式导出**：在 **Share → Export** 中导出 **PDF**、**PowerPoint（`.pptx`）**、独立 **HTML** 或 **PNG** 图片。

## 用户怎么用

### 创建幻灯片
```text
/open-artifact slides 为我们的开发者工具做一个 6 页投资人推介 PPT
/open-artifact slides 用 Acme 设计系统做一份 10 页的 Q3 研发复盘（4:3 比例）
```

### 编辑、演示与导出
- **直接修改**：点击文字直接改写，在左侧栏或总览中拖拽排序，在底部编辑演讲者备注。
- **全屏演示**：点击顶部工具栏的演示按钮进入全屏模式。
- **让 Agent 继续改**：在需要修改的页面留评论（如“把这张对比表精简成 3 条要点”），再点 **Send to agent**。
- **直达某页链接**：在作品链接后加 `#slide-<页码>`（如 `#slide-3`）。
- **导出交付**：打开 **Share → Export** 下载 PDF、PPTX、HTML 或 PNG。

## Agent 怎么用

- **类型 ID**：`slides`（`type_url: "open-artifact://type/slides"`）
- **存储结构**：项目文件位于 `<root>/project/`：
  - `project/deck.json` — 索引文件（`v: 5`、`createdOnFiles`、`lists: "css"`、`format: {v: 1, shared: ["project/deck.css"]}`、`title`、`order`、`cover`、`sections`、`faces`、可选 `size: "4:3"`、`designSystems`）。
  - `project/deck.css` — 全局 CSS 变量和复用布局样式（禁用 `@import`）。
  - `project/slides/<id>.html` — 每页一个文件，只包含单个 `<section id="<id>">...</section>`（演讲者备注作为最后一个 `<aside>` 子节点；不含 `<html>`/`<head>`/`<body>`）。
  - `project/ds/<folder>/` — 安装设计系统时复制过来的 `tokens.json`、字体和素材。
- **限制**：最多 500 页；单页不超过 1 MB；最多 4 个自定义字体族；单个上传媒体不超过 25 MB。

### 多边形形状与图片框

可在行内样式或共享的 `deck.css` 中为 `<div>`、`<img>` 或 `<x-shape>` 设置 `clip-path: polygon(...)`。百分比坐标可定义三角形、六边形、箭头和凹多边形。`calc(100% - 12px)` 等混合坐标可在框尺寸变化时保持距边缘的固定距离。将照片的裁剪路径设在 `<img>` 上，导出到 PowerPoint 时可编辑裁剪和自定义轮廓。含子元素的裁剪容器，以及同时带边框、阴影、滤镜或圆角的裁剪，导出到 PowerPoint 时会变成图片。只支持 `polygon()`：圆角或圆形的框请用 `border-radius`。行内 `style` 属性不支持 `var()`，要直接写 px 值。[多边形裁剪参考](../../artifact-types/slides/reference/images.md#polygon-clipping)

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/slides/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/slides", title, open: "after_first_write"}` | `open-artifact open <root> --type slides --title "<标题>" --json` |
| 写入内容 | 用文件工具写入 `<root>/project/deck.json`、`deck.css` 和 `slides/*.html`（或带 `if_match` 调用 `Artifact publish`） | 直接写入 `<root>/project/` |
| 上传图片/字体 | `Artifact {action: "call", url, name: "upload", args: {file: "<绝对路径>"}}` | `open-artifact upload <root> <file>...` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| 查看选中项 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Agent 关键规则
1. 选色和选字体前先检查是否存在可复用的 `design-system`；若安装，需把 `tokens.json` 与用到的字体/素材复制到 `project/ds/<folder>/` 并在 `project/deck.css` 中声明变量。
2. 先写 `project/deck.json`、`project/deck.css` 和封面页，再分批写入其余页面（每轮最多并行写 3 页），方便用户实时看到页面陆续生成。
3. 禁止在幻灯片中引用外部 `http(s)` 图片链接或 `data:` URI，媒体和字体必须通过 `upload` 上传后引用 `/_blob/<id>`（或 `project/ds/<folder>/...`）。
4. 写完务必运行 `check`，修复所有错误、警告、布局提示和被丢弃的样式。

完整规范与排版指南见 [artifact-types/slides/SKILL.md](../../artifact-types/slides/SKILL.md) 及 `artifact-types/slides/reference/`。
