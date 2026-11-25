# 连接你的电脑和 Agent

[English](connecting-agents.md)

**做完以后**，你电脑上的 Open Artifact 连上了一个站点，你发布的作品有了一个网址，电脑关机也能打开；如果你愿意，新建的
作品还会自动发布。没法在本地运行 Open Artifact 的 Agent，可以通过远程 MCP 使用站点。

**开始之前**你需要一个运行中的站点（[hosting.zh-CN.md](hosting.zh-CN.md)）、站点上的一个账号（owner key，或者别人为你
配置好的登录方式），以及在你的 Agent 应用里装好的 Open Artifact（见主 [README](../README.zh-CN.md)）。

> **如果你是替人操作的 Agent**
>
> - 这些要问，不要猜：连哪个站点、给它起什么名字；新建的作品要不要自动发布；仪表盘的数据能不能放到站点上（查询结果会
>   被所有能打开它的人看到）。
> - 只有人能做：在站点上批准这台电脑；打开“自动发布新建的作品”；选择默认站点；发布仪表盘的数据；批准远程 MCP 客户端。
>   工具故意不让 Agent 做这些。
> - 不要打印密钥：Link 令牌（`oa_rt_…`）和 OAuth 令牌。令牌放在权限 600 的 `preset.json` 里；告诉人路径。
> - 每一步确认后再做下一步。同一步失败两次就停下来报告。

**用词。** “连接站点”在命令行里是 `remote add`：一个 **remote** 就是这台电脑连接的一个站点，用你起的短名字称呼（`work`、
`home`）。这个连接在代码和日志里叫 **Link**。你电脑上的 Open Artifact 就是 **daemon**。

**命令。** 下文的 `open-artifact` 是每个插件和 skill 都带的命令行工具。怎么运行它，看你在哪里：

| 在哪里 | 运行 | 检查过 |
| --- | --- | --- |
| 装了 Open Artifact 插件或 skill 的 Agent 应用所在的电脑 | `node <skill folder>/scripts/open-artifact.mjs`，`<skill folder>` 是装好的 `open-artifact` skill（比如插件包里的 `codex/skills/open-artifact`） | 运行过（从仓库里，见下一行） |
| 这个仓库的克隆 | `node skills/open-artifact/scripts/open-artifact.mjs`。它运行的是 `skills/open-artifact/vendor/`；`npm run build` **不会**重建这个文件夹，所以拉取新代码后要运行 `node scripts/build-skill.mjs`（没有 `vendor/` 时它直接从源码运行 daemon） | 运行过 |
| 任何装了 Node 22.18 或更高版本的地方 | `npm install -g @open-artifact/cli`，然后用 `open-artifact` | 没有运行（这个包在 npm 上：`npm view @open-artifact/cli bin` 回答 `{ 'open-artifact': 'scripts/open-artifact.mjs' }`） |

设个别名能少打字：`alias open-artifact='node /path/to/skills/open-artifact/scripts/open-artifact.mjs'`。

**一台电脑的 Open Artifact 都放在一个文件夹里**，即 `OPEN_ARTIFACT_HOME`（默认 `~/.agents/open-artifact`）：设置、站点、
它认识的作品，还有日志 `<OPEN_ARTIFACT_HOME>/logs/daemon.log`。这个文件夹没有 daemon 在运行时，任何 `open-artifact` 命令都
会启动一个，端口取自它的 `settings.json`（`serverPort`，默认 4800，被占用时用下一个空闲端口）。daemon 启动时日志里有
`daemon <version> listening at …`，自己停下时有 `daemon <version> stopped (<原因>)`：`SIGTERM`（`open-artifact daemon stop`
发的就是它）、`SIGINT`、`SIGHUP`、`idle`，或 `leaving for runtime <version>`。日志结尾没有这一行，说明那个 daemon 是被
强行结束的。想**不碰你自己的 Open Artifact** 试一个站点，就在第一条命令之前，给这次试用单独的文件夹和端口：

```bash
export OPEN_ARTIFACT_HOME=/tmp/oa-try
mkdir -p $OPEN_ARTIFACT_HOME
echo '{"serverPort": 4978}' > $OPEN_ARTIFACT_HOME/settings.json
```

（`OPEN_ARTIFACT_PORT=4978` 在一个 shell 里有同样效果。）也可以自己启动 daemon，让它在单独的终端里一直运行：

```bash
open-artifact daemon run --port 4978
```

**预期：** `open-artifact daemon at http://127.0.0.1:4978`

> **注意。** 换了新的 `OPEN_ARTIFACT_HOME` 却没给它自己的端口，第一条命令会在 4800 上再启动一个 daemon，而 4800 正是你自己
> 的 daemon 用的端口：如果那时你的 daemon 恰好停着，试用的 daemon 就占了这个端口，你的 Agent 应用下次启动的 daemon 只能用
> 4801，它们之前给出的页面地址就打不开了。

**运行了什么。** 下面每个命令行步骤，都在写这篇指南时对同一台电脑上的一个站点运行过（`http://127.0.0.1:4977`，作品在
`127-0-0-1.nip.io` 上），用的是上面那样单独的 `OPEN_ARTIFACT_HOME` 和 4978 端口；**预期：**里的内容抄自那次运行，只是把
站点地址写成了 `https://artifacts.example.com`。各个应用的说明来自 `plugins/README.md`，那里写了每个应用是怎么检查的。
远程 MCP 是用 curl 充当客户端运行的。

## 把电脑连接到站点

### 1. 添加站点

```bash
open-artifact remote add work https://artifacts.example.com
```

**预期**（浏览器打开批准页面）：

```
Opened https://artifacts.example.com/link/device?user_code=HRHX-MHGN in your browser: check that it shows the code HRHX-MHGN, then approve.
Waiting for the approval...
```

命令会一直等，直到代码被批准、被拒绝或过期（几分钟）。在没有浏览器的电脑上（服务器、SSH 会话），或者想在另一台设备上
批准，加 `--no-browser`：

```bash
open-artifact remote add work https://artifacts.example.com --no-browser
```

**预期：**

```
Open https://artifacts.example.com/link/device?user_code=GXKR-DLVC in a browser where you are signed in to the site, check that it shows the code GXKR-DLVC, then approve.
Waiting for the approval...
```

浏览器没能打开时，也输出这一行。

### 2. 批准（由人来做）

页面上写着（带你自己的代码）：

> **Link a computer**：Open Artifact daemon 请求关联到你的账号，自称 open-artifact 0.14.6，代码 HRHX-MHGN，你当前以
> Owner 身份登录。关联后，它可以把作品发布到这个站点，读取和修改你在这里拥有的作品，并收到发给你的 Agent 的评论和请求。
> 页面提醒：只批准你自己发起的代码。

（站点界面是英文的，上面是大意。）核对代码一致，然后点 **Approve**。终端随后输出：

```
Linked work (https://artifacts.example.com) as Owner.
```

（`Owner` 是 owner key 账号的名字；其他账号显示自己的名字或邮箱。）

**完全不用浏览器（仅限测试）。** 批准就是一次普通的表单提交，所以手里有这个人会话 cookie 的脚本也能批准代码。写这篇指南
的那次运行就是这样批准的，用的是站点启动时打印的 owner key；这只用来测试你自己运行的站点，绝不能用来替别人批准：

```bash
# 仅限测试：用 owner key 登录（会话存进 cookie 文件），再批准代码。
curl -s -o /dev/null -c jar -H 'Origin: https://artifacts.example.com' \
  --data-urlencode "key=$OWNER_KEY" https://artifacts.example.com/auth/owner-key
curl -s -b jar -H 'Origin: https://artifacts.example.com' \
  --data 'user_code=GXKR-DLVC&decision=approve' https://artifacts.example.com/link/device
```

第二条回答 200，页面上写着 “Open Artifact daemon is linked.”；还在等待的 `remote add` 随后输出
`Linked work (…) as Owner.`（`decision=deny` 是拒绝。）`Origin` 头可以不带（没有浏览器 `Sec-Fetch-Site` 头的客户端，站点
看的就是它）；写成别的源会被拒绝，返回 403 `Cross-site requests may not change anything here.`

**检查：**

```bash
open-artifact remote status
```

**预期：**

```
work (https://artifacts.example.com): signed in as Owner, connected
  nothing published
```

**失败时：**

- `a host must use https (http only on this computer or a private network: …)`：地址是公网名字上的 `http://`。改用 https。
  在你信任的网络里，可以加 `--insecure-http`。
- 对 `nip.io` 地址，它会输出 `Warning: … uses plain http …` 并继续；在内网里这是正常的。
- 代码过期了：重新运行 `remote add`，并在几分钟内批准。

在任意作品的分享面板里也能做同样的事：**发布到网上 > 连接一个站点…**。

登录信息保存在 `<OPEN_ARTIFACT_HOME>/remotes.json`（权限 600）。daemon 把它对站点做的事写进
`<OPEN_ARTIFACT_HOME>/logs/daemon.log`；做完上面几步后，里面有：

```
audit: connecting the site work (https://artifacts.example.com), asked by the open-artifact command line, route remotes.add
link: signed in to work (https://artifacts.example.com) as Owner
```

**移除站点：**

```bash
open-artifact remote remove work
```

**预期：** `Removed the site work: this computer no longer publishes or syncs there.`（加 `--json` 输出同样内容的 JSON。）
如果新作品原本自动发布到这个站点，下一行会说自动发布已经关掉：

```
Automatic publishing went to that site, so it is now off: new artifacts stay on this computer until you publish them. After connecting a site, turn it back on with open-artifact remote auto on.
```

站点上还有已发布的作品时会被拒绝，状态码 1：

```
open-artifact: 1 artifact is published to work: art_0mwrwt1jtf8c269e185698c2e.
  Unpublish it first (open-artifact unpublish <id>), or pass --force to keep it local only.
```

## 发布作品

### 第一个作品：一个文件夹

`publish` 接受一个装着已知类型作品的文件夹（有 `.artifact.json`，或者某个类型自己的文件，比如白板的
`db/board/meta.json`），不管这台电脑认不认识它。新的文件夹会先被加进来，再发布，命令行会多输出一行：

```bash
open-artifact publish ./team-board
```

**预期：**

```
Added /path/to/team-board as open-artifact://artifact/art_0mwrwt1jtf8c269e185698c2e (whiteboard, "Whiteboard element test").
Published to work: https://artifacts.example.com/a/art_0mwrwt1jtf8c269e185698c2e
```

标题用内容里声明的标题（文档或白板的名字），没有的话用文件夹名，站点也会让标题跟着内容走。看不出类型的文件夹会被拒绝，
提示 `No artifact in <folder>.`，修复建议里给出带 `type_url` 的 `adopt` 调用。

这台电脑已经有的作品，用它的 id 发布：`open-artifact publish art_0mwrnigw79b6e26beae1fac85` 回答
`Published to work: https://artifacts.example.com/a/art_0mwrnigw79b6e26beae1fac85`。`--remote <name>` 指定默认站点以外的
站点。在分享面板里：**发布到网上 > 发布**。除非人为那个站点允许过（见下文），Agent 不能自己发布。

**检查：** `open-artifact remote status` 列出了它：

```
work (https://artifacts.example.com): signed in as Owner, connected
  art_0mwrwt1jtf8c269e185698c2e  "Whiteboard element test"  https://artifacts.example.com/a/art_0mwrwt1jtf8c269e185698c2e
    in sync (2026-11-22T14:05:36.037Z)
```

`daemon.log` 里有 `link: published art_0mwrwt1jtf8c269e185698c2e to work (https://artifacts.example.com/a/…)`。

### 确认电脑上的改动到了站点

改一下文件夹里的文件（这里把 `db/board/meta.json` 里白板的标题从 “Whiteboard element test” 改成 “Team board”），等几秒，
然后：

```bash
open-artifact remote status
```

**预期：**新标题和更晚的同步时间：

```
work (https://artifacts.example.com): signed in as Owner, connected
  art_0mwrwt1jtf8c269e185698c2e  "Team board"  https://artifacts.example.com/a/art_0mwrwt1jtf8c269e185698c2e
    in sync (2026-11-22T14:05:39.776Z)
```

`remote status` 里的标题是站点上的；时间是站点最后一次收下改动的时间。写这篇指南的那次运行里，站点 4 秒内就有了新标题
（用这个人的会话请求它的 Library API `GET /api/open-artifact.artifact?id=…`，回答 `"title": "Team board"`）。打开网址也能
看到改动。如果那一行不是 `in sync`，而是 `1 change waiting` 或 `sync failed (…): …`，说明卡在哪里；细节在 `daemon.log` 里。

### 你电脑上的文件夹会怎样

- 它变成**工作副本**。作品现在以站点上的为准。Agent 在文件夹里写的文件几秒内就送到站点（看到过：白板上新加的元素 5 秒内
  出现在站点上），别人在站点上的改动也会回到文件夹。
- 两边改了同一处时，以站点的版本为准，你的版本保存在文件夹的 `_agent/conflicts/` 里。
- 在你电脑上打开这个作品（本地端口上的 `/a/<id>`），站点连得上时会跳到网址；连不上时，本地页面显示工作副本，改动先等着。
- Agent 的截图和导出仍然在你的电脑上、用工作副本完成。
- 分享在站点上设置：打开网址，在那里点**分享**。

### 取消发布

```bash
open-artifact unpublish art_0mwrwt1jtf8c269e185698c2e
```

**预期：** `Unpublished open-artifact://artifact/art_0mwrwt1jtf8c269e185698c2e; it opens at http://127.0.0.1:4978/a/art_0mwrwt1jtf8c269e185698c2e again.`
站点上那份进了站点的回收站，网址失效。文件夹保留，带着站点上的最新改动。之后还可以再发布。

### 在 Agent 的会话里，这些命令会被拒绝

有 shell 的 Agent 也能运行这个命令行，所以命令行会查找 Agent 应用给 Agent 的命令设置的变量，只要设了其中一个，就拒绝
`publish`、`unpublish`、`remote add`、`remote remove`、`remote default` 和 `remote auto`。完整列表
（`packages/daemon/src/agent-session.ts`）：

| 变量 | 由谁设置 |
| --- | --- |
| `CLAUDECODE`、`CLAUDE_CODE_SESSION_ID` | Claude Code |
| `CODEX_THREAD_ID` | Codex |
| `ANTIGRAVITY_AGENT`、`ANTIGRAVITY_CONVERSATION_ID` | Antigravity |
| 每个 Agent 应用配置的 `sessionEnv` | `<OPEN_ARTIFACT_HOME>/harnesses/*.json` 里的配置，以及 Open Artifact 自带的配置（自带的没有比上面更多的变量） |

`remote status`、`remote list`、`daemon …` 和 Agent 自己的工具不受影响。在这里只设了 `CLAUDE_CODE_SESSION_ID` 时运行过：

```
open-artifact: Turning automatic publishing on or off is the person's decision, and this command runs inside an agent session (claude-code: CLAUDE_CODE_SESSION_ID is set), so it was not done.
Ask the person to switch it in an artifact’s Share panel, or to run `open-artifact remote auto on` in their own terminal.
```

设了 `CODEX_THREAD_ID` 时：

```
open-artifact: Taking an artifact off its site is the person's decision, and this command runs inside an agent session (codex: CODEX_THREAD_ID is set), so it was not done.
Ask the person to unpublish it from the artifact’s Share panel, or to run `open-artifact unpublish art_0mwrwt1jtf8c269e185698c2e` in their own terminal.
```

命令以状态 1 结束。**Agent 接下来该做的：**把第二行原样转告给人（用分享面板，或者在他们自己的终端里运行那条命令），然后
等着。不要取消那个变量、不要改 `settings.json`、也不要直接调用 daemon 的接口来绕过它。人说做好了之后，用
`open-artifact remote status` 检查（在 Agent 会话里可以运行）。

`agentMayPublish`（见下文）只对那一个站点放行 `publish` 和 `unpublish`；其他几个没有办法放行。这是护栏，不是锁：Agent 以
这个人自己的系统用户运行。每次发布、取消发布、数据确认和站点变更，daemon 都会连同是谁要求的一起记进日志
（`asked by the open-artifact command line, route …`）。

**没有终端时，仪表盘上去不带数据行。** 对带实时查询的仪表盘，`publish` 会在终端里问 “This publishes the rows from your
connectors to everyone the dashboard is shared with. Publish the data too? [y/N]”。没有终端可问时（脚本、CI、输出被管道
接走），以及在 Agent 会话里时，它都只发布页面、不带数据行，并说：

```
Its live data was not published: the page there shows no figures until the person publishes the data, from the dashboard's Share panel ("Publish its data") or with `open-artifact publish art_…` in their own terminal, which asks.
```

在 Agent 会话里（`agentMayPublish` 放行了发布时），这行末尾还有 “An agent session never publishes a dashboard's data.”
仪表盘这几行读自 `packages/daemon/src/agent-session.ts`，没有运行（写这篇指南时没有发布带实时连接器的仪表盘）。

## 默认站点和自动发布

- **默认站点**是 `publish` 和分享面板在没有指定时用的站点。第一个添加的站点就是默认站点；只有一个站点时，永远是它。

  ```bash
  open-artifact remote default work
  ```

  **预期：** `The default remote is work.`（`remote default --clear` 清掉这个选择；只有一个站点时，它仍然是默认站点。）

- **自动发布新建的作品**：打开之后**新建**的每个作品，都会在后台发布到默认站点。Agent 的工具调用会立刻返回；发布完成前，
  它的 `view_url` 是本地地址。失败会自动重试，并显示在 `remote status` 和分享面板里。之前建的作品、以及你取消发布过的
  作品，都不会动。

  ```bash
  open-artifact remote auto on
  ```

  **预期：** `New artifacts are now published to work by themselves (artifacts made before are left as they are).`
  `remote auto off` 回答 `New artifacts are published only when you publish them.`

  分享面板里有同样的开关 **自动发布新建的作品**，连了不止一个站点时还有 **默认站点** 选择框。没有哪个 Agent 工具能改
  这两项。

- **允许 Agent 发布。** 默认情况下，`Artifact {action: "share", url, cloud: "<site>"}` 会被拒绝，提示
  “Only the person publishes an artifact to the cloud”。人可以在 `<OPEN_ARTIFACT_HOME>/settings.json` 里为某一个站点允许：
  `{"remotes": {"work": {"agentMayPublish": true}}}`。在这里没有运行。

## 提前配置电脑

给团队、统一管理的笔记本或 CI 机器用时，可以在安装时就把站点交给 daemon。它在启动时读取一次这些设置：

| 环境变量（也是 `preset.json` 的键） | 含义 |
| --- | --- |
| `OPEN_ARTIFACT_REMOTE` | 站点地址。只添加一次，作为默认站点。 |
| `OPEN_ARTIFACT_REMOTE_NAME` | 它的短名字。默认取主机名的第一段（`oa.example.com` 得到 `oa`）。 |
| `OPEN_ARTIFACT_REMOTE_TOKEN` | 一个 Link 令牌：不用浏览器批准，直接登录一次。没有它时，daemon 发起一次批准，把链接显示在 `remote status`、分享面板和 Agent 下一次工具调用的结果里。 |
| `OPEN_ARTIFACT_PUBLISH` | `auto`（自动发布新建的作品）或 `manual`。 |
| `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP` | `1`：即使地址不是内网的，也允许这个地址用 http。 |
| `OPEN_ARTIFACT_PLUGIN_REMOTE` | 由插件自己的设置填写（Claude Code、Cursor）；只在没设 `OPEN_ARTIFACT_REMOTE` 时使用。 |

`<OPEN_ARTIFACT_HOME>/preset.json` 接受同样的键，给不传递环境变量的应用用：

```json
{
  "OPEN_ARTIFACT_REMOTE": "https://artifacts.example.com",
  "OPEN_ARTIFACT_REMOTE_NAME": "work",
  "OPEN_ARTIFACT_REMOTE_TOKEN": "oa_rt_…",
  "OPEN_ARTIFACT_PUBLISH": "auto"
}
```

位置：macOS 和 Linux 上是 `~/.agents/open-artifact/preset.json`，Windows 上是
`%USERPROFILE%\.agents\open-artifact\preset.json`。里面有令牌时，让它只有你能读：

```bash
chmod 600 ~/.agents/open-artifact/preset.json
```

（别人也能读、又含令牌的 `preset.json` 仍然会被使用，同时在 `daemon.log` 里留一条警告。）

**谁优先**，从高到低：人自己设置的（`settings.json`、`remotes.json`、命令行、分享面板），然后是环境变量，然后是
`preset.json`，最后是默认值。预设只添加一次站点：人删掉的站点不会被加回来，用过的令牌不会再发送。地址、名字和令牌是
一组：`preset.json` 里的令牌不会和环境变量里的地址配对。仍然写成 `${…}` 的值（应用没有替换）当作没设。已经在运行的
daemon 保留它启动时的设置：运行 `open-artifact daemon stop`，下一次工具调用会重新启动它。

### 生成 Link 令牌

在 **Node 站点**上，在服务器上，用和站点相同的环境（这样它输出的地址才对）：

```bash
node packages/host/src/node/main.ts link-token --user ada@example.com --label "Ada laptop"
```

**预期：**

```
A Link token for ada@example.com (agt_WYqw6wWyaEWampMsO1X_xg) on the site at https://artifacts.example.com. It is shown this once; set it on the computer as
  OPEN_ARTIFACT_REMOTE=https://artifacts.example.com
  OPEN_ARTIFACT_REMOTE_TOKEN=oa_rt_…
It is good for one sign-in within 90 days. Revoke it: open-artifact-host link-token --revoke agt_WYqw6wWyaEWampMsO1X_xg
```

用 Docker 时：`docker compose exec host node packages/host/src/node/main.ts link-token --user …`（在这里没有运行）。如果
运行时没有站点的 `OA_APP_ORIGIN`，它会输出 `http://localhost:4900`，并警告这只是默认地址：要用大家实际打开的地址。账号不
存在时会被创建，那个邮箱算作已验证。

撤销：`link-token --revoke agt_…` 回答 `Revoked agt_…: the computer that used it is signed out.`

在 **Cloudflare 站点**上，用管理 API（[hosting-cloudflare.zh-CN.md](hosting-cloudflare.zh-CN.md#cloudflare-上的-link-令牌)）。

### 检查预设

在这里用环境变量的形式运行过：一个新的 `OPEN_ARTIFACT_HOME`，它的 `settings.json` 给了单独的端口，令牌是上面
`link-token` 打印的。第一条命令带着这些变量启动 daemon：

```bash
OPEN_ARTIFACT_REMOTE=https://artifacts.example.com \
OPEN_ARTIFACT_REMOTE_NAME=work \
OPEN_ARTIFACT_REMOTE_TOKEN=oa_rt_… \
OPEN_ARTIFACT_PUBLISH=auto \
open-artifact remote status
```

**预期：**

```
work (https://artifacts.example.com): signed in as ada@example.com, connected
  nothing published

New artifacts are published automatically to work.
```

`<OPEN_ARTIFACT_HOME>/logs/daemon.log` 显示：

```
link: added the preset remote work (https://artifacts.example.com)
link: signed in to work (https://artifacts.example.com) with the preset token as ada@example.com
```

Agent 建了一个作品之后（这里是对一个白板文件夹调用 `Artifact {action: "adopt"}`），一秒之内：

```
link: published art_0mwrwucojb833c54804e959cb to work (https://artifacts.example.com/a/art_0mwrwucojb833c54804e959cb)
link: published art_0mwrwucojb833c54804e959cb to work by itself
```

如果设变量时 daemon 已经在运行，它不会读到这些变量：运行 `open-artifact daemon stop`，再运行一次命令。`preset.json` 里
同样的键也按同样方式读取（`packages/daemon/src/preset.ts`）；这种形式在这一版指南里没有运行。

## 各个 Agent 应用

一台电脑上的所有应用共用一个 daemon，所以**最先启动它的应用决定它的环境**。各个应用传递的东西不一样（来自
`plugins/README.md`，那里记录了每个应用是怎么检查的）：

| 应用 | 指向站点 | 自动发布 | 检查情况 |
| --- | --- | --- | --- |
| Claude Code | 插件的 **Open Artifact server** 设置（启用插件时会问）；或者启动 `claude` 的环境里的 `OPEN_ARTIFACT_REMOTE`；或者 `preset.json` | 在同样的地方设 `OPEN_ARTIFACT_PUBLISH=auto`，或者在 `preset.json` 里；或者 `remote auto on`、分享面板 | 用探针服务器运行过 |
| Codex | **只能用 `preset.json`。** Codex 启动 MCP 服务器时只传一小串固定的变量，你 shell 里的变量永远到不了 | `preset.json` 里写 `"OPEN_ARTIFACT_PUBLISH": "auto"`；或者命令行、分享面板 | 读了 Codex 的源码；没有运行 |
| Cursor | 团队管理员在 Cursor 控制台设置 **Open Artifact server**（`OPEN_ARTIFACT_SERVER`）；或者启动 Cursor 的环境里的 `OPEN_ARTIFACT_REMOTE`；或者 `preset.json` | 同 Claude Code | 用探针跑过 cursor-agent；控制台设置和 Cursor 应用本身没试 |
| GitHub Copilot CLI | 启动 `copilot` 的环境里的 `OPEN_ARTIFACT_REMOTE`，或者 `preset.json` | 同 Claude Code | 用探针运行过；VS Code 的 agent 模式没试 |
| Antigravity | `preset.json` | `preset.json`、命令行或分享面板 | 读了文档；没有运行 |
| DeepSeek Harness | 它运行时的环境，或者 `preset.json` | 同 Claude Code | 读了插件代码；没有运行 |
| 网页版 ChatGPT | `open-artifact chatgpt` 的环境，或者 `preset.json` | 同 Claude Code | 读了代码；没有运行 |
| 任何带 skill 的 Agent | Agent 运行 `open-artifact` 时的环境，或者 `preset.json` | 同 Claude Code | 读了代码；没有运行 |

从 Dock 或开始菜单打开的应用看不到你 shell 配置文件里的变量：用 `preset.json`。拿不准时，`preset.json` 对所有应用都有效。

## 远程 MCP

没法在自己电脑上运行 Open Artifact 的 Agent（托管的 Agent、手机应用）可以直接用站点上的 `<应用源>/mcp`（基于 streamable
HTTP 的 MCP）。它以批准它的那个人的身份、带着那个人的角色行事。

1. 在 MCP 客户端里添加服务器，地址填 `https://artifacts.example.com/mcp`。其余的客户端会自己找到：未认证的调用回 401，带着

   ```
   www-authenticate: Bearer resource_metadata="https://artifacts.example.com/.well-known/oauth-protected-resource/mcp", scope="artifacts.read artifacts.write comments share.read"
   ```

   元数据里写明了授权服务器（`/oauth/authorize`、`/oauth/token`、`/oauth/register`、`/oauth/revoke`；OAuth 2.1 加 PKCE）。
   客户端可以自己注册，可以用 Client ID Metadata Document（一个 https 的 client id），也可以由站点管理员写进
   `OA_OAUTH_CLIENTS`。
2. 人在需要时登录站点，然后看到授权页面（英文界面，大意如下）：

   > **Connect an app**：Test MCP client 请求以你的身份在这个站点上使用 Open Artifact。它运行在 127.0.0.1:9，授权后会把
   > 你送回那里。这个应用是自己注册的，名字未经验证。它将能够：查看你在这里能打开的作品并读取文件；新建作品、修改你能
   > 编辑的作品；读取和回复评论，收到发给你的 Agent 的评论和请求；查看你的作品是怎么分享的。

   **Allow** 把客户端送回去，带一个代码，客户端用它换取令牌（有效期 3600 秒，由客户端刷新）。
3. 工具有 `Artifact`、`ArtifactComments`、`ArtifactData` 和 `ShowArtifact`。

**检查：** 让 Agent 列出你的作品（`Artifact {action: "list"}`）；它会显示作品和你的角色。

在这里用 curl 当客户端运行过：注册、授权、令牌、`initialize`（服务器 `open-artifact 0.14.6`）、工具列表、`list` 和
`snapshot`。没有用真实的 Agent 应用运行过；各个应用添加带 OAuth 的 MCP 服务器的方式不同（比如“自定义连接器”或
`mcp add --transport http`），见应用自己的文档。

能做和不能做的：站点上不生成图片。`Artifact {action: "call", name: "snapshot"}` 返回一个 5 分钟内有效的只读页面地址
（`page_url`，1440×900），给能自己打开页面的客户端用。导出和 PDF 需要某个人的浏览器或一台连接着的电脑。浏览器里的客户端
必须从应用源，或 `OA_MCP_ORIGINS` 里列出的源发起调用。

## 仪表盘和它的数据

数据仪表盘的实时查询通过**连接器**运行，而连接器只在所有者的电脑上。站点从不运行它们。所以，对已发布的仪表盘，所有者的
电脑运行查询，把结果放到站点上，那边的页面显示结果，并注明 **数据截至 <时间>，来自 <所有者> 的电脑**。

- **谁来决定。** 你在分享面板里自己发布仪表盘时，它的数据也一起发布；在你自己终端里运行 `open-artifact publish` 会先问
  （[见上文](#发布作品)），没有终端时不带数据行。在你按发布之前，分享面板会说明：“发布这个仪表盘也会发布它的数据：这台电脑运行它的实时查询，把结果放到站点上，能打开它的人都看得到。”自动发布
  或 Agent 发布的仪表盘**不带**数据上去；这时分享面板显示“它的实时数据还没上站点：在你发布数据之前，那边的页面没有数字。”
  和一个 **发布它的数据** 按钮。只有人能按它。
- **什么时候刷新。** 发布的时候；有人在站点页面上按 **刷新** 的时候（所有者，或者所有者允许编辑者使用 Agent 时的编辑者）；
  以及电脑连接期间按定时器刷新，默认每 6 小时一次。你的电脑关机时请求的刷新，会等它回来再执行。
- **为什么只是每 6 小时。** 每次刷新都要对你的数据源跑一遍所有已发布仪表盘的所有实时查询，而大多数数据仓库按查询计费；
  你的电脑也可能在睡眠。需要更新的数字时按刷新。想改定时器，在 `<OPEN_ARTIFACT_HOME>/settings.json` 里设分钟数，比如
  `{"cloud": {"dataRefresh": 60}}`；`0` 关掉定时器（发布和刷新照常可用）。
- **让某个查询留在本地。** 在 `source` 旁边写了 `"snapshot": false` 的数据集永远不会离开你的电脑；站点上的读者在它的位置
  看到 “Live data isn't available in this view.”。
- **大小。** 单个查询的结果超过 256 KB 会失败并指出是哪个，绝不会被截断；在查询里先聚合。
- **不会重放的东西。** 站点只重放按仪表盘保存的筛选条件取得的结果。读者自己改的筛选不会重新运行；加载器自己的
  `call(...)` 不会重放（给它单独建一个数据集）。
- **失败时。** 刷新失败会保留上一次的结果；所有者能看到原因（“上次刷新失败：…”）。
- **撤回。** 取消发布会从站点上删掉这些结果。（daemon 也可以只撤回数据的确认，通过它的 `artifacts.data` API 传
  `publish: false`；分享面板暂时没有对应的按钮。）

在这里没有运行：写这篇指南时没有发布过带实时连接器的仪表盘。上面的行为读自 `packages/daemon/src/data-refresh.ts`、分享
面板和数据编辑器；仓库里的 `e2e/host-data.test.mjs` 和 `e2e/cloudflare-data.test.mjs` 覆盖了这些。

## 限制

- 截图、PDF 和视频都在电脑上生成：你的电脑（Agent 用工作副本），或者某个人的浏览器。从不在站点上。
- 站点上仪表盘的数字，只新到所有者电脑最后一次刷新的时候。
- 一个作品同一时间只属于一个站点：要发布到别处，先取消发布。
- 站点每次推送最多接收 100 MiB（Node），Cloudflare 上是 32 MiB。
- 别人已经用同一个 id 发布过的作品，再发布会被拒绝；复制一份，发布那份副本。
