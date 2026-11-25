# Motion（短动画）

[English](motion.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Motion** 用于制作短动画影片——原理科普、产品宣传片、发布短片、界面演示、片头片尾与动图 GIF。每个场景都是按时间 `t` 纯函数绘制的 HTML/CSS/JavaScript 代码，以小型 JSON 文档（`db/`）保存在本地，可在网页中即时播放、手改并逐帧导出为视频。

> **什么时候不用 Motion：** 如果需要演讲者手动翻页控制节奏，请用 [Slides](slides.zh-CN.md)；如果只需要静态视觉海报或界面，请用 [Design](design.zh-CN.md)。

## 核心功能

- **按时间确定性渲染的场景**：每个场景（`modules/scene-<id>.js`）都是关于时间 `t` 的纯函数，既支持浏览器丝滑拖拽进度条，也保证逐帧导出视频完全一致。
- **先粗剪、再实时精修**：先写出粗剪（`stage: "rough"`）并立即打开播放器，让你边看分镜预览，边看 Agent 实时补齐画面、动效、配乐和精修。
- **代码合成配乐与带字幕旁白**：通过 `modules/score.js` 合成背景音乐与音效，通过 `modules/narration.js` 与音频素材加入带同步字幕的旁白，也可以直接播放视频片段自己的原声（采访、演讲），逐句配字幕，不用手动剪音频。
- **免写代码的直接手改**：在播放器里可以直接**改字（retype）**、**换色（recolor）**、**换字体（refont）**、**剪辑时长（recut）** 以及**微调单个元素样式（retouch）**。这些手改保存在独立记录中，后续 Agent 修改影片时也会尊重你的调整。
- **设计系统与真实产品素材**：支持安装 [Design System](design-system.zh-CN.md)，或上传真实的 Logo、图标、字体、产品界面截图和视频/音频片段。
- **频闪安全检测与视觉自检**：内置 Rust/WASM 频闪检测确保每秒闪烁/切换不超过 3 次；Agent 还可用无头 Chromium 运行 `stills` 截取任意时间点的静帧逐场检查画面。
- **时间点与画面位置评论**：可将评论钉在某一秒或画面中的具体坐标点，点击 **Send to agent** 交由 Agent 精准修改。
- **多格式导出**：在 **Share → Export** 中导出 **MP4**、**GIF**、**独立 HTML 播放器** 或 **源码 ZIP**。

## 用户怎么用

### 创建短动画
```text
/open-artifact motion 为我们的开源 CLI 工具做一段 20 秒的发布宣传动画
/open-artifact motion 做一段 30 秒的动画科普，讲清 DNS 解析是如何工作的
/open-artifact motion 用 Acme 设计系统做一段 10 秒循环播放的宣传 GIF
```

### 播放、手改与导出
- **观看与拖拽**：随时播放/暂停、拖拽时间轴、开关字幕与声音，从粗剪阶段即可实时观看成片进度。
- **直接手改**：点击画面文字直接改写，切换配色方案和字体，拖拽调整单个场景时长，或点选单个元素微调样式。
- **按时间点/画面位置留评论**：暂停在任意帧，在时间点或具体元素上钉一条评论（如“这里入场放慢半秒，主标题字号再大一点”），点击 **Send to agent**。
- **导出**：打开 **Share → Export** 渲染并下载 MP4、GIF、独立 HTML 播放器或源码 ZIP。

## Agent 怎么用

- **类型 ID**：`motion`（`type_url: "open-artifact://type/motion"`）
- **存储结构**：实时 JSON 文档库，位于 `<root>/db/`：
  - `db/film/meta.json` — `{"v": 1, "title", "updatedAt"}`
  - `db/film/script.json` — `{"code": "window.CUT = kit.scenes();"}`（首批次最后写入）
  - `db/modules/scenes.json.json` — 场景列表、阶段（`"rough"` → `"final"`）、画幅尺寸、帧率、配色板与字体
  - `db/modules/base.css.json`、`shared.js.json`、`scene-<id>.js.json`、`score.js.json`、`narration.js.json`
  - `db/assets/<name>.json` — 上传的图片、字体、视频/音频素材（`/_blob/<id>`）
  - **页面手改记录（Agent 只读，禁止写入）**：`retyped.json`、`recolored.json`、`refaced.json`、`fetched-fonts.json`、`recut.json`、`retouched.json`。
- **限制**：1–24 个场景；单文档不超过 200 KiB（超大模块拆分为 `<name>~1`…`~99`）；最多 500 个模块（总计 16 MiB）、96 个素材；单批最多 50 条写入 / 1 MB。

### 常用工作流与命令

| 操作 | daemon 下（MCP 工具） | 独立 CLI（`artifact-types/motion/scripts/cli.mjs`） |
| --- | --- | --- |
| 创建 | `Artifact {action: "publish", type_url: "open-artifact://type/motion", title, open: "after_first_write"}` | `open-artifact open <root> --type motion --title "<标题>" --json` |
| 读取文档库 | `ArtifactData {action: "list" \| "get", url, ...}` | `open-artifact read-db <root> [path] [--text]` |
| 写入 / 批处理 | `ArtifactData {action: "batch" \| "set" \| "update" \| "str_replace", url, ...}` | `open-artifact write-db <root> '<writes>'`（支持 `{"$file":"..."}`） |
| 上传媒体/配音 | `Artifact {action: "call", url, name: "upload", args: {file: "<绝对路径>"}}` | `open-artifact upload <root> <file>... [--name N]` |
| 校验 | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| 截帧检查（`stills`） | `Artifact {action: "call", url, name: "stills", args: ...}`（或 `snapshot`） | `open-artifact stills <root> --at <t1,t2,...> [--scale n]` |
| 标记等待用户回复 | `Artifact {action: "call", url, name: "asking"}` | `open-artifact asking <root> [--done]` |
| 查看当前时间/场景 | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Agent 关键规则
1. **粗剪即展示**：先一次写入 `film/meta`、`modules/scenes.json`（`"stage": "rough"`）、`modules/base.css` 和 `film/script` 并立即展示页面，再继续绘制世界、各场景和配乐，让用户实时看到进度。
2. **尊重用户手改**：绝不写入页面维护的 6 个手改记录文件；若影片中存在任何手改记录，编辑前务必先通读 `artifact-types/motion/reference/by-hand.md`。
3. 在影片页面已打开且你要向用户提问等待答复时，先调用 `asking`，让页面显示“Waiting for you”。
4. **安全与真实性**：单个场景不少于 1 秒，画面闪烁/切换不超过每秒 3 次，禁止虚假倒计时或外部 URL；完成后务必运行 `check` 并通过 `stills` 检查关键帧。

完整 `kit` API、粗剪/定稿指南、配乐合成、旁白与科普影片规范见 [artifact-types/motion/SKILL.md](../../artifact-types/motion/SKILL.md) 及 `artifact-types/motion/reference/`。
