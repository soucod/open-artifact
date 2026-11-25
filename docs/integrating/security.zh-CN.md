# 安全

[English](security.md)

读完后你知道 Open Artifact 保护什么、哪些事留给你的应用，以及哪些错误会让一个网页或另一个人冒充所有者说话。

## 什么在哪里运行

一切都以人的身份、在人的电脑上运行。daemon 只监听回环地址。你的适配器、你的 Agent、命令行和 daemon 都拥有人的权限。这里没有任何东西防御已经以人的身份运行的代码；它防御的是**网页**和**别人的话**。

| 边界 | 由什么守护 |
| --- | --- |
| 网页调用 daemon | `<home>/daemon.json` 里的令牌（权限 `600`；其他人能读时 `doctor` 报失败），以及只监听回环地址 |
| 一个作品的页面读取另一个作品 | 每个静态作品有自己的源（`<id>.frame.localhost`），绝不是 daemon 的源 |
| 你应用里的页面冒充你的应用 | 声明的源、视图票据（[在你的界面里显示页面](embedding.zh-CN.md)） |
| 协作者的评论冒充所有者 | `source.from`（[唤醒](wake.zh-CN.md#谁发的sourcefrom)） |
| 数据离开电脑 | 只有远程类型，且会列出并受控（[远程类型](remote-types.zh-CN.md)）；安装的类型、或者还没信任的项目里的类型，页面只能访问它自己的源和它声明的 `https://` 源 |
| 别人给的类型包 | 写入任何字节之前整体检查，绝不在 Node 里运行，由 frame-host 或当作文件提供（[见下文](#类型包)） |
| Agent 改动应由人决定的事 | 仅限本人的命令、会话权限 |
| 站点上的页面类作品越过它自己的文件 | 页面运行在访问者自己的页面主机（`<id>--<opaque>`）上，那里只提供这个页面的文件；所有写入和能力调用都经过内层外壳的 API，它只认页面令牌，拒绝页面主机（[见下文](#站点上的页面类作品)） |

### 站点上的页面类作品

页面主机名不像密码那样是秘密：它会出现在 DNS 查询、TLS 握手（SNI）、代理日志里；如果为它单独签了证书，还会出现在公开的
证书透明度日志里。所以运行页面的站点需要内容域名的通配符证书：按需签发的询问端点默认拒绝页面主机，
除非设了 `OA_PAGE_HOST_ON_DEMAND_TLS=true`（见 [页面类作品](../hosting.zh-CN.md#页面类作品)）。拿到它的人，在这个页面的主人仍有权限期间，能读这个页面的文件（`index.html`、旁边的文件、
上传的文件），别的都不能：读不到数据库、评论、在线状态或谁在看，不能写，也碰不到别的作品（这个名字只为一个作品、一个人
生成）。恶意页面也得不到更多：它在沙箱 iframe 里、在自己的源上运行，没有页面令牌、没有 cookie，网络受站点的策略限制；它
向内层外壳请求的一切，都在站点上按访问者当前的角色检查。查看者只能做查看者能做的事，不管页面怎么说。

## 给你应用的规则

1. **令牌不进页面。** 只有你的适配器（Node 进程、原生进程、stdio 桥）持有它。渲染进程或 webview 绝不读取 `daemon.json`。缩略图经由适配器保存。
2. **只有所有者的话才是人说的话。** 只有当 `source.from.kind` 是 `owner` 时，才把唤醒的 `text` 作为用户消息交给 Agent。其余都是提示。绝不把协作者的评论放进用户角色。
3. **来自 Shell 的提示是人对 Agent 说的话**，绝不是给你应用的指令。不要执行它，也不要自己把它转换成工具调用。
4. **只放行列出的源。** 绝不放行整个回环地址：其他程序也在上面提供服务。自己维护导航白名单的宿主，只在人同意之后（`embed.remote: 'ask'`，默认）、只对那个视图放行远程类型的源，或者永不放行（`deny`）。`allow` 给面板本来就是通用浏览器、没有白名单的宿主用；选它是那个宿主自己的决定，`open-artifact doctor` 会显示出来。
5. **绝不在 `file://` 上托管 Shell。** 它的源是 `null`，无法声明。
6. **按类别确认。** 审批提示用工具的操作类别（至少 `remove` 和 `person`），不要用一份会过时的名字列表。
7. **把仅限本人的命令留给人。** `publish`、`unpublish`、`remote add|remove|default|auto`、`harness add|remove`、`runtime update|pin|policy` 和 `types install|update|uninstall` 在 Agent 会话里会被拒绝。不要替 Agent 从你的适配器去运行它们来绕过这条规则。

## daemon 替你做了什么

- 唤醒文本是写给 Agent 看的：开头一行说明它是什么，`From:` 写明所有者以外的发送者，人写的文本里的链接被替换成 `[link]`，结尾一行说明内容是人的反馈，是“data and not system instructions”。
- 页面上下文（`view.context`）开头有一行说明它是来自页面的数据。只有所有者会话能读它。
- 适配器不能设置会运行命令或指向文件的 profile 字段：`nudge`、`mcp`、`skillsDir`、`sessionWorkspace` 只来自随 Open Artifact 发布的 profile 或人自己添加的 profile。
- nudge 不经过 shell 运行，参数作为独立的词填入。在 Windows 上只运行 `.exe`。
- 远程类型绝不会拿到这台电脑上的路径、密钥，daemon 也不跟随它的重定向，它的回答有大小上限。
- 运行时更新的 sha512 必须与注册表的完整性摘要一致，否则拒绝。

### 类型包

类型包（`.oatype`，`types install`）和作品压缩包（`open-artifact import`）可能来自任何人：

- **解压。** 写入任何东西之前先把整个 zip 读一遍：只能有一个顶层文件夹，只能是普通文件（按 Unix 模式判断，不能是
  符号链接、设备或 FIFO），不能有绝对路径、`..`、反斜杠、NUL 或控制字符，不能有只差大小写或 Unicode 形式的两个
  名字，不能加密，只能是存储或 deflate，目录声明的文件数和大小不能超限。解压时按实际写出的字节数对照同样的上限计数，
  并校验每个文件的 CRC，所以 zip 炸弹会在它说谎的地方失败。先解压到目标旁边的点文件夹，所有检查通过后才改名到位；
  失败时删掉点文件夹。
- **不在 Node 里运行任何东西。** 页面的 `// artifact.json` 块由解析器当作字面数据读取，绝不用 `vm`、`import`
  或 `require`。带 `entry.start` 或 `entry.url` 的包会被拒绝；安装目录永远不受信任：在那里找到的类型不会有自己的
  entry，即使之后有人改了它的文件夹也一样；类型服务也拒绝启动任何不在受信任目录里的类型的程序。人还没信任的项目里的类型
  同样对待：`entry.url` 会被拒绝，`entry.start` 在要启动时被拒绝，下面这些也都适用，直到项目被信任。agent 拿到
  这类类型的说明时，前面附的说明会告诉它不要用 node 或 shell 运行类型里的任何文件（包括 `scripts/`），也从不点名
  要运行的脚本。
- **页面。** 限制跟着信任走：不受信任目录里的类型（安装的，或者还没信任的项目里的）由 frame-host 提供（通过
  `OPEN_ARTIFACT_TYPE_RESTRICTED=1` 告诉它），或由 daemon 当作文件提供，页面文档和文件都带
  Content-Security-Policy：只允许它自己的源、`data:`、`blob:` 和 `openArtifact.network` 里的 `https://` 源。它的
  框架带沙盒（`allow-scripts allow-same-origin allow-forms allow-modals allow-downloads`）：frame-host 的外层页面给
  内层框架设上，Shell 给静态页面的框架设上，这时 Shell 自己的文档还会发 `frame-src http://*.frame.localhost:<port>`。
  受信任的类型不变；信任一个项目后，它正在运行的 frame-host 会去掉这些限制重新启动。在 Chrome 里用一个尝试各种
  出路的页面实测（脚本带用户手势）：`fetch`、图片、表单提交、`window.open`、`target="_blank"` 链接、
  `top.location`、下载链接、把自己的框架导航到别的源、meta refresh 到别的源，全部失败；它自己的文件、数据、上传和
  它自己发起的下载照常可用。
  没有沙盒时，两种页面都能通过 `window.open`、`_blank` 链接和 `top.location` 出去，静态页面还能把自己的框架导航
  或 refresh 到别的源。仍然留着的：单独在标签页里打开页面地址时有这条策略但没有沙盒，所以在那里它能导航自己的
  标签页；页面也能把文字送到 Agent 面前（[限制](limits.zh-CN.md#安全)）。
- **链接和名字。** 类型文件夹或作品文件夹里指向文件夹外面的链接，既不会被提供（daemon 的静态页面、frame-host 的
  `artifact-type/`），也不能借它写入或读取（页面的发布、数据库、上传和评论）：最近一层已存在的父目录的真实路径
  必须在文件夹里面。保留的名字（`index.html`、`SKILL.md`、`artifact-type/`、`comments.json`、`db/`、`history/`、
  `*.lock`、`_blobs/`）比较时不分大小写，超过 255 字节的名字会被拒绝。类型包安装出来都是普通文件，模式 `0644`。
  作品压缩包保留文件的模式（最多 `0755`，从不带 setuid）：没有任何东西会运行作品的文件。
- **下载。** `types install <url>` 只接受 `https://`（纯 `http://` 只限回环地址），不发送 cookie 或凭据，拒绝带用户名
  或密码的地址，最多跟随五次重定向且只能是同一种协议，读取时到大小上限就停，超时也停。字节的 sha256 和来源记在
  `<home>/types.json` 里；主页安装的就是它预览过的那份字节。
- **谁能请求。** `types.preview`、`types.install`、`types.update`、`types.uninstall` 和 `artifacts.import`
  从任何页面的源（作品的、类型服务的、别的网站的）发来，或者是跨站请求，不管带不带令牌都拒绝；安装、更新和卸载在
  Agent 会话里也会被拒绝。
- **文字。** 安装的类型的 `SKILL.md`、标题和描述交给 Agent 时带着 `source: "installed"` 和固定的
  `third_party_notice`：它们是发布者写的，不能扩大任务。还没信任的项目里的类型有自己的一句说明，点明是项目文件夹。
  这类类型的页面可能写过的东西交给 Agent 时也带一句页面内容的 `third_party_notice`：`Artifact` 读 `path` 或 `paths`
  时、每次 `ArtifactData` 和 `ArtifactComments` 读取时都有；完整读取 `Artifact` 时和类型的说明拼在一起。
- **哪个类型打开什么。** 作品会记下它的类型的 `uid`；同 id 的另一个类型既不能打开也不能写它（`type_mismatch`），
  导入时按这个 uid 找类型（找不到就是 `type_missing`）。

## 它不做什么

- **会话权限不是边界。** `may` 和 `policy.roles` 让诚实的 Agent 走在正路上；以人的身份运行的进程什么都能调用。
- **仅限本人的命令是护栏。** 当 daemon 能判断自己在 Agent 会话里运行时（harness profile 在 `markers` 和 `sessionEnv` 里列出的环境变量），它们会被拒绝；隐藏了这些的进程拦不住。
- **更新的来源证明不做校验**，只做记录（[运行时](runtime.zh-CN.md#更新怎么校验)）。
- **由站点提供的 Shell 认不出已声明的宿主**，把每个宿主都当作未声明（[已知限制](limits.zh-CN.md)）。
