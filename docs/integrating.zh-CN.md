# 把 Open Artifact 接入 Agent 产品

[English](integrating.md)

这份指南写给发布 Agent 产品的工程师：桌面应用（Electron、Tauri）、IDE 扩展、命令行 Agent，或者带本地助手的网页应用，用不用 JavaScript 都行。读完后你能让三件事跑起来：

1. 你的 Agent 用 Open Artifact 的工具做作品（幻灯片、设计、文档、表格、看板、白板、短片）；
2. 作品的页面显示在你的界面里；
3. 人在这些页面上写的东西（评论、**Ask**、页面请求）回到正确的 Agent 会话。

下面每一层停下来都是一个能用的状态。每一层都写明要写什么、人看到什么、怎么检查。

## 组成部分

```text
 your app ─────────── your adapter ──────── harness kit ─── WebSocket /__harness ───▶ daemon (one per computer)
 (chat, sessions,     (the code you write:   (@open-artifact/       JSON-RPC 2.0          │  tools, library, wake,
  tool registry, UI)   sessions, tools,       harness-kit, or the                        │  type servers
                       wakes, pages)          stdio bridge)                              ▼
                                                                               Shell page  /a/<id>
 your UI ◀── iframe or top-level view ──────────────────────────────────────── (title bar, comments, share,
                                                                                export, "Ask") around the page
```

- **daemon**（`open-artifact daemon`）每台电脑、每个 Open Artifact 主目录（`~/.agents/open-artifact`，或 `$OPEN_ARTIFACT_HOME`）只跑一个。作品库、三个 Agent 工具、类型服务器、给各个 Agent 会话的收件箱都归它管。电脑上所有 Agent 应用共用它。
- **Shell** 是 daemon 的页面，地址是 `http://127.0.0.1:<port>/a/<id>`。它把作品的编辑器放进框架，画出标题栏、评论、分享和导出，并和嵌入它的一方通信。
- **你的适配器**（adapter）是你写的代码。它以你的 harness 身份（一个名字，比如 `my-agent`）连到 daemon，告诉 daemon 有哪些会话，把工具交给你的 Agent，接收唤醒，显示页面。
- **kit**（`@open-artifact/harness-kit`，Node 22.18+ 或 Electron 自带的 Node）替 JavaScript 适配器处理连接：找到或启动 daemon、断线重连、重新挂上会话，并封装每个调用。用其他语言写的程序改为运行 `open-artifact harness --stdio`（[非 JavaScript 应用](integrating/non-node.zh-CN.md)）。

## 选一个层级

| 层级 | 你要写什么 | 人看到什么 | 评论怎么回来 |
| --- | --- | --- | --- |
| 0. Skill + 命令行 | 复制 skill；Agent 在 shell 里运行 `open-artifact …` | 聊天里的一个页面链接 | 在 Agent 下一次调用的结果里，或者它运行 `open-artifact wait` 时 |
| 1. MCP | 一条 MCP 服务器配置（应用有 hooks 的话再加 hooks） | 一个链接，或你应用里的浏览器 | 在下一次工具结果里；有 hooks 时在会话开始、下一条消息、回合结束时 |
| 2. kit | 一个适配器：会话、原生工具、`wake` 回调 | 一个链接 | 立刻送到拥有该作品的会话 |
| 3. 页面放进你的界面 | `open` 回调和嵌入方式 | 聊天旁边的页面 | 同上，另外 **Ask** 会新建或打开你的会话 |
| 4. 作品库 | 根据作品事件生成卡片或列表 | 消息下面的卡片，或你自己的作品列表 | 同上 |

已有的集成分布在这些层级：Claude Code、Codex、Cursor、Copilot、Antigravity 和 ZCode 是带 hooks 的第 1 层；DeepSeek Harness（`plugins/dsh`）是基于 kit 的完整适配器。[`plugins/README.md`](../plugins/README.md) 列出了它们。

## 第 0 层：skill 和命令行

只要 Agent 能读 skill 文件、能运行命令，就能用 Open Artifact。把 skill 写进应用的 skill 目录，放在你希望人输入的命令名下：

```bash
open-artifact skill install --command open-artifact --dir ~/.my-agent/skills
```

这会写出 `~/.my-agent/skills/open-artifact/SKILL.md`；加上 `--harness my-agent` 时按你的 harness 渲染（它的 Agent 名字、命令、规则）。只有内容变了才会重写（文件里有一个 `etag`）；那里已有一个不是 Open Artifact 写的 `SKILL.md` 时不会动它，除非加 `--force`。`open-artifact skill render` 打印同样的内容但不写文件。

然后 Agent 从命令行调用工具，每次一个 JSON 参数：

```bash
open-artifact artifact '{"action":"quickstart"}'
open-artifact comments '{"action":"wait"}'
```

`open-artifact` 是 `@open-artifact/cli` 包；在插件里是 `node <plugin>/skills/open-artifact/scripts/open-artifact.mjs`。没有 daemon 在跑时它会启动一个。

- **人看到什么：** Agent 回复作品的 `view_url`，人在浏览器里打开。
- **评论怎么回来：** 在 Agent 下一次工具结果的 `messages` 里，或者它运行 `open-artifact wait` 时。
- **检查：** `open-artifact doctor` 报告主目录、daemon、运行时和已安装的类型都正常。

## 第 1 层：MCP

如果你的 Agent 支持 MCP 服务器，加一个通过 stdio 运行桥接的服务器：

```bash
node <plugin>/skills/open-artifact/scripts/open-artifact.mjs mcp --harness my-agent
```

`--harness` 指明你的 harness，这样它发出的调用会对应到你的 profile（Agent 名字、会话）。Agent 会拿到 `Artifact`、`ArtifactData` 和 `ArtifactComments`；客户端能显示 MCP Apps 时还有 `ShowArtifact`。

只用 MCP 的 Agent 在下一次工具结果的 `messages` 里收到评论。如果应用有 hooks，在 hooks 里运行 `open-artifact hook <event> --harness my-agent`，评论就会在会话开始、人发下一条消息、回合结束时送到。hook 从 stdin 读你应用的 hook 输入，并按你应用的格式回答；用哪种格式由 profile 的 `hookDialect` 决定（`claude-code`、`cursor`、`copilot`、`antigravity`，或你自己的映射，见 [Profile 参考](spec/profile.zh-CN.md)）。

用一个 profile 告诉 daemon 你的 harness 是什么。把它放在插件里，由人（或在人自己的终端里运行的安装程序）添加：

```bash
open-artifact harness add my-agent.json
open-artifact harness list
```

- **人看到什么：** 一个链接；如果 Agent 在应用内置浏览器里打开 `view_url`，就是那个浏览器。profile 里写了 `"open": "browser"` 时，Agent 要显示页面，daemon 会打开电脑的浏览器。
- **检查：** `open-artifact doctor --harness my-agent` 报告 profile；应用运行起来后，也会报告它的连接。

## 第 2 层：kit —— 原生工具、会话、唤醒

这一层你的应用保持一条实时连接。页面仍然通过链接打开，但评论一发出就送到拥有该作品的会话。下面的代码来自 [`examples/harness-node`](../examples/harness-node)，仓库的测试会让它连真实 daemon 跑一遍。

### 连接

来自 [`examples/harness-node/harness.mjs`](../examples/harness-node/harness.mjs)：

```js
export function connectHarness({ name = 'example-node', agentName = 'Example', wake, runtime = hostRuntime(), ...options } = {}) {
  return createHarness({
    harness: name,
    agentName,
    ...(runtime ? { runtime } : {}),
    commands: ['open-artifact'],
    caps: { wake: { resume: true }, tools: 'native', library: 'own' },
    wake,
    ...options,
  });
}
export function callerOf(session) {
  return { session: session.id, workspace: session.workspace };
}
```

`createHarness` 通过 Open Artifact 主目录里的 `daemon.json` 找到正在运行的 daemon，或者启动一个。启动需要运行时：传入 `runtime: { dir, version }`（你的应用附带的 `@open-artifact/cli` 目录），或设置 `OPEN_ARTIFACT_DAEMON_BIN`。两者都没有、电脑上也没有登记过的运行时，它会报 `no_daemon`（[运行时](integrating/runtime.zh-CN.md)）。

示例用同一个文件里的 `hostRuntime()` 告诉 kit 它附带的是哪个运行时：

```js
export function hostRuntime(folders = runtimeFolders()) {
  for (const dir of folders) {
    const version = runtimeInfo(dir)?.version;
    if (version) return { dir, version };
  }
  if (process.env.OPEN_ARTIFACT_DAEMON_BIN) return undefined;
  throw new Error('No Open Artifact runtime: install @open-artifact/cli (npm install @open-artifact/cli), or in this repository build it (npm run build, then node scripts/build-plugins.mjs).');
}
```

`runtimeFolders()` 列出已安装的 `@open-artifact/cli` 包，在本仓库里还有构建好的 `skills/open-artifact`；`runtimeInfo`（来自 kit）读出一个目录的版本。你的应用返回它自己包里的那个目录。

`caps` 告诉 daemon 你的适配器能做什么。只有传了 `wake` 回调，kit 才会声明 `wake`；只有传了 `open` 回调，才会声明 `open`。所以你没法声明自己处理不了的能力。

### 挂上会话

会话是你的 Agent 的一次对话。会话开始时挂上（attach），回合开始和结束时设置状态，会话关闭时卸下（detach）。来自 [`examples/harness-node/main.mjs`](../examples/harness-node/main.mjs)：

```js
await oa.attach({ ...callerOf(agent), title: agent.title, status: 'running' });
// …
await oa.status(callerOf(agent), 'idle');
```

`session` 是你给它的 id，`workspace` 是它工作的项目目录。重连后 kit 会重新挂上每个会话。会话不在时收件箱里攒下的消息，挂上时会交给你的 `wake` 回调。

### 注册工具

把 daemon 的工具注册到 Agent 自己的工具表里，每次调用都带上会话作为调用方。来自 [`examples/harness-node/tools.mjs`](../examples/harness-node/tools.mjs)：

```js
export async function registerTools(oa, agent) {
  const definitions = await oa.tools();
  for (const tool of definitions) {
    agent.register(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      run: (args) => oa.call(tool.name, args, callerOf(agent)),
    });
  }
  return definitions.map((tool) => tool.name);
}
export function reportWrites(oa, agent, paths) {
  return oa.wrote(paths, callerOf(agent));
}
```

调用方决定了哪个会话拥有作品，评论也就回到那个会话。Agent 用自己的文件工具往作品目录里写文件时，用 `wrote`（`agent.wrote`）报告：daemon 会记下这些是 Agent 写的，不会再把它们当成人的修改报回来。[Agent 工具](integrating/tools.zh-CN.md) 讲操作类别、哪些数据会离开电脑、会话权限。

### 接收唤醒

人在页面上发送评论或使用 **Ask** 时，daemon 会在拥有该作品的会话的适配器上调用 `wake.deliver`。来自 [`examples/harness-node/wakes.mjs`](../examples/harness-node/wakes.mjs)：

```js
export function routeOf(params) {
  return params.source?.from?.kind === 'owner' ? 'turn' : 'notice';
}
export function wakeHandler(sessions, { onWake = () => undefined } = {}) {
  return (params) => {
    const agent = params.session ? sessions.get(params.session) : null;
    if (!agent) return 'failed';
    const route = routeOf(params);
    agent.add(route === 'turn' ? 'user' : 'notice', params.text);
    onWake(params, route, agent);
    return 'delivered';
  };
}
```

只有所有者的话才变成用户回合。作品分享对象写的评论、后台任务完成的通知，都是 Agent 在下一回合看到的提示。接不住时回答 `failed`：daemon 会把消息留在收件箱里。[唤醒](integrating/wake.zh-CN.md) 解释每种回答，以及为什么要这样分流。

### 检查

```bash
node examples/harness-node/main.mjs --workspace /tmp/demo --once
```

它会打印 `connected`、`tools`、`skill`、`published`、`opened` 和 `ready <url>`。打开页面（`open-artifact open <url>` 会打印地址），写一条评论并点 **Send to agent**：会出现 `wake turn comment from owner on "…"` 这一行。在第二个终端里，`open-artifact doctor --harness example-node` 会显示适配器已连接（在 `main.mjs` 不带 `--once` 运行时执行）。

## 第 3 层：把页面放进你的界面

传入 `open` 回调，并说明嵌入方式。之后 daemon 会调用 `host.open`，而不是把链接交给 Agent，由你的应用显示 Shell 页面。

| 方式 | 加载什么 | 消息怎么走 | 适用于 |
| --- | --- | --- | --- |
| 框架 | 在你页面的 `<iframe>` 里加载 `viewUrl` | 你的页面和 Shell 之间用 `postMessage` | 你的界面是从自己的源提供的网页 |
| 顶层视图 | 在 webview、标签页或窗口里加载 `embedUrl`（带一次性视图票据） | 经过 daemon：`shell.event` 到你的适配器，`shellCommand` 回去 | Electron、Tauri、IDE webview，或任何没有父框架的视图 |

顶层视图的写法，来自 [`examples/harness-electron/src/pane.mjs`](../examples/harness-electron/src/pane.mjs)（这个示例没有在 Electron 里跑过，见[已知限制](integrating/limits.zh-CN.md)）：

```js
const embed = embedArtifact(this.transport(request.view), {
  url: request.embedUrl,
  harness: 'electron-example',
  agentName: this.agentName,
  toolbar: false,
  theme: themeOf(),
  // …
  capture: async () => (await view.webContents.capturePage()).toJPEG(70),
  saveThumbnail: (jpeg, artifact) => this.oa.saveThumbnail(artifact, jpeg),
});
```

三条规则决定这样做是否安全：

- **只加载 daemon 列出的源。** `embedOrigins()` 列出它们，`embed/origins` 事件会更新它们。绝不要放行“整个回环地址”。[`examples/harness-node/allowlist.mjs`](../examples/harness-node/allowlist.mjs) 就是这么做的。
- **框架方式要声明你自己的源。** `embed: { origins: ['https://app.example.com'], mode: 'frame' }`。对未声明的宿主，Shell 不给提示文本、不给评论文本、不给外链、不报告保存的文件、不显示目的地。从 `file://` 加载的页面源是 `null`，永远无法声明：请用自定义协议提供界面，或改用顶层视图。
- **远程类型的页面先问。** 页面在另一台电脑上的类型会带着 `remote` 到来；kit 会先问你的 `allowRemote` 再显示（`embed.remote: 'ask'`，默认），或者永不显示（`deny`）。`allow` 只给面板本来就是通用浏览器的宿主用（[远程类型](integrating/remote-types.zh-CN.md)）。

页面会告诉你人在哪里（`onPlace`）、选中了什么（`context()`，功能 `view.context`），并请你新建或打开会话（`onNewSession`、`onOpenSession`）。[在你的界面里显示页面](integrating/embedding.zh-CN.md) 有完整列表和 webview 检查清单；[Embed 参考](spec/embed.zh-CN.md) 列出每条消息。

- **人看到什么：** 页面在聊天旁边打开；**Ask** 进入你的会话；作品库里出现缩略图。
- **检查：** 你的 `open` 回调接下页面时，`main.mjs` 打印 `opened in-host`；你的视图只加载允许列表里的源。

## 第 4 层：作品库

你的应用可以用自己的方式展示人的作品。三种选择，用 `caps.library` 声明：

- `home`：用 `embedLibrary` 嵌入 daemon 的首页，只显示你的 harness 或某个工作目录的作品。
- `cards`：在创建或修改了作品的那条消息下面放一张卡片。
- `own`：你自己的列表，根据作品事件维护。

这个值只是声明：daemon 记下它并显示出来（日志、`GET /api/open-artifact.harnesses`、`doctor --session`），daemon 和 Shell 的行为都不依赖它。你的应用没有列出作品的地方时就不写 `library`；没有表示这种情况的值，写不写作品事件和首页都一样工作。

来自 [`examples/harness-node/artifacts.mjs`](../examples/harness-node/artifacts.mjs)，每个作品和会话一张卡片，以 `open-artifact://` 链接为键：

```js
export function cardOf(report) {
  if (report.change === 'removed') return null;
  const { artifact } = report;
  return { url: artifact.url, title: artifact.title, type: artifact.type, thumbnail: artifact.thumbnail, updatedAt: artifact.updatedAt };
}
```

`on('artifact')` 报告作品库里每个 `created`、`updated` 或 `removed` 的作品，以及谁改的、改了哪些文件。只有当你的 harness 的某个会话拥有它时，`session` 和 `workspace` 才有值；`removed` 报告不带会话，所以要按链接找卡片：同一个文件里的 `followArtifacts` 会把它从每个会话里删掉。用 `open-artifact://artifact/<id>` 链接作键：daemon 换端口重启后页面地址会变，`viewUrl(url)` 给出当前地址。

## 命令与 skill

人通过输入命令来要一个作品。默认是 `/open-artifact <type> <要做什么>`；你的应用可以用自己的命令名，写在 `commands`（`createHarness({ commands: ['artifact'] })`）或 profile 里。

- `installSkill({ dir, agentName, tools, opens })` 写出按你的 harness 渲染的 skill，和 `skill install` 一样，并在运行时更新改变它之后重写。见 [`examples/harness-node/skill.mjs`](../examples/harness-node/skill.mjs)。
- `opens` 说明页面怎样到达人面前，因此决定 skill 里“展示给人”那一步怎么写。`installSkill`、`renderSkill`、`localSkill` 和 `keepSkillInstalled` 都接受它：

  | `opens` | skill 告诉 Agent | 适用于 |
  | --- | --- | --- |
  | `host` | 第一次写入后你的应用自己显示页面；用 `open: "never"` 创建时，调用 `Artifact open`，由应用显示 | 你传了 `open` 回调（`caps.open`） |
  | `agent-browser` | 在它自己的浏览器面板或标签页里打开 `view_url` | 你的 Agent 有浏览器工具，而你自己不显示页面 |
  | `system` | 第一次写入后页面在电脑的浏览器里打开；否则用 `Artifact open` 在那里打开 | 人看的是电脑的浏览器 |
  | `link` | 什么都不会自己打开；把 `view_url` 作为链接给人 | 以上都不是 |

  不传时，daemon 的渲染（`skill.get`）在你的 caps 有 `open`（来自 `hello` 或 profile）时用 `host`，否则用一段通用说明：Agent 有内置浏览器就用它，否则用 `Artifact open` 在电脑的浏览器里打开。`Harness.installSkill` 对 kit 自己的渲染（daemon 没连上或没有 `skill.get` 时使用）也这样做：你给 `createHarness` 传了 `open` 回调时，它传 `opens: 'host'`。你自己传的 `opens` 总是优先。独立的辅助函数（`installSkill(client, …)`、`renderSkill`、`localSkill`）不知道你的回调，要自己传 `opens`。
- `commands()`（`commands.list`）为命令菜单给出每个已安装类型的一项：要插入的文本（`/artifact slides `）、标题、说明和起始提示。
- skill 和 `quickstart` 读同一组选项：你的命令、Agent 名字、Agent 怎么调用工具、页面怎么打开、你的规则、要人确认的操作类别。

harness 的规则分两种。`rules` 是文本（最多 4000 个字符），daemon 把它放在 skill 最前面，并说明它优先于后面的说明；它不改变任何权限。`policy` 是 daemon 会照着执行的数据：`offer`（只在被要求时做作品，还是主动提议）、`reuse`（`quickstart` 去哪里找可复用的作品）、`roles`（每种会话能做什么）和 `confirm`（每次都要人批准的操作类别）。单个会话的权限写在 `attach({ may, role })` 里，daemon 列出 `session.may` 时会强制执行（[Agent 工具](integrating/tools.zh-CN.md)）。

## Profile

daemon 通过 profile 认识每个 harness：标题、Agent 名字、层级、怎么连到 daemon、标记变量和会话变量、hook 格式等。profile 有三个来源：

| 来源 | 位置 | 谁写 | 优先于 |
| --- | --- | --- | --- |
| `user` | `<home>/harnesses/<name>.json` | 人，用 `open-artifact harness add` | 所有其他来源 |
| `adapter` | 同一个文件，`"source": "adapter"` | 你的适配器，在 `hello` 里（`profile`） | 随附的 profile，逐字段覆盖 |
| `shipped` | 运行时里的 `packages/daemon/harnesses/<name>.json` | Open Artifact 的发布版本 | 默认值 |

适配器几乎可以报告关于自己的一切，但永远不能设置 `nudge`、`mcp`、`skillsDir`、`sessionWorkspace`、`source` 或 `name`：`nudge` 和 `sessionWorkspace` 会让 daemon 运行程序或读取文件，所以只有随 Open Artifact 发布的文件或人自己添加的文件才能写它们。报告的 profile 永远不会覆盖人自己的文件。[Profile 参考](spec/profile.zh-CN.md) 列出每个字段。

把应用给人看的名字写在 profile 的 `title` 里；用 kit 时，`createHarness({ profile: { title: 'My App' } })` 会在 `hello` 里报告它。Shell 在所有给人看 harness 名字的地方都用它：提问面板（“消息会发给做这个作品的 My App 会话”）、打开会话的按钮和菜单项，以及首页上的所有者标记。没有标题时，Shell 原样显示你的 harness 名字。

## 上线前检查

- [ ] harness 名字符合 `^[a-z0-9][a-z0-9._-]{0,40}$`，并且在 `hello`、profile 和 `--harness` 里一致。
- [ ] 每次工具调用都带上会话作为调用方；Agent 自己写的文件用 `wrote` 报告。
- [ ] `wake` 回调按 `source.from.kind` 分流：只有 `owner` 变成用户回合。
- [ ] 接不住消息时 `wake` 回答 `failed`，让 daemon 保留它。
- [ ] 会话挂上时带 `workspace`，设置 `running`/`idle`，关闭时卸下。
- [ ] 视图只加载 `embedOrigins()`，跟随 `embed/origins`，页面拿不到应用的权限。
- [ ] 框架宿主的源写在 `embed.origins` 里；不从 `file://` 加载任何东西。
- [ ] 远程类型的页面经过 `allowRemote`，或者 `embed.remote` 是 `deny`。
- [ ] 按名字检查功能（`harness.features.includes('view.context')`），不按版本号。
- [ ] 发布到站点、修改远程站点、添加 profile、更新运行时，都留给人来做。
- [ ] 测试里让适配器连假 daemon 跑，并且对着运行中的应用，`open-artifact doctor --harness <name> --session <id>` 通过（[测试](integrating/testing.zh-CN.md#一致性检查)）。
- [ ] 读过[安全](integrating/security.zh-CN.md)和[已知限制](integrating/limits.zh-CN.md)。

## 延伸阅读

| 主题 | 页面 |
| --- | --- |
| 三个工具、操作类别、会话权限、归属 | [integrating/tools.zh-CN.md](integrating/tools.zh-CN.md) |
| 唤醒的路由、回答、恢复、nudge | [integrating/wake.zh-CN.md](integrating/wake.zh-CN.md) |
| 框架、顶层视图、源、缩略图、主题 | [integrating/embedding.zh-CN.md](integrating/embedding.zh-CN.md) |
| 页面在另一台电脑上的类型 | [integrating/remote-types.zh-CN.md](integrating/remote-types.zh-CN.md) |
| 哪个运行时会启动、更新、锁定版本 | [integrating/runtime.zh-CN.md](integrating/runtime.zh-CN.md) |
| 不用 JavaScript 写的适配器 | [integrating/non-node.zh-CN.md](integrating/non-node.zh-CN.md) |
| 信任边界汇总 | [integrating/security.zh-CN.md](integrating/security.zh-CN.md) |
| 假 daemon、`doctor`、CI | [integrating/testing.zh-CN.md](integrating/testing.zh-CN.md) |
| 目前还不能用的部分 | [integrating/limits.zh-CN.md](integrating/limits.zh-CN.md) |
| Harness API 的每个方法、事件和错误 | [spec/harness-api.zh-CN.md](spec/harness-api.zh-CN.md) |
| 宿主与 Shell 之间的每条消息 | [spec/embed.zh-CN.md](spec/embed.zh-CN.md) |
| profile 的每个字段 | [spec/profile.zh-CN.md](spec/profile.zh-CN.md) |
| 可运行的示例 | [examples/README.md](../examples/README.md) |
