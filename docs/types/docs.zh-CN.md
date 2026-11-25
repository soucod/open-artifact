# Docs（协作文档）

[English](docs.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Docs** 用于创建多标签页的富文本协作文档，底层采用带块 ID 与字符 ID 的结构化文档库（`doc/doc.json`）。适合方案、技术规格、项目计划、报告、备忘录、手册、指南、会议纪要等需要共同撰写、审阅修订建议、划词评论、分享和导出的长篇文档。

> **什么时候不用 Docs：** 看完即走的一次性回答直接留在对话即可；就地修改用户发来的 `.docx` 原文件请直接改原文件；按页演示请用 [Slides](slides.zh-CN.md)。

## 核心功能

- **多标签页与子标签页**：在一份作品内用多级标签页组织复杂方案或手册，并支持跨标签页实时链接芯片（重命名标签页时自动更新）。
- **富文本块与 Mermaid 图表**：标题、段落、无序/有序/任务清单、表格、代码块、引用、分割线、上传图片，以及实时渲染的 `mermaid` 图表。
- **行内智能芯片（Chips）**：插入日期（`YYYY-MM-DD`）、`@` 提及、标签页链接和自定义下拉状态选项（`enums`）。
- **修订建议模式（Suggestions）**：Agent 或协作者可以以“建议”形式提交修改，由你逐条接受或拒绝，并可针对某条建议直接评论讨论。
- **渐进式实时成稿（`pending` 占位块）**：Agent 先写出文档骨架与各章节 `pending` 占位块并立即打开页面，随后逐节填充，让你实时看到文档生长。
- **划词评论、表态、查找替换与分标签版本历史**：评论可精准锚定到具体字词或修订建议，支持查找替换以及每个标签页独立的版本回溯。
- **多格式导入与导出**：
  - **导入**：Markdown（`.md`）、纯文本、**Word（`.docx`）** 和 **PDF**（可新建文档，也可作为新标签页导入到已有文档）。
  - **导出**：在 **Share → Export** 或命令行导出 **Markdown**、**Word（`.docx`）**、**PDF**（Letter / A4）与 **HTML**，并支持整包 `.zip` 归档。

## 用户怎么用

### 创建或导入文档
```text
/open-artifact docs 一份 2027 年招聘计划，分岗位、预算、时间线三个标签页
/open-artifact docs 导入 ./spec.docx，并以修订建议模式优化表达清晰度
/open-artifact docs 一份认证服务迁移技术 RFC，带 Mermaid 时序图
```

### 编辑、审阅建议与导出
- **直接撰写与组织**：在编辑器中直接输入与排版，在侧边栏增删标签页/子标签页，插入日期、下拉状态或任务清单。
- **审阅修订建议**：逐条点击接受或拒绝 Agent 提出的建议，或在具体文字/建议上留评论后点 **Send to agent**。
- **导入已有文件**：让 Agent 将本地 `.md`、`.docx` 或 `.pdf` 导入为新标签页。
- **导出**：打开 **Share → Export** 下载 Markdown、Word（`.docx`）、PDF 或 HTML。

## Agent 怎么用

- **类型 ID**：`docs`（`type_url: "open-artifact://type/docs"`）
- **存储结构**：带块/字符 ID 的多标签页文档库，位于 `<root>/doc/`（`doc/doc.json`）。**严禁手动编辑 `<root>/doc/` 下的文件**，必须通过类型动作操作。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/docs/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/docs", title, open: "after_first_write"}`，再 `call` `create` | `open-artifact create <root> <birth-json>`（或 `--markdown <file>`） |
| 导入文件 | `Artifact {action: "call", url, name: "import", args: {file: "<绝对路径>", name?}}` | `open-artifact import <root> <file> [--name n]` |
| 读取大纲/正文/搜索/历史/建议 | `Artifact {action: "call", url, name: "read", args: {call: {ref, payload: {kind: "outline" \| "view" \| "search" \| "markdown" \| "history" \| "suggestions"}}}}` | `open-artifact read <root> [<tab> [--view \| --search ... \| --markdown \| --suggestions \| --history]]` |
| 修改 / 提修订建议 | `Artifact {action: "call", url, name: "update", args: {call: {ref, payload: {ops: [...], ifRev?, suggest?: true}}}}` | `open-artifact update <root> '{"tab":"<tab>","ops":[...],"suggest":true}'` |
| 批量建标签页 / 下拉列表 | `Artifact {action: "call", url, name: "batch", args: {call: ...}}` | `open-artifact batch <root> <call>` |
| 上传图片 | `Artifact {action: "call", url, name: "upload", args: {file: "<绝对路径>"}}` | `open-artifact upload <root> <file>...` |
| 导出 | `Artifact {action: "call", url, name: "export", args: {format: "md" \| "docx" \| "pdf" \| "html", tab?, paper?, out?}}` | `open-artifact export <root> --format docx\|pdf\|html [--tab t] [--paper a4\|letter] [--out file]` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |

### Agent 关键规则
1. **先骨架后填充**：先用标题与各章节 `pending` 块建好文档并立刻展示页面，再逐章 `update` 替换占位块，让用户实时看到内容生成。
2. **严禁直接写 `<root>/doc/`**（也不要用 `Artifact publish` 传 `files`）：全部通过 `create`、`read`、`update`、`batch`、`delete`、`import`、`export` 完成。
3. 更新时传入 `ifRev` 防止覆盖用户正在打字的内容；修改用户已有文稿时，除非明确要求直接改写，否则优先用 `"suggest": true` 提出建议。
4. 在 Markdown 中使用 `<?oa block KEY?>` 放置芯片，并在 `blocks` 中定义对应条目（`pending`、`date`、`mention`、`dropdown`、`paragraph`）。

完整 ops 语法、芯片规范、标签页与修订建议工作流见 [artifact-types/docs/SKILL.md](../../artifact-types/docs/SKILL.md) 及 `artifact-types/docs/reference/`。
