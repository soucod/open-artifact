# Harness API 参考

[English](harness-api.md)

本页列出 Harness API（协议 1）的每个方法、通知、事件、功能和错误。TypeScript 类型在 `packages/protocol/src/harness.ts`（`AdapterToDaemon`、`DaemonToAdapter`、`HarnessEvent`）。要知道怎么用它们，从[接入 Open Artifact](../integrating.zh-CN.md) 开始。

## 传输

| | |
| --- | --- |
| WebSocket | `ws://127.0.0.1:<port>/__harness`，子协议 `open-artifact-harness` |
| 消息 | JSON-RPC 2.0；双方都发请求 |
| 端口和令牌 | `<home>/daemon.json`（`port`、`token`、`pid`、`version`） |
| stdio | `open-artifact harness --stdio --harness <name>`：同样的方法，以 JSON 行传输（[非 JavaScript 应用](../integrating/non-node.zh-CN.md)） |
| HTTP 轮询 | [见下文](#http-轮询) |

第一个请求必须是 `hello`。在它之前的任何请求都以 `unauthorized` 拒绝。

## 版本与兼容承诺

`PROTOCOL_MIN` 和 `PROTOCOL_MAX` 都是 `1`。适配器在 `hello` 里说明它讲的版本（`protocols: { min, max }`；省略即为 1）；daemon 用双方都讲的最高版本回答。没有共同版本时，`hello` 以 `unsupported_protocol` 失败，修复提示写明该升级哪一方。

在同一个协议版本内，方法、可选字段、事件和功能名只会**增加**。使用某个功能前按名字检查它；绝不比较 daemon 版本。忽略你不认识的字段和事件。

从 0.14.0 起，凡是改动了 Harness API、Shell 或唤醒消息、kit、随附 profile 或 stdio 分帧的版本，[CHANGELOG.md](../../CHANGELOG.md) 里都有一节 `### Integrators`，说明对你有什么变化。

## 功能

`hello` 的回答列出 `features`。daemon 只列出它实现了的功能。

| 功能 | daemon 的行为 |
| --- | --- |
| `hello.profile` | 保留适配器在 `hello` 里报告的 profile |
| `skill.get` | 回答 `skill.get` |
| `commands.list` | 回答 `commands.list` |
| `embed.origins` | 回答 `embed.origins` 并发送 `embed/origins` 事件 |
| `shell.command` | 回答 `shell.command` |
| `shell.event` | 为顶层视图调用 `shell.event` |
| `view.context` | 回答 `view.context` 并发送 `view/context` 事件 |
| `session.may` | 执行 `session.attach` 的 `may` 和 `role` |
| `wake.drafted` | 接受回答 `drafted` |
| `wake.session` | 接受 `{ status, session }`，并把归属转到那个会话 |
| `wake.from` | 在唤醒的 `source` 里放入 `reason` 和 `from` |
| `tools.actions` | 在 `tools.list` 里给出每个工具的 `actions`（操作 → 类别） |
| `quickstart.steps` | `quickstart` 回答 `steps`、`existing`、`rules`、`replaces`，并接受 `type` |
| `types.remote` | 用 `remote` 和 `origin` 描述类型，给出 `remoteActions`，并在 `host.open` 里放入 `remote` |
| `hello.runtime` | 记录 `hello` 的 `runtime`，并启动最新的兼容运行时 |
| `runtime.update` | 回答 `runtime.status` 和 `runtime.update`，并发送 `runtime/update` 事件 |
| `types.source` | 在列出类型的地方、读取作品时，用 `source`（`builtin`、`local`、`installed`）描述类型，安装的类型还带 `installed_from` 和 `third_party_notice`；新建或接管作品时，把 `third_party_notice` 放在 `instructions` 旁边；还没信任的项目里的类型带它自己的 `third_party_notice`，读取这两种类型的作品时（`Artifact`、`ArtifactData`、`ArtifactComments`）再加一句页面内容的说明 |

`session.*`、`tools.list`、`tools.call`、`agent.wrote`、`artifact.open`、`inbox.take`、`inbox.wait` 和 `subscribe` 是基础协议，不需要功能名。

## `hello`

| 参数 | 类型 | |
| --- | --- | --- |
| `harness` | string | `^[a-z0-9][a-z0-9._-]{0,40}$` |
| `token` | string | 来自 `daemon.json`（stdio 上不传） |
| `caps` | `AdapterCaps` | 见下文 |
| `protocols` | `{ min, max }` | |
| `kit` | `{ name, version }` | 你所基于的 SDK |
| `profile` | [profile](profile.zh-CN.md) 的一部分 | daemon 列出 `hello.profile` 时保留；绝不含 `nudge` |
| `runtime` | `{ dir, version, update? }` | 你附带的运行时（[运行时](../integrating/runtime.zh-CN.md)） |

结果：`{ protocol, daemon, connection, features }`。

### `AdapterCaps`

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `wake` | `{ resume?, mode?: 'auto' \| 'draft' }` | 你接收 `wake.deliver`；`resume`：你能恢复已关闭的会话；`draft`：你把文本放进输入框 |
| `open` | `true` 或 `{ embed: 'frame' \| 'view', origins, remote?: 'allow' \| 'ask' \| 'deny' }` | 你接收 `host.open` |
| `agentName` | string | 你的应用怎么称呼它的 Agent |
| `tools` | `'cli' \| 'mcp' \| 'native'` | 你的 Agent 怎么调用工具 |
| `commands` | `{ names, menu? }` | 你的命令名；`menu`：你为每个类型列一个条目 |
| `library` | `'home' \| 'cards' \| 'own'` | 人在哪里找到作品；只是声明（见下文） |

`library` 不改变 daemon 或 Shell 的任何行为：daemon 检查这个值、记下它、写进日志和 `GET /api/open-artifact.harnesses`，`doctor --session` 会把它打印出来（不写时显示 `library (not said)`）。不管写哪个值或不写，作品事件、首页和 `embedLibrary` 都一样工作。你的应用没有列出作品的地方时就不写它；没有专门表示这种情况的值。

## 适配器 → daemon

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `session.attach` | `session`、`workspace`、`title?`、`status?`（`idle` \| `running`）、`pid?`、`may?`、`role?` | `{ key, inbox }` |
| `session.status` | `session`、`workspace`、`status` | `{ ok }` |
| `session.detach` | `session`、`workspace` | `{ ok }` |
| `session.rename` | `session`、`workspace`、`title` | `{ ok }` |
| `tools.list` | — | `{ tools }`（name、description、inputSchema、`actions`、`remoteActions`） |
| `tools.call` | `name`、`arguments`、`caller?` | 工具的结果 |
| `agent.wrote` | `paths`、`caller?` 或 `session`/`workspace` | `{ ok, artifacts? }` |
| `artifact.open` | `url`、`caller?` 或 `session`/`workspace` | `{ opened, view_url? }` |
| `inbox.take` | `session`/`workspace` 或 `caller` | `{ messages }` |
| `inbox.wait` | 同上，加 `timeoutMs?`（默认 10 分钟，最多 1 小时） | `{ messages }` |
| `subscribe` | `on` | `{ ok }`；开启期间随后有 `event` 通知 |
| `skill.get` | `form?`（`entry` \| `full`）、`command?`、`agentName?`、`tools?`、`toolNames?`、`opens?`、`locale?` | `{ name, description, argumentHint, body, version, etag, prompt? }` |
| `commands.list` | `command?`、`locale?` | `{ commands }`：`text`、`type`、`title`、`description`、`templates?`、`remote?`、`origin?` |
| `embed.origins` | — | `{ origins, entries }`；一个条目有 `origin` 或 `pattern`、`kind`（`daemon` \| `frame` \| `server` \| `url`）、`type?`、`remote` |
| `shell.command` | `view`、`command`（一条宿主消息） | `{ ok }` |
| `view.context` | `url`、`session?`、`workspace?` | `{ at, context, changed }`；只限所有者会话 |
| `runtime.status` | — | `RuntimeStatus` |
| `runtime.update` | `version?` | `{ installed, pending, message }` |

`skill.get` 的 `opens` 决定 skill 里“展示给人”那一步怎么写：`host`（你的应用自己显示页面）、`agent-browser`（Agent 在它自己的浏览器面板里打开 `view_url`）、`system`（电脑的浏览器）、`link`（Agent 把 `view_url` 给人）。不传时，你的 caps（来自 `hello` 或 profile）有 `open` 就用 `host`，否则用一段兼顾内置浏览器和电脑浏览器的通用说明。

`session` 和 `workspace` 指调用方 harness 的一个会话。没有 id 的会话以它的工作目录为键。`may` 是 `{ create?, modify?, remove?, reply? }`（[Agent 工具](../integrating/tools.zh-CN.md#会话权限)）。

## daemon → 适配器

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `wake.deliver` | `session`、`workspace`、`artifact`、`artifactId`、`text`、`source` | `{ status, session? }`；`status` 是 `delivered`、`resumed`、`queued`、`drafted` 或 `failed` |
| `host.open` | `session`、`url`、`view_url`、`title?`、`view?`、`embed_url?`、`remote?`（`{ type, origins }`） | `{ opened }` |
| `shell.event` | `view`、`session`、`event`（一条 Shell 消息） | `{ ok }` |

在 stdio 上，桥只在你的 caps 有 `wake` 时转发 `wake.deliver`，只在有 `open` 时转发 `host.open` 和 `shell.event`。没有就收不到这些调用；守护进程不会发，万一来了，桥会回答 `method_not_found`。

daemon 等待回答 30 秒。没有回答、出错或 `failed` 都会让唤醒留在收件箱里（[唤醒](../integrating/wake.zh-CN.md)）。

## 事件

订阅期间，通知 `event` 携带以下之一：

| `type` | 字段 | 时机 |
| --- | --- | --- |
| `artifacts/changed` | `id`、`author?`、`paths?`、`removed?` | 作品被创建、写入或删除 |
| `types/changed` | — | 类型被安装、删除或改变 |
| `harness/changed` | — | 适配器或会话变化 |
| `wake/state` | `artifactId`、`via`、`status?` | 一次唤醒的结果 |
| `view/context` | `id`、`at`（来自 Harness API 时还有 `url`） | 所有者在页面上的选择变了（尽力而为） |
| `embed/origins` | `origins`、`entries` | `embed.origins` 的结果变了 |
| `runtime/update` | `current`、`available`、`installed` | 有可用更新，或已安装 |

## 错误

失败是一个 JSON-RPC 错误，其 `data` 是 `{ code, message, fix? }`。`fix` 是一行说明该怎么做的文字。

| JSON-RPC 代码 | 时机 |
| --- | --- |
| `-32700` | 消息不是 JSON（`data.code` 为 `parse_error`） |
| `-32601` | 未知方法（`data.code` 为 `method_not_found`） |
| `-32602` | 参数不对（`data.code` 为 `invalid_argument`） |
| `-32000` | 其他任何失败；读 `data.code` |

按 `data.code` 判断，不要按 JSON-RPC 代码。

WebSocket 和 stdio 桥用同一套数字回答（`@open-artifact/protocol` 里的 `rpcErrorCode`）；HTTP 轮询用 HTTP 状态码和同样的 `{ code, message, fix? }` 请求体回答。

| `data.code` | 含义 |
| --- | --- |
| `invalid_argument` | 参数缺失或不对 |
| `parse_error` | 这一行或这条消息不是 JSON |
| `method_not_found` | 没有这个方法，或适配器没在 caps 里声明它（stdio） |
| `unauthorized` | 还没 `hello`，或令牌错误 |
| `unsupported_protocol` | 双方没有共同的协议版本 |
| `unknown_session` | 在 `session.attach` 之前轮询 |
| `not_found` | 作品、会话、文件或版本不存在 |
| `not_granted` | 会话权限、只限所有者的读取、仅限本人的操作、更新已关闭 |
| `conflict` | 东西在你手下变了，或已经存在 |
| `duplicate` | 评论回复和上一条完全相同 |
| `too_large` | 请求体或文件超过上限 |
| `bad_path` | 路径离开作品文件夹，或指向它的记账文件 |
| `rate_limited` | 调用太多；稍后再试 |
| `unsupported` | 守护进程或类型不做这件事（例如它没列出的功能） |
| `unknown_action`、`unknown_tool` | 类型没有这个动作；没有这个工具 |
| `type_missing`、`type_not_runnable` | 类型没安装（导入时写明它的 id、uid 和来源）；装了但无法运行 |
| `type_mismatch` | 作品是同 id 的另一个类型做的（`typeUid` 不同）：不打开也不写入 |
| `server_failed` | 类型服务器或远程类型失败 |
| `unavailable` | 需要的服务现在不在 |
| `newer_release` | 作品是更新的 Open Artifact 写的；先更新 |
| `redirected` | 链接主机回了重定向；什么都没有转发 |
| `download_failed`、`integrity_failed`、`bad_archive` | 运行时更新或类型包下载失败、与 integrity 不符，或无法安全解包（要导入的压缩包不是作品压缩包也是它） |
| `connect_failed`、`disconnected`、`timeout` | 连不上、连接断了，或太久没回 |
| `no_daemon`、`daemon_failed` | kit 或 CLI 找不到守护进程，或无法启动它 |
| `error` | 其他 |

类型可以加自己的代码。工具本身的失败以带 `error` 的普通结果返回，不是 JSON-RPC 错误。

## HTTP 轮询

给无法保持 WebSocket 的适配器用。每个路由都是 `POST`，带 `Authorization: Bearer <token>` 和 `X-Open-Artifact-Harness: <name>`；请求体是 JSON。

| 路由 | 请求体 | 回答 |
| --- | --- | --- |
| `/api/open-artifact.session.attach` | attach 的参数、`agentName?` | `{ key, inbox }` |
| `/api/open-artifact.session.wait` | `session`、`workspace`、`timeoutMs?`（默认 25 秒，1 到 60 秒） | `{ messages }`，超时后为 `[]` |
| `/api/open-artifact.session.status` | `session`、`workspace`、`status` | `{ ok }` |
| `/api/open-artifact.session.detach` | `session`、`workspace` | `{ ok }` |
| `/api/open-artifact.tools` | — | `{ tools }` |
| `/api/open-artifact.tools.call` | `name`、`arguments`、`caller?` | 工具的结果 |

每个会话同时只有一个 `session.wait`；新的会以 `[]` 结束旧的。20 秒没再出现的轮询适配器算断开，它的唤醒进收件箱。轮询适配器收不到事件，也收不到 `host.open`、`shell.event` 或 `wake.deliver`：它们的唤醒以 `session.wait` 消息的形式到达。

## 适配器用到的其他 HTTP 路由

| 路由 | |
| --- | --- |
| `GET /__open-artifact/health` | daemon 在运行 |
| `GET /api/open-artifact.harnesses` | 适配器、它们的 caps、会话（需令牌） |
| `GET /api/open-artifact.embed` | 已声明宿主的源（`hosts`）和 `embed.origins` |
