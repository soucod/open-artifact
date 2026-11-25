# Agent 工具

[English](tools.md)

读完后你能把 Open Artifact 的工具交给你的 Agent，分清哪些调用需要人批准，知道一次调用会把什么发出电脑，限制一个会话能做的事，并报告 Agent 自己写的文件。

## 三个工具

daemon 有三个工具。用 `tools()`（`tools.list`）拿到它们的定义；连不上 daemon 时，kit 退回到它自带的定义。用 `call(name, args, caller)`（`tools.call`）运行它们。

| 工具 | 操作 | 用途 |
| --- | --- | --- |
| `Artifact` | `quickstart`、`list`、`publish`、`read`、`open`、`call`、`adopt`、`delete`、`share` | 创建、查找、写入、显示和删除作品 |
| `ArtifactData` | `get`、`list`、`query`、`set`、`update`、`delete`、`str_replace`、`batch` | 带数据存储的类型（白板、看板、短片）里的文档 |
| `ArtifactComments` | `read`、`reply`、`resolve`、`reopen`、`wait` | 页面上的评论线程 |

MCP 客户端声明支持 MCP Apps（`io.modelcontextprotocol/ui`）时，还会拿到 `ShowArtifact`。原生工具的适配器不需要它：页面由适配器自己显示（[在你的界面里显示页面](embedding.zh-CN.md)）。

`ShowArtifact` 的视图从 daemon 在本机的地址框入页面。它的 `_meta.ui.csp.frameDomains` 写明这个源，`_meta["openai/ui"].permissions.loopbackNetwork` 则请把 MCP Apps 放在公网源上的宿主放行这个框架，不然 Chromium 的本地网络访问（Local Network Access）会拦下它。宿主还得把这个 http 源留在视图的 `frame-src` 里：Codex 只保留 https 的框架域名，所以它的卡片会拒绝这个页面。Shell 向父页面发出 `shell_hello`，视图就知道页面显示出来了。视图的 CSP 拒绝框架时（`securitypolicyviolation`），视图会立刻说明，并给出“在浏览器中打开”（Open in browser）和可复制的地址；迟迟没收到 `shell_hello` 时，视图会说页面没显示出来，另外再给一个“重试”（Retry）。`ui/open-link` 失败、返回 `isError` 或 3 秒内没有回应时，视图会提示复制地址。

每次调用返回一个结果对象。除了操作本身的返回内容，它还可能带 `error`（`code`、`message`、`fix`）、`next` 和 `note`（下一步做什么）、`notes`（例如归属变化之类的提示）、`current`（冲突时较新的内容），以及 `messages`（调用方收件箱里等着的消息：评论也会这样送到）。

## 调用方

每次调用都应当写明来自哪个会话：作为 `call` 的第三个参数传 `{ session, workspace }`，或在 `tools.call` 里传 `caller`。调用方决定：

- **归属。** 创建作品的会话拥有它。作品上的评论和请求只唤醒这个会话。
- **新作品放在哪里。** `workspace` 是项目目录；没有工作目录的调用方用主目录。
- **权限。** `session.attach` 时声明的这个会话能做的事（[见下](#会话权限)）。

不带调用方的调用算 harness 自己的。它能用，但它做出的作品没有所有者，所以作品上的评论会进共享收件箱，等哪个会话来取。

## 操作类别：哪些调用要确认

`tools.list` 给出每个工具的 `actions`：从操作到类别的映射（功能 `tools.actions`）。MCP 把它放在 `_meta["open-artifact/actions"]` 里。

| 类别 | 含义 | 操作 |
| --- | --- | --- |
| `read` | 只读 | `Artifact` 的 `quickstart`、`list`、`read`；`ArtifactData` 的 `get`、`list`、`query`；`ArtifactComments` 的 `read`、`wait` |
| `write` | 写作品自己的目录或存储 | `Artifact` 的 `publish`、`call`；`ArtifactData` 的其余操作，包括 `delete`（它删除一个文档）；`ArtifactComments` 的 `reply`、`resolve`、`reopen` |
| `ui` | 改变人看到的内容 | `Artifact` 的 `open` |
| `remove` | 删除作品，或从别的会话手里拿走作品 | `Artifact` 的 `delete`、`adopt` |
| `person` | 只是报告人做的事 | `Artifact` 的 `share` |

用类别来设计你自己的审批提示，别用操作名列表。把总是要确认的类别写进 profile 的 `policy.confirm`；skill 会告诉 Agent 这些操作由人批准。

不带 `action` 的 `Artifact` 就是 `publish`。

## 哪些数据会离开电脑

`tools.list` 还给出每个工具的 `remoteActions`（功能 `types.remote`；MCP：`_meta["open-artifact/remote-actions"]`）：当作品的类型是远程类型（页面在另一台电脑上）时，会把作品数据发到该类型地址的那些操作。

| 工具 | 会到达远程类型的操作 |
| --- | --- |
| `Artifact` | `publish`（创建时会打开它的页面）、`open`、`call`、`share` |
| `ArtifactData` | 全部操作 |
| `ArtifactComments` | 除 `wait` 外的全部操作 |

本机上的类型什么也不会发出电脑。只有装了启用状态的远程类型时，工具注解 `openWorldHint` 才是 `true`。类型在所有列出它的地方都会带 `remote`（和 `origin`），所以你的 Agent 和界面在调用前就能知道。本机路径永远不会发给远程类型：这样的调用会被以 `unsupported` 拒绝。详情见[远程类型](remote-types.zh-CN.md)。

## 类型从哪里来

类型在所有列出它的地方（`quickstart`、`list scope: "types"`、`read {type_url}`）以及读取作品时都会带 `source`（功能
`types.source`）：`builtin`、`local`（这台电脑上的文件夹）或 `installed`（别人做的包，用 `open-artifact types install`
安装）。安装的类型还带 `installed_from`（它来自的文件或地址）和 `third_party_notice`：一句固定的话，说明它的指令、
标题和描述是发布者写的，不是人写的；`publish`（新建）和 `adopt` 会把这句话放在 `instructions` 旁边。你的界面显示
安装的类型的指令时，把它也显示出来，并且永远不要让这些指令的分量超过人说的话。人还没信任的项目里的类型
（`trusted: false`）也以同样方式带着它自己的 `third_party_notice`。

读取这两种类型的作品时也带 `third_party_notice`，说明读到的东西可能是类型的页面写的：`ArtifactData` 和
`ArtifactComments` 的读取、`Artifact` 读 `path` 或 `paths` 时带这句话；完整读取 `Artifact` 时先是类型的说明，后面
接这句话。显示这种作品里的任何内容时，把它一起显示出来。

作品会记下它的类型的 `uid`。这里同 id 的类型 uid 不同时，`open` 和所有写入都会以 `type_mismatch` 拒绝；读取仍然可以。

## 会话权限

会话可以受限，例如一个只能读、不能删的子 Agent。在挂上会话时声明（功能 `session.may`）：

```js
await oa.attach({ session: 'sub-7', workspace, role: 'subagent', may: { create: false, remove: false } });
```

| 字段 | 拒绝的操作 |
| --- | --- |
| `create` | 带 `type_url` 的 `Artifact` `publish`；对一个目录的 `adopt` |
| `modify` | 带 `url` 的 `Artifact` `publish`；效果为 `write` 的 `call`；对无主作品或自己作品的 `adopt`；`ArtifactData` 里类别为 `write` 的每个动作（`set`、`update`、`delete`、`str_replace`、`batch`） |
| `remove` | `Artifact` `delete`；对别的会话作品的 `adopt` |
| `reply` | `ArtifactComments` 的 `reply`、`resolve`、`reopen` |

不写的字段表示允许。读操作永远不会被拒绝。`role` 是会话的种类名：profile 的 `policy.roles` 给每种角色定默认权限，`may` 叠加在上面。拒绝时返回 `not_granted`，附一句说明角色的话，以及一行告诉 Agent 改做什么的修复提示（在回复里给出结果、去问人）。

daemon 没看到挂上的会话可以做任何事。权限让守规矩的 Agent 不跑偏；它们不是针对以人的身份运行的代码的安全边界（[安全](security.zh-CN.md)）。

## Agent 自己写的文件

有些类型就是一个装文件的目录（Design、Slides），你的 Agent 可能用自己的文件工具写它们，而不是用 `Artifact publish`。报告这些写入：

```js
await oa.wrote(['/path/to/artifact/project/slide-1.html'], { session: 'chat-1', workspace });
```

`agent.wrote` 接受绝对路径（相对路径按调用方的工作目录解析）。daemon 找出这些路径所属的作品，把它们的链接作为 `artifacts` 返回。对每个作品，它记下 Agent 此刻已经看过它（之后只有人的修改才算 `changed_files`），作品发布到站点时把变化同步过去，并应用下面的归属规则。通过工具做的写入不需要报告。

## 归属怎么转移

一个作品只有一个所有者会话。不用 `adopt`，它在两种情况下会转移：

1. **唤醒被转交。** 你的适配器回答唤醒时用 `{ status, session }` 指明了你的另一个会话（一个结束的线程把消息交给了它的协调者）。从此这个会话拥有该作品（功能 `wake.session`）。
2. **所有者不在时，同一 harness、同一工作目录的另一个会话写了它。** “不在”指：没有挂上、无法恢复（该 harness 没有适配器声明 `wake.resume`），并且两小时内没出现过（`OPEN_ARTIFACT_OWNER_GONE_MS`）。算数的写入有：用 `Artifact publish` 写文件，用任何 `ArtifactData` 写操作写行（`set`、`update`、`delete`、`str_replace`、`batch`：上面类别为 `write` 的每个动作），效果为 `write` 的类型操作，以及 `agent.wrote`。所有者还在时，写入方的下一个结果会在 `notes` 里提示一次：这是谁的作品，`adopt` 可以接手。

归属不会自己跨 harness 或跨工作目录转移。

## 新版本写过的作品

如果一个作品最后是被比本机已装版本更新的类型版本写的，工具会把它当成只读：读取和打开的结果带 `read_only: true` 和一条提示；写入（带 `url` 的 `Artifact publish`、`Artifact call`、`ArtifactData` 的写操作）会以 `newer_release` 拒绝，修复提示让人去更新。旧格式永远不会覆盖新格式。评论仍然开放：`ArtifactComments` 仍可回复、解决和重新打开，这样在作品等更新期间，Agent 仍能回答人。

在页面上，Shell 会显示一行，说明是哪个版本写的、怎么更新；内置类型服务器把每个访问者都当作查看者，所以页面也无法保存。页面自己的评论框也一样：页面上的评论遵循查看者角色，处于关闭状态；只有 Agent 的工具仍可回复。

## 另见

- [唤醒](wake.zh-CN.md)：结果里的 `messages` 是什么，以及它们的其他送达方式。
- [Harness API 参考](../spec/harness-api.zh-CN.md)：`tools.list`、`tools.call`、`agent.wrote`、`artifact.open`。
- [Agent 使用指南](../agent-guide.zh-CN.md)：从 Agent 这一侧看这些工具。
