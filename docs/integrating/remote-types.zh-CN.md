# 远程类型

[English](remote-types.md)

读完后你能判断作品数据何时会离开电脑，决定你的应用是否显示来自另一台电脑的页面，并向人说明会发送什么。

## 什么是远程类型

大多数类型在本机运行：它们的页面是 daemon 提供的文件，或 daemon 在回环地址上启动的类型服务器。如果一个类型的 `artifact-type.json` 里 `entry` 是另一台主机上的 URL，它就是**远程**类型：它的页面和操作都在那台电脑上。

```json
{ "name": "Board", "entry": { "url": "https://types.example.com/board/", "open": true, "actions": true } }
```

回环地址指 `localhost`、以 `.localhost` 结尾的名字、写成四段数字的 `127.x.x.x`，或 `[::1]`。其他任何主机，包括回环地址的非常规写法，都算远程。

## 哪些数据会离开电脑

| 时机 | 发送什么 |
| --- | --- |
| 页面打开时 | 人的浏览器从类型地址加载页面 |
| `Artifact` 的 `publish`（创建时）、`open`、`call`、`share` | 该路由的请求体，去掉 `root` |
| `ArtifactData` 的全部操作 | 文档和改动 |
| `ArtifactComments` 除 `wait` 外的全部操作 | 线程和回复 |

`tools.list` 按工具给出这些操作，字段是 `remoteActions`（[Agent 工具](tools.zh-CN.md#哪些数据会离开电脑)）。本机上的类型什么也不会发出电脑。

daemon 绝不会发给远程类型的东西：

- **本机路径。** 每个请求体都会去掉 `root`；远程 `entry.url` 里不允许 `{root}` 占位符；参数里带本机路径的操作会被以 `unsupported` 拒绝。
- **密钥。** 回环地址上的类型服务器会拿到一个 bearer 密钥；远程 URL 入口拿不到。

## daemon 拒绝它什么

| 规则 | 错误 |
| --- | --- |
| 绝不跟随重定向（请求会连同请求体一起发到别处） | `server_failed`，写明地址 |
| JSON 回答最多读 32 MiB | `server_failed` |
| 归档（`/__open-artifact/archive`，发布到站点时用）最多读 128 MiB；错误体最多 64 KiB | `server_failed` |
| 创建作品之前，地址必须有回应（任何 HTTP 状态都行） | 一个错误，修复提示建议改用本机类型 |

## 调用之前：告诉人

类型在所有列出它的地方都会带 `remote`（和 `origin`）：`Artifact {action: "list", scope: "types"}` 里、`commands.list` 给出的命令里、`quickstart` 为它给出的步骤里，以及 `read` 里的 `type_remote` / `type_origin`。MCP 工具只有在装了启用状态的远程类型时才带 `openWorldHint: true`。用这些信息在 Agent 创建作品之前告诉人：“这会把数据发到 types.example.com”。

## 显示远程页面

daemon 请你显示一个远程类型的作品时，`host.open` 会带 `remote: { type, origins }`。kit 在你的 `open` 回调看到它之前先应用你的策略：

| `embed.remote` | kit 的做法 |
| --- | --- |
| `allow` | 和其他页面一样显示 |
| `ask`（默认） | 调用 `allowRemote({ origin, type, title })`；“是”在进程运行期间按源记住；“否”或抛出异常的询问不记住，下次打开再问；没有 `allowRemote` 时答案是否 |
| `deny` | 不调用 `open`，直接回答未打开 |

```js
const oa = await createHarness({
  harness: 'my-agent',
  embed: { origins: ['app://my-agent'], mode: 'frame', remote: 'ask' },
  allowRemote: ({ origin, type }) => confirmDialog(`Show a ${type} page from ${origin}?`),
  open: (request) => pane.show(request),
});
```

没有显示时，daemon 和其他页面一样退而求其次：profile 写了 `"open": "browser"` 就用浏览器，否则由 Agent 把链接给人。

选哪种策略由你决定。自己维护导航白名单的宿主用 `ask`（默认）或 `deny`，只在人同意之后、只对那个视图放行远程源。`allow` 给面板本来就是通用浏览器、没有白名单的宿主用，比如 DeepSeek Harness 的 Browser 标签页（[plugins/dsh](../../plugins/dsh/README.md#remote-type-pages)）；`open-artifact doctor --harness <name>` 会显示每个宿主对每个远程类型的策略。`embedOrigins()` 以 `kind: "url"` 和 `remote: true` 列出它们；[`examples/harness-node/allowlist.mjs`](../../examples/harness-node/allowlist.mjs) 在 `trust(origin)` 之前不放行它们。

## 检查

`open-artifact doctor` 用一个普通 GET 探测每个启用的远程类型（不带请求体、令牌、密钥、路径，不跟随重定向）：声明了 `open`、`actions` 或 `share` 时探测 `/__open-artifact/health`，否则探测它的基础地址；声明了 actions 时还探测 `/__open-artifact/actions`。带 `--harness <name>` 时，如果该 harness 的 `embed.remote` 是 `deny`，会给出警告。

## 另见

- [安全](security.zh-CN.md)：谁能看到什么。
- [在你的界面里显示页面](embedding.zh-CN.md)：源和 webview。
- [Artifact 类型参考](../references/artifact-types.md)：`artifact-type.json` 和 `entry`。
