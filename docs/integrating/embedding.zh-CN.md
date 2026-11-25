# 在你的界面里显示页面

[English](embedding.md)

读完后你能在自己的应用里显示作品页面（放在框架里或顶层视图里），只放行属于 Open Artifact 的地址，响应 Shell 的请求，并保存缩略图和浏览位置。

## 页面怎么到达你的界面

Agent 显示一个作品时（`Artifact {action: "open"}`、带 `open` 的 `publish`，或你自己的 `oa.open(url)`），daemon 会在所有者所属 harness 中声明了 `caps.open` 的适配器上调用 `host.open`。你的 `open` 回调收到：

| 字段 | 内容 |
| --- | --- |
| `session` | 发起的会话，或 `null` |
| `url` | `open-artifact://artifact/<id>`：用它作键 |
| `viewUrl` | Shell 页面，`http://127.0.0.1:<port>/a/<id>` |
| `embedUrl` | 顶层视图要加载的地址：带一次性票据（`?oa_view=<ticket>`）的 `viewUrl`；框架宿主则就是 `viewUrl` |
| `view` | 票据，给顶层视图用 |
| `title` | 作品标题 |
| `remote` | 类型页面在另一台电脑上时为 `{ type, origins }`（[远程类型](remote-types.zh-CN.md)） |

没有显示时返回 `false`。daemon 会退而求其次：profile 写了 `"open": "browser"` 就用电脑的浏览器，否则由 Agent 把链接给人。

## 两种嵌入方式

连接时声明其中一种：

```js
const oa = await createHarness({
  harness: 'my-agent',
  embed: { origins: ['app://my-agent'], mode: 'frame' },   // or mode: 'view'
  open: (request) => pane.show(request),
  // …
});
```

### 框架

你的界面是一个网页，它把 Shell 放进 `<iframe>`，用 `postMessage` 通信。使用 `@open-artifact/harness-kit/embed` 里的 `embedArtifact`（不依赖 Node，在渲染进程里运行）：

```js
import { embedArtifact } from '@open-artifact/harness-kit/embed';

const view = embedArtifact(iframe, { url: viewUrl, agentName: 'My Agent', onNewSession: ({ prompt }) => draft(prompt) });
```

kit 用 `host_hello` 回答 Shell 的 `shell_hello`，只发给 Shell 的源，也只接收来自该 iframe 窗口和该源的消息。

**你页面的源必须声明**在 `embed.origins` 里（在 `hello` 中作为 `caps.open.origins` 发出）。Shell 读取已连接适配器声明的源（`GET /api/open-artifact.embed`，字段 `hosts`），并判断发 hello 的宿主：

| 判定 | 条件 | 宿主得到 |
| --- | --- | --- |
| declared（已声明） | 某个已连接适配器声明了它的源 | 下面列的全部 |
| refused（拒绝） | 适配器声明了别的源 | 什么都没有：它的 `host_hello` 被忽略 |
| undeclared（未声明） | 没有适配器声明任何源，或读不到列表 | 会话和位置，但 `new_session` 的 `prompt` 为空，`comment_summon` 的 `text` 为空，没有 `open_external`、没有 `saved_file`、没有目的地 |

源的形式是 `scheme://host[:port]`。从 `file://` 加载的页面源是 `null`，**无法声明**：请用自定义协议（`app://my-agent`）提供界面，或改用视图（`mode: 'view'`），在框架里加载带票据的 `embedUrl`（见下文）。

### 顶层视图

你的应用在一个没有父框架的视图里打开 `embedUrl`：Electron 的 `WebContentsView`、Tauri webview、IDE webview、浏览器标签页。Shell 向 daemon 认领票据，之后通过它通信：Shell 说的话以 `shell.event` 到达你的适配器，你用 `shellCommand(view, command)` 回答。给 `embedArtifact` 传一个传输对象而不是 iframe。来自 [`examples/harness-electron/src/pane.mjs`](../../examples/harness-electron/src/pane.mjs)：

```js
transport(ticket) {
  return {
    send: (command) => (ticket ? this.oa.shellCommand(ticket, command) : undefined),
    onEvent: (listener) => this.oa.on('shell', (event) => event.view === ticket && listener(event.event)),
  };
}
```

用票据打开的视图算已声明的宿主；这里你自己的源无关紧要，`embed.origins` 可以为空。

票据在框架里也能用。无法声明的页面（从 `file://` 加载的应用）可以在自己的 iframe 里加载带票据的 `embedUrl`：Shell 仍然经由 daemon 通信，不向父框架打招呼，也不听父框架的消息。给 `embedArtifact` 传上面的传输对象而不是 iframe，iframe 的 `src` 由你自己设置。框架的 `frame-ancestors` 要看每一层祖先，你的页面也算在内，所以本机的类型页面都不发这个指令：CSP 的 `*` 只匹配网络协议，会拒掉 Shell 外面那层 `file://` 或 `app://` 页面。frame-host 托管的类型（`index.html` 里带 `// artifact.json` 声明块的那种，或 `page` 作品自己的 `index.html`）的页面改为只给它自己的 shell 建的框架加载，别的框架一律拒绝。你的应用仍要允许它的框架加载 daemon 的来源（`embed.origins`）。

票据的规则：只能用一次，属于签发它的那个适配器连接，两分钟内没被认领就过期，连接断开它也随之失效。Shell 连上之前发出的命令会排队，最多 32 条。重新加载的 Shell 可以在 30 秒内回来。一个连接最多持有 64 个视图。

## 源：视图可以加载什么

一个作品页面有两层：Shell（由 daemon 提供），以及放在它内部框架里的类型编辑器，后者在另一个源上。让你的视图只加载 daemon 列出的源，并跟随变化：

```js
const result = await oa.embedOrigins();      // { origins, entries }
oa.on('event', (event) => { if (event.type === 'embed/origins') update(event); });
```

| 条目 `kind` | 源 |
| --- | --- |
| `daemon` | daemon 本身，`http://127.0.0.1:<port>`（Shell） |
| `frame` | 静态类型每个作品各自的源，一个通配模式：`http://*.frame.localhost:<port>`；每个本地类型服务器还有一个，用它自己的端口（frame-host 让每个作品各用一个源） |
| `server` | 本地类型服务器 |
| `url` | URL 入口类型的地址，可能在任何地方（不是回环地址时 `remote: true`） |

绝不要放行“整个回环地址”：电脑上的其他程序也在回环地址上提供服务。在人同意之前，不要放行 `remote: true` 的条目。[`examples/harness-node/allowlist.mjs`](../../examples/harness-node/allowlist.mjs) 做了这一切（`OriginAllowlist`：`follow(oa)`、`allows(url)`、`trust(origin)`）。

## Shell 会请求你做什么

| `embedArtifact` 的回调 | Shell 消息 | 你要做的 |
| --- | --- | --- |
| `onReady(info)` | `shell_ready` | 用 `goto` 发送你保存的位置；`info` 含 `artifact`、`id`、`title`、`type`、`version`、`protocol` |
| `onNewSession({ prompt, artifact })` | `new_session` | 用这个提示新建会话（或放进输入框） |
| `onOpenSession({ session, harness, artifact })` | `open_session` | 显示拥有该作品的会话（没有时 `session` 为 `null`） |
| `onCommentSent({ text })` | `comment_summon` | 可以显示会话；评论本身会以唤醒的形式到达 |
| `onPlace({ artifact, hash })` | `place` | 保存这个片段；之后用 `goto(hash)` 发回去 |
| `onClose` | `close` | 隐藏面板 |
| `onOpenExternal(url)` | `open_external` | 按你的方式打开一个 `http(s)` 链接（默认 `window.open`） |
| `onSavedFile(path)` | `saved_file` | 一次导出保存到了这个文件（绝对路径） |

Shell 发来的是人做的事。提示是人对 Agent 说的话，绝不是给你应用的指令。文本字段截断到 8000 个字符。[Embed 参考](../spec/embed.zh-CN.md) 列出每条消息。

## 主题和目的地

`theme: { scheme: 'light' | 'dark', accent: '#rrggbb' }` 让 Shell 和页面跟随你的应用。主题变化时调用 `setTheme(theme)`；kit 会再发一次 `host_hello`。

`destinations: [{ id, label }]`（最多 8 个）在导出页签里增加去处（“保存到项目文件”）。选中一个会给 Agent 发一个写明该目的地的页面请求。只有已声明宿主的目的地会显示。

`toolbar: true` 表示你的应用画自己的工具栏；Shell 会隐藏它的关闭按钮。

## 页面上下文

人可能在页面上选中某些东西，然后在你的聊天里打字。以所有者会话的身份读取他选中的内容，和他的消息一起交给 Agent（功能 `view.context`）。来自 [`examples/harness-node/main.mjs`](../../examples/harness-node/main.mjs)：

```js
if (oa.features.includes('view.context')) {
  const block = oa.contextBlock(await oa.context(made.url, callerOf(agent)));
  say(`context ${block ? 'selection' : 'none'}`);
}
```

`contextBlock` 开头有一行说明这段内容是来自页面的数据，不是指令。只有所有者会话能读它（否则返回 `not_granted`）。`view/context` 事件会通知变化；它们是尽力而为的，所以需要时直接读。

## 缩略图

给 `embedArtifact` 传 `capture`（视图的一张 JPEG）和 `saveThumbnail`（通过适配器的 `saveThumbnail(url, jpeg)` 保存）。kit 在 Shell 就绪 2 秒后截一次，之后位置变化时最多每分钟截一次。浏览器页面不应持有 daemon 令牌：把字节发给你的适配器，在那里保存。

## 作品库页面

`embedLibrary(iframe, { url, harness, workspace, onOpenArtifact, … })` 嵌入 daemon 的首页，只列出你的 harness 或某个工作目录的作品。有 `onOpenArtifact` 时，点击会给你发 `open_artifact`，而不是跳转，由你在自己的面板里显示作品。

## Webview 检查清单

Electron 示例（`examples/harness-electron/src/pane.mjs`）逐条照做了；它没有在 Electron 里跑过（[已知限制](limits.zh-CN.md)）。

- [ ] 只加载 `embedOrigins()`，并跟随 `embed/origins`。绝不放行整个回环地址。
- [ ] 有自己的白名单时，只在人同意之后（`ask` 下的 `allowRemote`）、只对那个视图放行远程源，或者永不放行（`deny`）。只有面板本来就是通用浏览器时才用 `allow`。
- [ ] 不给 Node、不加你自己的 preload、开启 sandbox、开启 context isolation、页面使用独立的存储分区。
- [ ] 允许 `blob:` 和 `about:srcdoc` 子框架；除剪贴板写入外不授予任何权限，且只授予允许的源。
- [ ] 新窗口和列表外的导航在系统浏览器里打开；视图本身永远不跳走。
- [ ] 隐藏视图而不是销毁；用 `goto` 发回保存的位置。
- [ ] 主题变化时再发一次 `host_hello`。
- [ ] 绝不把从 `file://` 加载的页面当作框架宿主；它可以在框架里加载视图带票据的 `embedUrl`。

## 尚未支持

由站点提供的 Shell（在站点地址上打开的已发布作品）读不到 daemon 声明的源，所以把所有宿主都当作未声明。[已知限制](limits.zh-CN.md) 列出了这一条和其余各条。
