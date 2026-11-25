# Sheets（电子表格）

[English](sheets.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Sheets** 是一款内置 Rust/WASM 公式引擎的多工作表共享电子表格，底层以操作日志（`sheet/edits.jsonl`）保存在本地文件夹中。适合预算表、项目追踪表、排期表、台账清单以及你和 Agent 共同维护的财务模型。

> **什么时候不用 Sheets：** 如果用户只要一个静态 `.csv`/`.xlsx` 文件，直接生成文件即可；如果要做管理层看板、定制 d3 可视化或直连 MCP 数据源的报表，请用 [Data](data.zh-CN.md)。

## 核心功能

- **完整 Rust/WASM 公式引擎**：支持多工作表实时重算，自动适配区域数字与日期格式。
- **丰富的表格格式与布局**：数字/货币/百分比/日期格式、字体、填充色、边框、合并单元格、自带列筛选按钮的自动美化数据表、冻结行列以及行列分组折叠。
- **数据校验与条件格式**：支持下拉菜单验证、复选框以及条件格式高亮规则。
- **图表与交互控制面板**：直接基于单元格区域绘制图表；还可在独立标签页构建**交互面板**（滑块、按钮、输入框），实时驱动数据页里的假设单元格和公式。
- **多人协作与双层历史**：支持实时光标、单元格/区域锚定评论、整体版本历史以及单单元格修改历史。
- **导入与导出**：支持导入 **CSV**；在 **Share → Export** 或命令行中导出 **Excel（`.xlsx`）** 或单工作表 **CSV**，并支持整包 `.zip` 归档。

## 用户怎么用

### 创建电子表格
```text
/open-artifact sheets 按类别统计预算、实际支出与差额的月度家庭预算表
/open-artifact sheets 带定价与流失率滑块的 SaaS 12 个月财务预测模型
/open-artifact sheets 带状态下拉菜单、复选框和条件格式的招聘进度追踪表
```

### 编辑、分析与导出
- **直接编辑单元格**：像常规表格一样输入数值和公式（`=SUM(...)`、`=IF(...)` 等）、使用表头筛选、增删工作表或调整格式。
- **选中单元格留评论**：框选单元格或区域（如 `B4:C6`），留评论（如“加一列同比增长率并画成柱状图”），点击 **Send to agent**。
- **追溯改动**：随时打开版本历史或单元格历史查看数值演进。
- **导出**：打开 **Share → Export** 导出 Excel（`.xlsx`）工作簿或单表 CSV。

## Agent 怎么用

- **类型 ID**：`sheets`（`type_url: "open-artifact://type/sheets"`）
- **存储结构**：结构化操作日志，位于 `<root>/sheet/`（`sheet/sheet.json` + `sheet/edits.jsonl`）。**严禁直接手改底层文件**，必须通过 `read`、`update`、`batch`、`widget` 动作读写。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/sheets/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/sheets", title, open: "after_first_write"}` | `open-artifact open <root> --type sheets --title "<标题>" --json` |
| 读取工作表/单元格 | `Artifact {action: "call", url, name: "read", args: {payload: {kind: "readSheets" \| "readCells" \| ...}}}` | `open-artifact read <root> '<payload>'` |
| 写入编辑 | `Artifact {action: "call", url, name: "update", args: {payload: {kind: "applyEdits", base: <rev>, edits: [...]}}}` | `open-artifact update <root> '<payload>'` |
| 添加图表/交互面板 | `Artifact {action: "call", url, name: "batch", args: {calls: [...]}}` | `open-artifact batch <root> <file>` |
| 查看当前选区 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root> [--json]` |
| 导出 XLSX / CSV | `Artifact {action: "call", url, name: "export", args: {file?: "<绝对路径>"}}` | `open-artifact export <root> [file.xlsx \| --csv --sheet <名称>]` |

### Agent 关键规则
1. 首次操作前先阅读 `artifact-types/sheets/reference/core.md`（建表看 `building.md`，图表和交互面板看 `charts.md` / `interactives.md`）。
2. `writeCells` 不可撤销且会覆盖整块区域，写入前务必先读取单元格；始终传入最新版本号 `base`（空目录首次写入可传 `0`），遇版本冲突时先 `readSheets` 重读再合并重试。
3. 窄窗默认约显示 6 列，把最重要的列排在最前面；汇总区与参数输入放在表格上方并空一行，冻结到表头行。
4. 需要滑块/按钮实时调参的看板，将交互面板建在独立标签页，由其驱动旁边数据页里的公式。

完整编辑操作、公式函数、图表与交互面板参考见 [artifact-types/sheets/SKILL.md](../../artifact-types/sheets/SKILL.md) 及 `artifact-types/sheets/reference/`。
