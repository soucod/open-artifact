# 测试接入

[English](testing.md)

读完后你能在没有真实 daemon 的情况下测试适配器，在 CI 里对着真实 daemon 运行它，并在出问题时检查人的电脑。

## 单元测试里的假 daemon

`@open-artifact/harness-kit/testing` 在你的测试进程里、在一个空闲端口上通过真实的 WebSocket 讲 Harness API，并在它自己的主目录里写 `daemon.json`，所以 kit 找到它的方式和找到真实 daemon 一样。

```js
import { startFakeDaemon } from '@open-artifact/harness-kit/testing';
import { createHarness } from '@open-artifact/harness-kit';

const fake = await startFakeDaemon();          // lists the real daemon's features
const oa = await createHarness({ harness: 'my-agent', home: fake.home, autoStart: false, wake: (params) => 'delivered' });
await oa.attach({ session: 's1', workspace: '/w' });
await fake.waitFor('session.attach');           // the first attach

assert.deepEqual(await fake.wake({ session: 's1', text: 'hi' }), { status: 'delivered' });
fake.drop();                                    // the kit reconnects and attaches s1 again
assert.equal((await fake.waitFor('session.attach')).connection, 2);
oa.close();
await fake.close();
```

| 成员 | 作用 |
| --- | --- |
| `wake(params)` | 发送 `wake.deliver`（不传 `source` 时是一条来自所有者的评论）；回答 `{ status }` 或 `{ status, session }` |
| `open(params)` | 发送 `host.open`；设置了 `view` 时模拟一个顶层视图 |
| `shellEvent(view, event)` | 发送那个视图的 Shell 说的话 |
| `request(method, params)` | 发送任意 daemon 到适配器的调用 |
| `emit(event)` | 向已订阅的适配器发送事件 |
| `queueInbox(session, message)` | 下一次 `session.attach` 或 `inbox.take` 会返回它 |
| `setArtifact`、`removeArtifact` | Library API 对某个 id 的回答（这样 `on('artifact')` 能报告它） |
| `setContext(id, context)` | `view.context` 的回答 |
| `runtimeUpdate(available, installed)` | 发送 `runtime/update` |
| `calls`、`hellos`、`sessions`、`shellCommands`、`thumbnails`、`connected` | 你的适配器做了什么 |
| `waitFor(method)` | 以该方法的下一次调用 resolve |
| `drop()` | 像 daemon 消失那样断开连接 |
| `close()` | 停止它并删除它的主目录 |

选项：`home`、`token`、`version`、`protocols`、`features`、`types`、`onSkill`、`onCommands`、`tools`、`onToolCall`、`handle`、`origins`、`runtimeStatus`、`onRuntimeUpdate`。

三件需要知道的事：

- **默认列出真实 daemon 的功能**（`HARNESS_FEATURES`，从 `@open-artifact/protocol` 导出）。传 `features: []` 模拟旧 daemon 来测试你的退路，或传一个更短的列表去掉某个功能。
- **它回答 `skill.get` 和 `commands.list`。** `skill.get` 按你的 caps 渲染协议的 skill 模板；`commands.list` 为 `types` 里的每个类型（默认一个，`slides`）给出 `/<command> <type> `。传 `onSkill` 或 `onCommands` 自己回答。默认的 skill 是模板，不是真实 daemon 针对已安装类型给出的完整文本。
- **它回答 `runtime.status` 和 `runtime.update`**（`runtimeStatus`、`onRuntimeUpdate`），所以 `oa.runtime.status()` 和 `oa.runtime.update()` 可以对着它测。

## 对着真实 daemon

在临时主目录里、关掉浏览器运行真实 daemon，就像 [`examples/harness-node/harness-node.test.mjs`](../../examples/harness-node/harness-node.test.mjs) 做的那样：

| 变量 | 设为 |
| --- | --- |
| `OPEN_ARTIFACT_HOME` | 一个临时目录 |
| `OPEN_ARTIFACT_DAEMON_BIN` | 要启动的 `open-artifact` 入口（或给 `createHarness` 传 `runtime`） |
| `OPEN_ARTIFACT_PORT` | `0`：任意空闲端口 |
| `OPEN_ARTIFACT_BROWSER` | `none` |
| `OPEN_ARTIFACT_USER_TYPES` | 放着你自己一个小类型的目录，这样测试不需要构建好的类型 |
| `OPEN_ARTIFACT_BUILTIN_TYPES` | 一个空目录 |
| `OPEN_ARTIFACT_WAKE_MERGE_MS` | 一个短的合并窗口，例如 `20` |

页面请求到达你的会话的方式和 Shell 的 **Ask** 发送它的方式一样，经由 Library API：

```js
import { api, readDaemon } from '@open-artifact/harness-kit';

const state = await readDaemon(process.env.OPEN_ARTIFACT_HOME);
const answer = await api(state, 'artifacts.ask', { id, text: 'Make the title bigger' });
// answer.via is 'live' when your adapter took it
```

测试结束时停止 daemon：`open-artifact daemon stop`，或者杀掉 `daemon.json` 里的 `pid`。

## 在人的电脑上

```text
open-artifact doctor --harness my-agent
```

它检查 Node、主目录、`settings.json`、daemon（以及 `daemon.json` 只有本人能读）、类型服务器以进程还是 worker thread 运行、运行时、类型、该 harness 的 profile、该 harness 是否有适配器已连接、工具，以及每个启用的远程类型。有检查失败时它以非零状态退出；`--json` 把结果交给脚本。

`GET /api/open-artifact.harnesses`（带令牌）列出已连接的适配器、它们的 caps 和会话。

## 一致性检查

在你的应用运行、并挂着它的一个会话时，以那个会话的身份检查整条路径：

```text
open-artifact doctor --harness my-agent --session chat-1 --json
```

doctor 以你的 harness 名连接，自己不声明任何 caps，所以 daemon 绝不会把你的唤醒或页面发给它；它通过 `caller` 以你的会话身份调用工具，从不挂上你的会话。它创建一个测试作品（本机类型，放在临时目录里），并在结束时删除，即使某一步失败也会删除。每一步给出 `ok`、`warn`、`fail` 或 `n/a`，附一行该做什么；`n/a` 表示你的应用没有声明那项能力，或那一步需要人参与。

| 步骤 | 检查 |
| --- | --- |
| `discovery` | daemon 在运行，且该 harness 有适配器已连接 |
| `profile` | 该 harness 的 profile 和你的适配器声明的 caps |
| `session` | 会话已挂上、是实时的、经由哪个适配器 |
| `tools` | `tools.list` 有三个工具；`quickstart` 和 `publish` 创建测试作品，所有者是该会话 |
| `commands` | `skill.get` 渲染你的第一个命令（有菜单时还有 `commands.list`） |
| `open` | `Artifact open` 到达你的 `host.open`，并在 30 秒内得到回答 |
| `wake` | 一个页面请求实时到达该会话，你回答 `resumed`、`delivered` 或 `drafted` |
| `rules` | 你的 `rules` 出现在 `quickstart` 里；`policy.roles` 拒绝的角色会得到 `not_granted` |
| `context` | `view.context` 对测试作品有回答 |
| `registration` | 创建和写入时都收到 `artifacts/changed` 事件，所有者是该会话 |
| `cleanup` | 测试作品和它的目录被删除 |

`wake` 这一步会让你的 Agent 开启一个回合；它的文本说明没有要做的事。用 `--json` 时，CI 关卡读取 `id` 以 `conformance.` 开头的结果，遇到 `status: "fail"` 就失败；有检查失败时进程以 1 退出。JSON 的字段只会增加。

## 在本仓库里

`npm run e2e -- --only harness-compat` 把两个由 `examples/harness-node` 构建的宿主连到真实 daemon：端到端跑一遍上面的一致性检查，在 Chrome 里检查已声明、被拒绝和未声明的框架宿主，检查带票据的顶层视图，以及一个交给 `allow` 宿主、而 `deny` 宿主永远拿不到的远程类型。`--no-browser` 跳过 Chrome 部分。对 kit 早期版本的运行在 kit 发布之前跳过。
