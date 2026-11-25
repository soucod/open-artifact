# Design System（设计系统）

[English](design-system.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Design System** 将品牌规范、前端代码库、设计稿或品牌素材整理成一套结构化、可浏览、可编辑的本地**品牌手册**，同时作为唯一事实来源，供 **Design**、**Slides**、**Data** 和 **Motion** 作品直接安装复用。

> **什么时候不用 Design System：** 不适合做一次性页面草图或自由排版的 HTML 样式指南（请用 [Design](design.zh-CN.md)）。

## 核心功能

- **多主题设计令牌（Tokens）与对比度检查**：在 `project/tokens.json` 中统一管理 `color`（支持 Light/Dark 等多主题并自动检查 WCAG 对比度）、`type`（字体文件、字体栈、文字样式分组）、`spacing`、`radius`、`shadow` 以及自定义令牌族（`opacity`、`zIndex`、`motion` 等）。
- **活的品牌手册**：支持 `project/README.md` 与最多 24 篇额外 Markdown 规范章节，顶部配有可视化封面（`components/Cover/preview.html`）。
- **实时组件预览与 Props 文档**：通过 `components/<Comp>/preview.html`、组件指南 `README.md` 和 TypeScript 类型文件 `<Comp>.d.ts` 展示真实可交互组件及属性表，底层加载本地组件包（`components/bundle.js` + `bundle.css`）。
- **品牌素材库分组管理**：在 `project/assets/<Group>/` 下按组整理 Logo、图标、插图、视频和 PDF，支持自定义网格平铺大小（`xl` 到 `xs`）。
- **自动生成派生文件**：每次保存（或运行 `open-artifact generate`）都会自动根据 `tokens.json` 重新生成 `tokens.css`、`manifest.json`、`api/` 卡片和 README 使用说明块，保持单一事实来源。
- **从真实来源提取**：支持直接从前端代码仓库、设计工具导出文件或品牌资产目录提取精确令牌、字体和组件，也可从零快速起步。
- **跨作品安装复用**：其他作品（`design`、`slides`、`data`、`motion`）安装该设计系统后，编辑器的颜色/文字选择器、字体与组件都会与品牌保持同步。

## 用户怎么用

### 创建设计系统
```text
/open-artifact design-system 从 ./src 提取我们的品牌令牌、字体和 React 组件库
/open-artifact design-system 基于这些 Logo 和视觉规范为 Acme 创建一套品牌手册
```

### 浏览、编辑与跨作品复用
- **实时调整令牌**：在页面中直接修改颜色（支持 hex/oklch 等）、查看明暗主题对比度、调整字号和间距，或拖入新的品牌素材。
- **在其他作品中复用**：创建幻灯片、界面设计、数据看板或动画时，只需告诉 Agent“使用我们的 Acme 设计系统”。
- **与代码同步**：若系统标记为代码同步模式（`"editing": "code"`），请修改源代码后让 Agent 重新同步。
- **评论迭代**：在令牌、组件或规范段落上留评论并点击 **Send to agent**。

## Agent 怎么用

- **类型 ID**：`design-system`（`type_url: "open-artifact://type/design-system"`）
- **存储结构**：项目文件位于 `<root>/project/`：
  - `project/design-system.json` — 索引文件（`v: 3`、`layout: "files"`、`createdOnFiles`、`title`、`namespace`、`libraries`、`groups`、`assetGroups`、`lastChange`）。**务必最后再写此文件。**
  - `project/tokens.json` — 列表结构的令牌文件（每个族为 `{"tokens": [{"name","value","usage"}]}`，`type` 使用 `fonts`/`families`/`groups`）。*注意：若输入是 W3C DTCG 键值映射格式，必须先转换为列表结构。*
  - `project/README.md`（及可选 `*.md` 章节）— 品牌手册；不要改动 `<!-- open-artifact:usage -->` 自动生成块内部。
  - `project/components/<Comp>/` — `preview.html`、`README.md`、`<Comp>.d.ts`，以及 `components/bundle.js`、`bundle.css`、`index.d.ts`、`lib/*.js` 和 `components/Cover/preview.html`。
  - `project/assets/<Group>/<file>` 与 `project/fonts/<file>` — 优先保存为真实文件而非上传项，便于其他作品安装时完整复制。
  - **自动生成文件（禁止手写）**：`tokens.css`、`manifest.json`、`api/*`。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/design-system/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/design-system", title, open: "after_first_write"}` | `open-artifact open <root> --type design-system --title "<名称>" --json` |
| 生成派生文件 | `Artifact {action: "call", url, name: "generate"}` | `open-artifact generate <root>` |
| 上传素材到分组 | `Artifact {action: "call", url, name: "upload", args: {file, group}}` | `open-artifact upload <root> <file> --group <Group>` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |

### Agent 关键规则
1. 修改时**只在最后写一次 `project/design-system.json`**，且写入前先重新读取最新版本，避免覆盖用户在页面中新增的改动或素材，并同步更新 `lastChange`。
2. 切勿手写 `tokens.css`、`manifest.json`、`api/*` 等派生文件，交由打开的页面或 `generate` 自动生成。
3. `tokens.json` 中避免使用 `var()`、`calc()`、`color-mix()` 或命名色（如 `red`、`transparent`），否则会被解析器丢弃；务必运行 `check` 检查是否有令牌被丢弃。
4. 从代码库或设计工具导入前，先阅读 `artifact-types/design-system/reference/from-code.md` 或 `from-design-tool.md`。

完整格式、封面与组件打包规范见 [artifact-types/design-system/SKILL.md](../../artifact-types/design-system/SKILL.md) 及 `artifact-types/design-system/reference/`。
