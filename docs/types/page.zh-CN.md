# Page（自由页面）

[English](page.md) · [所有 Artifact 类型](../artifact-types.zh-CN.md)

**Page** 是一张自由的 HTML 页面：Agent 自己写的一份完整文档，存成 Artifact 文件夹里的 `index.html`，它要加载的文件放在旁边。打开后是一张可以直接使用、也可以评论的本地实时页面。适合其他类型都不合适的小型交互内容：小部件或小工具、计算器、小游戏、解释页，以及能记住大家操作的投票、清单或报名表。

> **什么时候不用 Page：** 演示文稿用 [Slides](slides.zh-CN.md)，需要反复打磨的 UI 设计或落地页用 [Design](design.zh-CN.md)，基于数据的看板用 [Data](data.zh-CN.md)，文档用 [Docs](docs.zh-CN.md)，电子表格用 [Sheets](sheets.zh-CN.md)，动画短片用 [Motion](motion.zh-CN.md)。

## 核心功能

- **整张页面由你决定**：没有模板、框架或构建步骤。页面的 `<title>` 就是 Artifact 的标题。
- **按声明开放运行时能力**：页面通过 `window.openArtifact.use("db")`（`window.claude` 是同一个对象，为 claude.ai 写的页面可以照常运行）取得小型共享数据库、文件上传、给访问者保存的文件、当前访问者、打开页面之间的实时消息和评论。只开放 Agent 声明过的能力。
- **实时**：`index.html` 或能力声明变化时，所有打开的视图都会重新加载；数据库写入会立即出现在每个视图里。
- **评论**：声明了 `comments` 后，评论线程保存在页面旁边，由 Agent 回复。
- **也能放到站点上**：发布到站点（自建 Node 站点或 Cloudflare）的页面，对分享到的每个人都能运行，每人各有一个自己的页面主机；数据库、评论和上传的文件与这台电脑双向同步。

## 使用方法（用户）

```text
/open-artifact page 一个做菜用的计量单位换算器
/open-artifact page 一个能记住每个人选择的团队午餐投票
/open-artifact page 一个用 emoji 卡片的翻牌记忆小游戏
```

也可以直接用自然语言（"做个小工具""做个小游戏"）：不写类型词时，如果其他类型都不合适，Agent 的 quickstart 会推荐 `page`。

## 使用方法（Agent）

- **类型 ID**：`page`（`type_url: "open-artifact://type/page"`）
- **存储方式**：文件夹本身。`<root>/index.html` 是页面，旁边的其他文件按相对地址提供。`<root>/db/` 是数据库（每个文档一个 JSON 文件），`<root>/_blobs/` 是上传的文件，`<root>/comments.json` 是评论。声明的能力保存在 Artifact 记录和 `<root>/.artifact.json` 里。
- **运行方式**：由 `frame-host` 以页面模式提供，每个 Artifact 有自己的源（`<id>.frame.localhost`）。类型文件夹里没有 `index.html`，清单中写的是 `openArtifact.style: "page"`。

### 工作流与命令

| 任务 | 守护进程下（MCP 工具） |
| --- | --- |
| 创建并声明能力 | `Artifact {action: "publish", type_url: "open-artifact://type/page", title, capabilities: {"db": true}, open: "after_first_write"}` |
| 写页面 | 用文件工具写入 `root`，或 `Artifact {action: "publish", url, files: {"index.html": "…"}}` |
| 修改能力声明 | `Artifact {action: "publish", url, capabilities: {…}}`（可以不带 files） |
| 读写数据库 | `ArtifactData {action: "list" \| "get" \| "set" \| "batch", url, …}` |
| 看一眼页面 | `Artifact {action: "call", url, name: "snapshot", args: {width?, height?, scheme?}}` |
| 回复评论 | `ArtifactComments` |

Page 没有独立的类型 CLI：页面需要守护进程来提供。

### `capabilities` 参数

| 传入 | 含义 |
| --- | --- |
| 不传 | 保留当前声明。 |
| `{}` | 不声明任何能力：只剩 `artifact` 和 `permissions`。 |
| `{"db": true, "assets": {}}` | 从此以后的完整能力集合（替换之前的声明）。 |

`capabilities` 只适用于 page 类型的 Artifact，其他类型会返回 `invalid_argument`。值为 `true` 或一个选项对象（`false` 表示不声明）。`publish` 的结果会在 `capabilities` 中回显声明，并在 `notes` 中指出在本机只会返回错误的能力（`mcp`、`sample`、`tts`、`paste`）或不存在的能力。

本机提供的能力：`db`、`artifact`、`assets`、`downloads`、`comments`、`user`、`room`、`permissions`、`network`。声明 `network` 后，`await network.origins()` 返回宿主允许该类型访问的外部源，内置 page 类型返回空数组。数据库快照只读，同一监听器连续收到的快照会复用内容未变的文档对象。每个能力的用法见 `artifact-types/page/artifact-type/reference/capabilities.md`，旁边附有 TypeScript 声明。

### 在站点上

站点运行页面时（它的 Link `hello` 带 `features.pages`），页面可以发布过去：`open-artifact publish <id>`、自动发布，或者在
用户允许 Agent 发布时用 `Artifact share {cloud}`。旧版站点、或单域名模式（`OA_CONTENT_SAME_SITE`）的站点会以 `unsupported`
拒绝，页面留在本机。Cloudflare 站点和 Node 站点一样运行页面（见 [Page 作品](../hosting-cloudflare.zh-CN.md#page-作品)）。

- **在哪里运行**：作品的内容主机提供内层外壳（`art-<id>.<内容域名>/page/<页面令牌>/`），内层外壳再把页面放在这个访问者自己的
  页面主机 `art-<id>--<opaque>.<内容域名>` 上。页面主机只读地提供页面的文件；所有写入和能力调用都经过内层外壳。
- **权限级别**：查看者只读；评论者还能评论；编辑者还能写数据库和页面文件（frame 级别 `admin`）；所有者什么都能做。`db` 规则
  和本机一样生效。访客会标记为访客；页面能知道的名字和邮箱只限 `user` 声明允许的范围。
- **同步什么**：`index.html` 和旁边的文件、`db/`、`comments.json`、`_blobs/`，双向同步。能力声明单独同步：在本机改的会推到
  站点，所有者在站点上改的（站点的 MCP，只有所有者能改）会同步回来；打开的页面会按新声明重新加载。
- **网络**：由站点的 `OA_PAGE_NETWORK` 统一决定：`self`（默认）只能访问页面自己的源；`https` 还能访问任意 https 源，这时
  `network.origins()` 返回 `["https:"]`。
- **站点上没有的**：快照（图片）和其他类型一样，在这台电脑上从工作副本生成。

### Agent 须知

1. 写成一份自包含的文档：CSS 和脚本内联，或放在旁边的文件里；CDN 可能加载不到。
2. 写上 `<title>`。
3. 用 `await window.openArtifact.use(name)` 获取每个能力，并处理返回 `null` 的情况。
4. 需要长期保存或共享的状态放在 `db`，不要放在 `localStorage`。
5. 不要自己写 `.artifact.json`、`db/`、`history/`、`comments.json` 或以 `.`、`_` 开头的文件。
6. 页面里调用 `artifact.publish(html)` 时，只有在该视图加载后没人改过页面才会替换 `index.html`（否则返回 `conflict`）；之后所有视图都会重新加载。
7. 要做设计：页面没有任何默认样式。写页面前先读类型自带的 `artifact-type/reference/design.md`（从主题和真实内容出发，颜色和字体写成 token 并配一套深色值，用系统字体或放在页面旁的字体文件，360px 宽也能用，加载完就是完整的，加载中和空状态都要设计）；画图示前读 `diagrams.md`，画图表前读 `charts.md`。
8. 交付前看一眼：`Artifact {action: "call", url, name: "snapshot", args: {width: 400, height: 900, scheme: "dark"}}` 返回页面的一张 PNG 的路径（见下文）；再读一次页面存下的数据，`name: "info"` 可以列出它的文件和能力声明。

### 页面截图（`snapshot`）

`Artifact {action: "call", url, name: "snapshot", args?}` 在本机用无头 Chrome 把页面画出来，返回 `{image, width, height, scheme, bytes, note}`；`image` 是 `<root>/_agent/snapshots/` 下一张 PNG 的路径（保留最近 20 张）。所有页面型类型的作品都有这个动作，包括你自己做的类型。

| 参数 | 取值 | 默认 |
| --- | --- | --- |
| `width` | 320 到 3840 | 1440 |
| `height` | 240 到 2160 | 900 |
| `scheme` | `light` 或 `dark`（页面的 `prefers-color-scheme`） | `light` |

- **只读。** 截图是一个独立的访问者，看到的页面和你看到的一样：能读数据库、文件和评论，所有写入都会被拒绝。加载时就写数据的页面（访问计数、初始化数据），截图里显示的是写入被拒，而你自己打开时看到的是写入成功。
- **别人看不到它。** 它不会出现在其他打开的视图的参与者里，不会让它们重新加载，不会唤醒智能体；截图文件不会被页面访问到，也不会进入归档、副本或同步到站点。
- **不会一直等。** 页面画好后才拍；没有 `index.html` 的作品拍到的是空状态，8 秒内没启动的页面拍到的是“页面未启动”卡片。
- **只在本机。** 需要 Chrome、Chromium 或 Edge（可用 `OPEN_ARTIFACT_CHROME` 指定）；没有时返回 `unsupported`。发布到站点的页面用本机的工作副本来画；站点不生成图片。

### 设计指引

类型在 `artifact-type/reference/` 里（和 `capabilities.md` 放在一起）带了三份简短的指引，智能体在页面需要时读取：

| 文件 | 内容 |
| --- | --- |
| `design.md` | 这个请求需要多少设计、从主题出发、token 和明暗两套主题、不依赖远程字体的字体方案、一直到手机宽度的布局、首屏以及加载中、空、无法保存三种状态、供人操作的页面、动效、文案、生成页面常见的几种套路、修改已有页面。 |
| `diagrams.md` | 什么时候值得画图、画什么（机制、方案之间的差别、带说明的箭头），以及怎样手写跟随主题的内联 SVG。 |
| `charts.md` | 到底要不要用图表、每种目的对应的形式、统一且诚实的刻度、图形标记、按用途配色并在颜色之外再给一个信号、悬停与无障碍、不依赖远程库的画法。 |

这些都可以直接点名要求（“别那么模板化”“加一张流程图”“按天画出投票数”）。

### 发送评论给智能体

页面可调用 `comments.onSendToAgent(fn)` 注册监听器，按注册顺序执行。返回 `{ handled: true, reply }` 会在页面内完成这次发送。返回 `{ reply, handoffNote }` 会让评论按通常流程提交，并附上页面提供的上下文。所有监听器都未处理时，保留首个有效回复（最多 500 个 UTF-8 字节）和首条有效说明（最多 2,000 个字节），空白字符串会跳过。智能体收到的说明单独引用为页面数据，保存的讨论串保留用户原话。

### 在 ES 模块中导入能力

页面模块可以按名称导入能力。声明了数据库后，即可同步构造文档或集合引用。

```js
import db from '/_/openartifact:db';
import use, { at } from '/_/openartifact:use';

if (db.available) {
  const doc = db.collection('votes').doc('first');
  const stop = doc.onSnapshot(snapshot => render(snapshot.data()));
  window.addEventListener('pagehide', stop, { once: true });
}
const room = await use('room');
if (room.available) room.on('vote', renderVote);
```

`at(name)` 同步返回一个可复用的引用，默认导出的 `use(name)` 等待 frame 握手后返回同一引用。`available` 表示当前查看者能否使用声明的能力，调用不可用的能力会以 `not_granted` 拒绝。可以用 `/_/openartifact:db@0.2.92` 或 `at('db', {contract: '0.2.92'})` 指定契约，版本须与当前宿主提供的一致。页面原有的 `window.openArtifact.use(name)` 仍返回能力命名空间或 `null`。

TypeScript 页面可以从 `@open-artifact/server-sdk/frame/imports` 导入 `at` 和默认导出的 `use`。要在浏览器中直接使用这个包名，在页面的模块脚本前加上 import map，让它和页面模块地址指向宿主的同一份实现。

```html
<script type="importmap">
{"imports":{"@open-artifact/server-sdk/frame/imports":"/_/openartifact:use"}}
</script>
```

使用 `db.collection()` 等同步方法前先检查 `ref.available`。SDK 类型包含只读数据库快照，以及房间事件中可能为 `null` 的发送者身份。将注入的运行时传给页面组件时，可以从 `@open-artifact/server-sdk/frame/page-api` 导入 `FramePageRuntime` 类型。
