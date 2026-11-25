# Data（数据看板）

[English](data.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Data** 用于打造实时数据看板、KPI 记分卡、交互式数据可视化与滚动叙事报表。数据与页面以小型 JSON 文档（`db/`）保存，由原生 HTML、CSS、JavaScript 和 `d3` 渲染，每次打开页面都会透明地重新计算最新指标。

> **什么时候不用 Data：** 如果用户要直接编辑单元格和电子表格公式，请用 [Sheets](sheets.zh-CN.md)；如果要按页放映汇报，请用 [Slides](slides.zh-CN.md)。

## 核心功能

- **三种透明的数据源**：
  1. **实时 MCP 连接器查询（`kind: "call"`）**：直接查询本机 `~/.agents/open-artifact/connectors.json` 中配置的数据库、BI 或 SaaS 工具，按设定的新鲜度策略自动刷新数据。
  2. **附加数据文件（`kind: "file"`）**：上传 CSV、TSV、JSON 或文本文件（在空白看板上传 Excel 工作簿时，Agent 会自动将其拆解为干净的 CSV 附表）。
  3. **浏览器端实时计算与解析（`dash.calc`、`dash.loader`）**：实时清洗、关联并计算衍生指标。
- **内置 Sources 溯源面板**：侧边栏清晰展示每个数字来自哪条查询、哪个文件以及数据刷新时间，杜绝“黑盒数字”。
- **交互式筛选器与安全规则**：页面筛选参数（`{{name}}`）直接绑定查询条件，并由 Rust/WASM 规则引擎（`open-artifact-data-rules`）校验合法性。
- **手改文案、预设风格与设计系统**：支持直接在页面修改文字、切换内置视觉风格（looks），或安装 [Design System](design-system.zh-CN.md)。
- **Remix 重构与朗读**：支持将看板 Remix 改写为滚动数据故事或精简视觉短片草稿，并内置朗读（read-aloud）支持。
- **多格式导出**：在 **Share → Export** 中导出 **PDF**、独立 **HTML** 或 **JSON**，也支持整包 `.zip` 归档。

## 用户怎么用

### 创建数据看板或报告
```text
/open-artifact data 基于 ./signups.csv 制作按月注册与留存率交互看板
/open-artifact data 连接我们的 postgres MCP 数据源，做一份每周研发 KPI 实时记分卡
/open-artifact data 把 Q3 各区域营收数据做成一篇可交互的滚动数据故事
```

### 浏览、筛选与迭代
- **核对数据来源**：打开侧边 **Sources** 面板查看查询语句、附件和更新时间。
- **筛选与手改**：点击页面筛选器切换维度，直接点击文案手改，或在空白看板点 **Import a file** 上传 CSV/TSV/JSON/Excel。
- **评论与 Remix**：在具体图表或指标上留评论点 **Send to agent**，或使用 Remix 派生叙事版本。
- **导出**：打开 **Share → Export** 导出 PDF、HTML 或 JSON。

## Agent 怎么用

- **类型 ID**：`data`（`type_url: "open-artifact://type/data"`）
- **存储结构**：实时 JSON 文档库，位于 `<root>/db/`：
  - `db/dash/meta.json` — `{title, lang?}`
  - `db/dash/params.json` — 筛选器默认值
  - `db/dash/look.json` — 预设风格或已安装的设计系统
  - `db/dash/settings.json` — 数据刷新与新鲜度设置
  - `db/datasets/<id>.json` — 数据集定义（`source` 为 `call` 或 `file`，含 `title`、`description`、`langs`、`updated`、`fixed`）
  - `db/files/index.html.json`（及辅助 `files/*`）— HTML/CSS/JS + `d3` 页面源码

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/data/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/data", title, open: "after_first_write"}` | `open-artifact open <root> --type data --title "<标题>" --json` |
| 读取文档库 | `ArtifactData {action: "list" \| "get", url, ...}` | `open-artifact read-db <root> [path] [--text]` |
| 写入 / 修改 | `ArtifactData {action: "batch" \| "set" \| "update" \| "str_replace", url, ...}` | `open-artifact write-db <root> '<writes>'`（支持 `{"$file":"..."}`） |
| 上传数据文件 | `Artifact {action: "call", url, name: "upload", args: {file: "<绝对路径>"}}` | `open-artifact upload <root> <file>... [--name N]` |
| 校验 + 运行检查 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| 查看当前视角/选区 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Agent 关键规则
1. **默认只写只读查询**：仅存储只读的 MCP 连接器调用；任何会修改外部状态的调用必须先展示给用户并获得批准。绝不读取 `connectors.json` 中的 `env`/`headers`，也不要修改该文件。
2. **如实标注来源**：动态数据优先用实时查询（`kind: "call"`），静态文件用 `kind: "file"` 且必须填 `updated: {at, by}`；附加文件时提醒用户所有能打开看板的人都可读到完整文件。
3. 覆盖或删除已有文档时必须带 `if_match`，局部修改 `files/index.html` 优先使用 `str_replace`。
4. 完成后务必运行 `check`——它会同时校验文档结构以及打开页面最近一次运行上报的错误。

完整数据集规范、筛选规则、风格预设与 Remix 指南见 [artifact-types/data/SKILL.md](../../artifact-types/data/SKILL.md) 及 `artifact-types/data/reference/`。
