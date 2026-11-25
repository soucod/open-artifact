# 已知限制

[English](limits.md)

读完后你知道哪些还不能用、哪些没有测试过，以及在此期间怎么办。每一条都写明它在哪里出现。

## 页面

| 限制 | 在此期间 |
| --- | --- |
| 由站点提供的 Shell（在站点地址上打开的已发布作品）读不到 daemon 声明的源，所以把每个宿主都当作未声明：`new_session` 的提示为空，`comment_summon` 的文本为空，没有 `open_external`、`saved_file` 和目的地。 | 嵌入本地视图地址（`viewUrl`），不要嵌入站点地址。 |
| 从 `file://` 加载的页面源是 `null`，无法声明。 | 用自定义协议提供你的界面，或改用顶层视图。 |
| 新版本类型写过的作品在这台电脑上是只读的，页面的评论框也一样。 | 页面和工具的 `newer_release` 错误会告诉人去更新；Agent 的工具仍可回复评论。 |

## 示例

| 限制 | 在此期间 |
| --- | --- |
| `examples/harness-electron` 按 Electron 的 API 编写，但没有在 Electron 里运行过。它共用的模块通过 `examples/harness-node` 测试。 | 把它当作 webview 检查清单的参考，并测试你自己的应用。 |

## 运行时

| 限制 | 在此期间 |
| --- | --- |
| 更新的来源证明只做记录，不做校验。压缩包会按注册表的 sha512 摘要校验。 | 需要更多保证时用 `bundled`，随应用附带运行时。 |
| 给没有 Node 的应用用的单文件可执行程序还没有发布；每个应用要在每个平台上用官方 Node 25.5 或更高版本自己构建。 | 用 `node scripts/build.mjs --only sea` 构建，或要求电脑上装有 Node 22.18 或更高版本。 |
| 在 PowerShell 里，单文件可执行程序的 daemon 交给 Agent 的命令以带引号的程序路径开头，必须用 `&` 调用；daemon 的文本不会加它。 | 让 Agent 加上 `&`，或在别的 shell 里运行这条命令。 |
| 单文件可执行程序只在 macOS arm64 上构建和测试过。 | 依赖它之前，在你发布的每个平台上测试它。 |

## 唤醒

| 限制 | 在此期间 |
| --- | --- |
| 在 Windows 上 nudge 只运行 `.exe`；`.cmd` 或 `.bat` 会被跳过并记录日志，因为 Node 只能通过 shell 运行它们。 | 让 nudge 指向 `.exe`，或依靠收件箱和 hook。 |
| HTTP 轮询适配器收不到事件，也不能显示页面。 | 用 WebSocket 或 stdio 桥。 |
| 没有所有者的作品（由没带 caller 的调用创建）的唤醒放在共享收件箱里。 | 始终传 caller。 |

## 检查

| 限制 | 在此期间 |
| --- | --- |
| 一致性检查（`doctor --session`）看不到需要人或真实浏览器的部分：这些部分给出 `n/a`。 | 自己在页面上点一遍（[测试](testing.zh-CN.md#一致性检查)）。 |
| `harness-compat` 端到端测试套件还不能对 kit 的早期版本运行：kit 还没有发布。 | 对着你支持的最旧 daemon 版本运行你的测试。 |

## DeepSeek Harness (DSH)

DSH 插件是 L3 接入。由于缺少 DSH 的 API，有三件事没有接上：一个回合创建的作品的卡片、人在页面上的选择作为上下文，以及 DSH 自己的工具写文件时的 `agent.wrote`。

## 安全

会话权限和仅限本人的命令让诚实的 Agent 走在正路上；它们拦不住以人的身份运行的代码（[安全](security.zh-CN.md#它不做什么)）。

受限类型（安装的，或者还没信任的项目里的）的页面从自己的框架里到不了别的源，但它仍然能通过每个页面都有的途径把
文字送到 Agent 面前：发给 Agent 的评论（`comments.sendToAgent`）、发给 Agent 会话的消息
（`room.sendToAgentSession`、`/api/frame/agent`）和它建议的标题（`proposeTitle`）。这些交给 Agent 时都是页面的话，
不是人的话；Agent 从这种作品读回来的内容带着页面内容的 `third_party_notice`（[安全](security.zh-CN.md#类型包)）。
单独在标签页里打开页面地址时，有页面的策略，但没有框架的沙盒。
