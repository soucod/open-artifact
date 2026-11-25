# Whiteboard（白板）

[English](whiteboard.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Whiteboard** 是一块多人共享、以小型实时同步 JSON 文档存储的无限白板，让你和 Agent 在同一块画布上并肩梳理思路。适合头脑风暴、迭代复盘、流程图、系统架构图、思维导图、用户旅程图和团队工作坊。

> **什么时候不用 Whiteboard：** 不适合像素级 UI 界面设计或印刷品（请用 [Design](design.zh-CN.md)）、分页演示文稿（请用 [Slides](slides.zh-CN.md)）或长篇文档（请用 [Docs](docs.zh-CN.md)）。

## 核心功能

- **丰富的白板元素**：便利贴、基础图形、分区框（sections）、自由文本、智能连线箭头（由 Rust/WASM 几何引擎驱动）、手绘笔迹、上传图片与 SVG、表格、投票贴纸（stickers）、倒计时器、链接卡片，以及**可运行交互网页嵌入（embeds）**（小型原型、计算器、动态图表等）。
- **多人实时协作**：分享到局域网或自托管站点后，支持实时光标、协作者头像、同步编辑和工作坊计时器。
- **懂空间的 AI 队友**：Agent 能感知你当前选中或评论锚定的区域，按逻辑排版整理杂乱内容，在已有分区上自然延伸而不是在旁边复制一份，并在放大元素时自动推开相邻项避免重叠。
- **评论与 “Send to agent”**：将评论钉在具体元素或区域上，一键发给 Agent 处理。
- **导出与归档**：在 **Share → Export** 中导出 **PNG** 图片，或用 CLI 将整个白板（文档、上传素材、评论、历史）打包为可迁移的 `.zip`。

## 用户怎么用

### 创建白板
```text
/open-artifact whiteboard 上个迭代的复盘白板，包含做得好的、痛点和改进项
/open-artifact whiteboard 事件驱动支付系统的整体架构图
/open-artifact whiteboard Q4 增长实验的思维导图
```

### 协作与导出
- **自由创作与整理**：拖拽便利贴、用分区归类、画连线和草图、用贴纸投票、打开计时器主持讨论。
- **结合上下文让 Agent 协助**：框选一组便利贴或留一条评论（如“按主题聚类并总结前三大风险”），点击 **Send to agent**。
- **导出**：打开 **Share → Export** 下载 PNG 图片。

## Agent 怎么用

- **类型 ID**：`whiteboard`（`type_url: "open-artifact://type/whiteboard"`）
- **存储结构**：实时 JSON 文档库，位于 `<root>/db/`：
  - `db/board/meta.json` — 白板标题与元素叠放顺序。
  - `db/elements/<id>.json` — 每个白板元素一个文档（便利贴、图形、分区、文本、箭头、手绘、图片、表格、贴纸、计时器、链接卡片、嵌入网页）。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/whiteboard/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/whiteboard", title, open: "after_first_write"}` | `open-artifact open <root> --type whiteboard --title "<标题>" --json` |
| 读取白板 | `ArtifactData {action: "list", url, collection: "elements"}` / `get` `board/meta` | `open-artifact read-db <root> [elements \| board/meta]` |
| 写入 / 批处理 | `ArtifactData {action: "batch", url, writes: [...]}`（`set`/`update`/`delete`） | `open-artifact write-db <root> '<writes>'`（支持 `{"$file":"..."}`） |
| 上传图片 | `Artifact {action: "publish", url, file_path, asset: true}`（或 `call` `upload`） | `open-artifact upload <root> <file>...` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| 查看视角/选中项 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Agent 关键规则
1. 用贴合主题的空间形态布局（循环用环形、跨团队流转用泳道、拆解用树状、对比用矩阵），避免千篇一律的方框网格。
2. 新建白板整体范围控制在约 `1500×750`，保证打开时缩放比例清晰可读；留足间距（相邻元素 24 px、箭头间距 64 px、带文字箭头 144 px）。
3. 尊重用户在白板上的手动修改：写前先重新读取，原地扩展而不在旁边另起一套副本，放大元素时同步平移相邻元素和附着贴纸。
4. 优先用 `ArtifactData` `batch`（单批最多 500 条写入）原子提交；在 `update` 中用 `{"__delete__": true}` 删除字段。

完整元素 schema、绘图与创意协作规范见 [artifact-types/whiteboard/SKILL.md](../../artifact-types/whiteboard/SKILL.md) 及 `artifact-types/whiteboard/reference/`。
