# Harness profile 参考

[English](profile.md)

harness profile 是 daemon 在适配器开口之前（以及之外）对一个 Agent 应用的了解：它的 Agent 怎么调用工具、唤醒怎么到达它、它的 hook、它的规则。本页列出每个字段、谁可以设置它，以及随附的 profile。类型是 `packages/protocol/src/harness.ts` 里的 `HarnessProfile`。

## profile 从哪里来

| 顺序 | 来源 | 文件 | `source` |
| --- | --- | --- | --- |
| 1 | 人自己的，`open-artifact harness add <profile.json>` | `<home>/harnesses/<name>.json` | `user`（或没有） |
| 2 | 你的适配器在 `hello` 里报告的（`profile`） | 同一个文件 | `adapter` |
| 3 | 随 Open Artifact 发布的 | `packages/daemon/harnesses/<name>.json`（用 `$OPEN_ARTIFACT_HARNESS_PROFILES` 换目录） | `shipped` |
| 4 | 以上都没有 | — | 默认值：`level: "L1"`、`entry: "mcp"`、`wake: ["inbox"]`、`agentName: "Agent"` |

- 人自己的文件**替换**随附的 profile（叠在默认值之上）。适配器的报告绝不覆盖它。
- 适配器的报告叠在随附的 profile 之上。适配器不能设置的字段、或形状不对的字段会被丢弃。
- `open-artifact harness list [--json]` 显示每个 harness 生效的 profile 及其来源。
- `open-artifact harness remove <name>` 删除 `<home>/harnesses/` 里的文件；随附的 profile 重新生效。随附的 profile 永远不会被删除。
- `harness add` 和 `harness remove` 由人决定：在 Agent 会话里运行会被拒绝。

## 字段

| 字段 | 类型 | 适配器可设置 | 含义 |
| --- | --- | --- | --- |
| `name` | string | 否（就是 `hello.harness`） | harness 名 |
| `title` | string | 是 | 给人看的名字：Shell 的提问面板、打开会话的按钮和菜单、首页的所有者标记都用它（没有时原样显示 harness 名字） |
| `agentName` | string | 是 | harness 怎么称呼它的 Agent |
| `level` | `L1` \| `L2` \| `L3` | 是 | 简称：只有 MCP、MCP 加 hook、完整适配器 |
| `entry` | `harness-api` \| `mcp` \| `mod` | 是 | harness 怎么连到 daemon |
| `plugin` | string | 是 | harness 插件的包 |
| `mcp` | `{ command, args }` | **否** | 怎么启动 MCP 桥 |
| `sessionEnv` | string | 是 | 工具进程里存放会话 id 的环境变量 |
| `skillsDir` | 路径 | **否** | harness 在哪里找 skill |
| `wake` | `("live" \| "inbox")[]` | 是 | 唤醒路径，按顺序 |
| `wakesIdle` | boolean | 是 | `false`：没有任何办法在空闲会话里开启回合；消息等人的下一个回合 |
| `open` | `"browser"` | 是 | 没有适配器显示时页面去哪里；省略：由 Agent 给出链接 |
| `markers` | string[] | 是 | harness 在其 Agent 的命令里设置的环境变量（设置了它们的地方，仅限本人的命令会被拒绝） |
| `hookDialect` | 名字或映射 | 是 | hook 格式（[见下文](#hook-方言)） |
| `nudge` | `{ command, args, env?, envFile? }` | **否** | 在空闲会话里开启回合的命令 |
| `sessionWorkspace` | `"codex-rollout"` | **否** | 没有人告知时怎么找到会话的目录 |
| `caps` | `AdapterCaps` | 是 | harness 在每个维度上做到哪一步（[Harness API](harness-api.zh-CN.md#adaptercaps)） |
| `policy` | `{ offer?, reuse?, roles?, confirm? }` | 是 | 以数据表示的规则（[见下文](#policy)） |
| `rules` | string，最多 4000 个字符 | 是 | 以文本表示的规则：Agent 最先读到它们，它们优先于随后的指令；不改变任何权限 |
| `commands` | string[] | 是 | harness 的命令名，例如 `["artifact"]` |
| `toolNames` | `{ Artifact?, ArtifactData?, ArtifactComments? }` | 是 | harness 给工具起的名字 |
| `source` | `shipped` \| `adapter` \| `user` | 否 | profile 的来源 |

适配器不能设置的，是会让 daemon 运行命令（`mcp`、`nudge`）、写入某处（`skillsDir`）或读取文件（`sessionWorkspace`）的字段。它们只来自随附的文件或人自己的文件。

### `policy`

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `offer` | `asked`（默认）、`allowed` | 只在被要求时创建作品，或对人允许的类型主动提出 |
| `reuse` | `workspace`（默认）、`session`、`none` | `quickstart` 在多大范围内找可复用的已有作品 |
| `roles` | `{ <role>: { create?, modify?, remove?, reply? } }` | 每种角色的会话可以做什么（[Agent 工具](../integrating/tools.zh-CN.md#会话权限)） |
| `confirm` | `ActionKind[]` | 每次都要人批准的操作类别；skill 会告诉 Agent |

### `nudge`

```json
{
  "nudge": {
    "command": ["${env:OPEN_ARTIFACT_CODEX_BIN}", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", "codex"],
    "args": ["queue", "--thread", "${session}", "--message", "${text}"]
  }
}
```

`command` 是一个程序，或按顺序尝试的一组程序（路径、`~/…`、`PATH` 上的名字，或 `${env:NAME}`；列表里的列表是一个程序加上排在前面的参数）。`args` 里的 `${session}` 和 `${text}` 各自成为一个参数。不使用 shell。`env` 增加变量（`${file.<field>}` 读 `envFile`，`${env:NAME}` 读 daemon 自己的环境）。`envFile` 是 `{ dir, pattern, pid? }`：运行中的应用写的一个 JSON 文件；没有进程存活的文件时，什么都不运行。在 Windows 上只运行 `.exe`。

### Hook 方言

`open-artifact hook <event> --harness <name>` 把 harness 的 hook 事件映射到 daemon 的 `SessionStart`、`UserPromptSubmit` 和 `Stop`。

| 名字 | 使用者 |
| --- | --- |
| `claude-code` | Claude Code、Codex、ZCode |
| `cursor` | Cursor |
| `copilot` | GitHub Copilot |
| `antigravity` | Antigravity |

或者一个映射：`{ events: { <their event>: "SessionStart" | "UserPromptSubmit" | "Stop" }, answer: { <their event>: { field, wrap? } }, session?: [<input field names>], workspace?: [<input field names>] }`。

## `harness add`

`open-artifact harness add <profile.json>` 在写入前检查文件：`name` 必须是合法的 harness 名，`rules` 最多 4000 个字符，`nudge` 是 `{ command, args }`，`markers` 是环境变量名，`hookDialect` 是已知名字或映射，`sessionWorkspace` 是已知名字。不合格的字段会被拒绝，并附一句说明它应有的形状。

```json
{
  "name": "my-agent",
  "title": "My Agent",
  "agentName": "My Agent",
  "level": "L2",
  "entry": "mcp",
  "wake": ["inbox"],
  "sessionEnv": "MY_AGENT_SESSION_ID",
  "markers": ["MY_AGENT_SESSION_ID"],
  "hookDialect": "claude-code",
  "open": "browser",
  "caps": { "tools": "mcp", "commands": { "names": ["open-artifact"] } }
}
```

## 随附的 profile

| 名字 | 级别 | 入口 | 唤醒 | Hook | Nudge | 会话变量 |
| --- | --- | --- | --- | --- | --- | --- |
| `antigravity` | L2 | mcp | inbox | `antigravity` | 有 | `ANTIGRAVITY_CONVERSATION_ID` |
| `chatgpt` | L1 | mcp | inbox（`wakesIdle: false`） | — | — | — |
| `claude-code` | L2 | mcp | inbox | `claude-code` | — | `CLAUDE_CODE_SESSION_ID` |
| `codex` | L2 | mcp | inbox | `claude-code` | 有（`codex queue`） | `CODEX_THREAD_ID` |
| `copilot` | L2 | mcp | inbox（`wakesIdle: false`） | `copilot` | — | — |
| `cursor` | L2 | mcp | inbox（`wakesIdle: false`） | `cursor` | — | — |
| `dsh` | L3 | harness-api | live、inbox | — | — | — |
| `zcode` | L2 | mcp | inbox（`wakesIdle: false`） | `claude-code` | — | — |

除 `chatgpt` 和 `dsh` 外，每个随附的 profile 都写了 `"open": "browser"`。
