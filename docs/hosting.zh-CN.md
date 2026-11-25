# 把作品放到站点上

[English](hosting.md)

Open Artifact 在你自己的电脑上生成作品：幻灯片、文档、表格、仪表盘、白板、设计稿、动效。**站点**是一台服务器，它给这些
作品一个**网址**，你的电脑关机也能打开。别人在站点上登录，打开分享给自己的作品，一起编辑、评论。你的 Agent 把作品
**发布**到站点，之后还是在你的电脑上继续改。

这一篇讲站点怎么工作，帮你选在哪里运行。具体步骤见文末链接的各篇指南。

> **如果你是替人操作的 Agent**
>
> - 这些要问，不要猜：域名；用哪个云账号；谁可以注册；作品能不能设为公开；仪表盘的数据能不能发布。
> - **只有一个域名**（`OA_CONTENT_SAME_SITE=true`）由这个人来决定，不由你决定。先建议用第二个名字（第二个域名、内网里的
>   `nip.io`、Cloudflare 上的 `workers.dev`）。确实没有的话，把[它削弱了什么](#只有一个域名)给对方看，对方同意了再打开。
> - 只有人能做：添加 DNS 记录、用 owner key 登录、批准这台电脑、付费或选择付费套餐。
> - 不要打印任何密钥（签名密钥、owner key、Link 令牌、OAuth 密钥），只说明它存在哪里。
> - 创建或删除云资源、或做任何要花钱的事之前，先问。
> - 每一步先用 **检查：** 里的命令确认，再做下一步。同一步失败两次就停下，报告你运行了什么、看到了什么。

## 用词对照

产品界面和代码对同一样东西用的词不一样。这些指南用界面上的说法。

| 指南里的说法 | 代码和日志里的说法 | 是什么 |
| --- | --- | --- |
| 站点 | host | 服务器：Node 版（`packages/host`）或 Cloudflare 版（`packages/host-cloudflare`）。 |
| 网址 | view URL、`/a/<id>` | 作品在站点上打开的地址。 |
| 连接站点 | `remote add` | 把你电脑上的 Open Artifact 关联到一个站点。 |
| 发布 / 取消发布 | Link `import` / `unpublish` | 把作品放上站点，或者撤下来。 |
| 你电脑上的 Open Artifact | daemon | Agent 应用启动的本地程序，每个作品对应一个文件夹。 |
| room | artifact object、room | 一个作品在站点上的实时副本（在 Cloudflare 上是一个 Durable Object）。 |

## 各部分怎么配合

```
 Agent 应用（Claude Code、Codex、Cursor……）
        |  MCP 工具
        v
 你电脑上的 Open Artifact  ----- 发布，之后双向同步 ----->  站点
 （daemon，每个作品一个文件夹）  <---- 评论、请求、改动 ---  （应用源 + 内容源）
                                                              ^
                                        浏览器里的人 ---------+
                                        远程 MCP 客户端 ------+
```

- Agent 在你的电脑上创建和修改作品，和没有站点时一样。
- **发布**把作品复制到站点。从此你电脑上的文件夹就是**工作副本**：你的改动推送到站点，别人在站点上的改动回到文件夹。
  两边冲突时以站点为准，你的版本保存在文件夹的 `_agent/conflicts/` 里。
- 别人在站点上发给 Agent 的评论和请求，会送到你电脑上的 Open Artifact，再交给你的 Agent。你的电脑关机时，它们在站点
  上等着。
- **取消发布**把站点上那份移到站点的回收站。你电脑上的文件夹保留，并带上站点上的最新改动。回收站保留
  `OA_TRASH_DAYS` 天（默认 30 天；`0` 表示一直保留，直到所有者永久删除），首页的回收站会写明保留多久。首页的**上传**接收
  不超过站点上限的 `.zip`（Node 上 100 MiB，Cloudflare 上 32 MiB），更大的文件在发送前就会被拒绝。
- 没法在本地运行 Open Artifact 的 Agent，可以通过**远程 MCP**（站点上的 `/mcp`）直接使用站点。

## 两个源

站点在两个源（origin）上提供服务：

| | 例子 | 提供什么 | Cookie |
| --- | --- | --- | --- |
| **应用源**（`OA_APP_ORIGIN`） | `https://artifacts.example.com` | 登录、首页、Shell（每个作品外面那层框）、分享、API、`/mcp` | 登录会话的 cookie |
| **内容源**（`OA_CONTENT_ORIGIN`） | `https://{id}.oa-content.example.net` | 每个作品自己的页面，一个作品一个主机名 | 没有；网址里带一个短期有效的页面令牌 |

为什么要分开：作品的页面是人或 Agent 写的 HTML，它绝不能读到登录 cookie，否则就能冒充打开它的人。所以：

- 内容源必须是和应用**不同的可注册域名**（`example.net` 对 `example.com`，光换个子域名不行）。不满足时站点拒绝启动。
- `{id}` 必须是内容主机名的第一段，完整的一段。它是作品 id 把 `_` 换成 `-`，所以 `art_0mwr…` 在
  `art-0mwr….oa-content.example.net` 上。因此内容源需要一个**通配**的 DNS 名字。

**哪个名字回答什么。** 不管哪种布局（两个域名、一个域名、内网、Node 还是 Cloudflare），站点都看请求发往的名字（它的
`Host`，大小写不论，带不带默认端口都一样），然后：

- 应用和它的所有路由（登录、页面、API、`/mcp`、`/link/…`、`/plugins/…`）只在应用源自己的主机名和端口上回答，和
  `OA_APP_ORIGIN` 里写的完全一样；
- 作品页面只在那个作品自己的内容主机名上回答；
- 其他到达站点的名字（同一域名下的其他名字比如 `www.example.com`、不带前缀的内容域名、应用用名字时服务器的 IP 地址、
  应用是 `127.0.0.1` 时的 `localhost`、末尾带点的名字）一律回答 **421** 和一行文字
  `<name> is not this site's app host nor an artifact's: Open Artifact does not answer it.`：没有页面、没有 cookie、没有
  跳转、没有表单，GET 和写请求都一样；
- 没有可用 `Host` 的请求（缺了，或者不是主机名）回答 **400** `The request has no valid Host header.`

健康检查（`/__open-artifact/health`）是唯一的例外：它在任何名字上都回答，这样负载均衡或容器检查可以按地址探测服务器。
在代理后面时，只有 Node 上设了 `OA_TRUST_PROXY=1`，站点才按 `X-Forwarded-Host` 判断；否则看代理发来的 `Host`，所以代理
必须把原来的名字传过来。

"可注册域名"怎么判断：取名字的最后两段（`example.com`）；`nip.io`、`sslip.io` 和 `home.arpa` 取三段
（`192-168-1-20.nip.io`）；IP 地址自成一个站点。所以在内网里，`oa.lan` 和 `oa-content.lan` 是两个站点，而 `nas.lan` 和
`{id}.nas.lan` 是同一个，会被拒绝。

只有一个域名的人，先考虑再用一个属于不同站点的名字：第二个域名、内网里的 `nip.io` 名字，或者在 Cloudflare 上用
`workers.dev` 地址作为应用源。确实只有一个时，站点也可以把两个源放在同一个域名上，但会在下一节列出的几个方面变弱：
[只有一个域名](#只有一个域名)。

## 只有一个域名

`OA_CONTENT_SAME_SITE=true` 允许内容源和应用源在同一个可注册域名上：

| | 应用源 | 内容源 |
| --- | --- | --- |
| 服务器 | `https://app.example.com` | `https://{id}.example.com` |
| 内网 | `http://nas.lan:4900` | `http://{id}.nas.lan:4900` |
| Cloudflare，一个 zone | `https://app.example.com`（Custom Domain） | `https://{id}.example.com`（路由） |

不打开这个设置时，这样的一对会被拒绝，提示里会点名这个设置：

```
open-artifact-host: OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN (http://nas.lan:4977), so that artifact pages cannot reach the session cookie: use another registrable domain. With only one domain, OA_CONTENT_SAME_SITE=true allows it, at a cost: read "One domain for both" in docs/hosting.md first.
```

打开之后，主机名仍然要分开。应用的主机名不能是内容主机名，也不能在某个内容主机名下面：`art-app.nas.lan` 当应用会被
拒绝，因为每个 `art-…` 开头的名字都属于作品。（内容主机名在应用主机名下面，比如 `art-….nas.lan` 和 `nas.lan`，是允许
的。）同一域名下的其他名字，比如 `www.example.com`，和所有布局一样，得到[两个源](#两个源)里说的 421。

具体怎么设置见各篇指南：[内网](hosting-lan.zh-CN.md#只有一个域名)、[服务器](hosting-server.zh-CN.md#只有一个域名)、
[Cloudflare](hosting-cloudflare.zh-CN.md#只有一个域名)。

### 它削弱了什么，站点做了什么

两个源分属两个站点时，浏览器知道的每一条路都把作品页面（人或 Agent 写的 HTML）和应用隔开。放在同一个站点上，浏览器就把
两者当成邻居。逐条来看：

- **作品页面发出的请求会带上应用的 cookie。** 登录 cookie 是 `SameSite=Lax`，而“同站”说的正是这种情况，所以
  `art-….example.com` 上的页面向 `app.example.com` 发请求时，会带上这个人的登录会话。站点的做法：应用源上的每个写操作
  （所有不是 GET、HEAD、OPTIONS 的路由，以及 MCP 登录授权）只要来自浏览器，就必须来自应用自己的页面：`Sec-Fetch-Site`
  必须是 `same-origin`，`same-site` 的请求和 `cross-site` 一样被拒绝（403 `not_granted`）；`none`（在地址栏里输入的）
  只有不带 cookie 时才放行，所以用不上登录会话。不发 `Sec-Fetch-Site` 的客户端（Link daemon、curl、老浏览器）看 `Origin`：
  没有或者等于应用源就放行，其他值（包括 `null`）一律拒绝；这样的客户端凭自己的凭据行事（Bearer 令牌，或者它自己持有的
  会话 cookie），用不上浏览器里的。以前会改东西的 GET，现在只在“访问
  这个页面”时才生效：打开分享链接，只有顶层访问、并且不是从邻居主机来的，才会加入，否则显示一个带 **Open it** 按钮的页面；
  登录的开始和回调拒绝图片、fetch 和 frame。其余 GET 不会改出别人能察觉的东西（打开作品会启动它的 room，但不授予任何权限）。
  站点的测试会遍历路由表里的每个写路由来检查这一点。站点插件自己的 GET 路由由插件负责。
- **作品页面想读应用的回答。** 同站不等于同源，浏览器仍然不给，除非应用允许，而应用不允许：对内容主机没有 CORS；应用的每个
  回答都带 `Cross-Origin-Resource-Policy: same-origin`，所以对应用发 `<img>`、`<script>` 或 no-cors `fetch` 什么也拿不到
  （请求仍然会发出去，所以写操作必须像上面那样拒绝）。应用页面不能被嵌入（`frame-ancestors 'none'`、
  `X-Frame-Options: DENY`）。Shell 和首页带 `Cross-Origin-Opener-Policy: same-origin-allow-popups`，所以打开它们的、或被
  它们打开的作品窗口拿不到它们的句柄。登录页和 MCP 授权页不带：网页版 MCP 客户端会在弹窗里打开它们并等待。两个源都发送
  `Origin-Agent-Cluster: ?1`，所以谁也不能用 `document.domain` 把自己放宽成对方。**这两个头只在 https（和 `localhost`
  名字）上起作用**：在其他纯 http 源上浏览器两个都忽略（Chrome 会在控制台里说一句），所以纯 http 的内网站点不发它们。这时，
  打开 Shell 的作品窗口、或被 Shell 打开的作品窗口，仍然拿着 Shell 的句柄：读不了 Shell，但可以把它导航到别的地址（比如一个
  仿冒的登录页），或者数它有几个 frame。作品页面还可以把 `document.domain` 设成共同的域名；应用的页面从不这样设，所以它也因此
  拿不到应用页面的任何东西。
- **Cookie 投掷：作品页面给整个域名设 cookie。** 任何主机都可以设置 `Domain=example.com` 的 cookie，浏览器随后也会把它发给
  应用。在 https 上，应用的 cookie 是 `__Host-oa_session`、`__Host-oa_flow` 和 `__Host-oa_guest_…`：浏览器不允许别的主机
  设置或替换 `__Host-` cookie，应用也不读别的名字，所以投进来的 `oa_session` 会被忽略。在 http（内网）上这些名字没有前缀，
  站点自己防：一个请求里同一个 cookie 名出现两次时，所有副本都不认，结束它们指向的会话，按未登录回答，删掉这些副本（在本主机、
  每一级父域名和请求的每一级路径上），在审计日志里写 `auth.duplicate_cookie`，并在日志里写一行：
  `refused duplicate cookies (oa_session) on /…: another host of this domain set them`。两种顺序（投进来的副本在前或在后）
  都覆盖。
- **同一域名下其他应用的 cookie。** 内容路径在作品的服务端代码看到之前去掉 `Cookie` 头，并去掉作品服务端回答里的
  `Set-Cookie`，Node 和 Cloudflare 都这样。但浏览器仍然让作品页面里的脚本看到 `example.com` 下所有不是 `HttpOnly` 的
  cookie，也能在那里设置新的：把作品放在一个还有其他应用的域名上，就要接受这一点。
- **两者共用一个浏览器进程。** 浏览器按站点隔离页面；同一个站点上，作品页面和 Shell 可能在同一个进程里，于是页面里的推测执行
  攻击可能读到 Shell 的内存。`Origin-Agent-Cluster: ?1` 请浏览器把每个源分开；是否因此用不同进程，由浏览器决定。在纯 http
  上（`localhost` 除外）浏览器忽略它，作品页面和 Shell 就在同一个 agent cluster 里，也就是同一个进程里。Shell 在
  脚本可读的内存里有：这个人的名字和邮箱、带短期页面令牌的作品页面地址，以及“分享”面板打开时显示的分享链接地址。登录 cookie
  是 `HttpOnly`，从不进入脚本。
- **仿冒页面和密码管理器。** `art-….example.com` 上的作品页面可以画一个登录页的仿品，域名和真的一样。按域名填充的密码管理器
  可能在那里提供 owner key 或密码。站点阻止不了：告诉大家只在应用主机名上登录，并把密码管理器里的条目设为只匹配那个确切的
  主机名（1Password：“Only fill on this exact host”；Bitwarden：URI 匹配选 “Host”）。

| 威胁 | 站点做了什么 | https 上还剩什么 | http（内网）上还剩什么 |
| --- | --- | --- | --- |
| 作品页面带着登录会话发写请求 | 拒绝所有不是 `same-origin` 的写；加入链接和登录的 GET 只在顶层访问时生效 | 目前未知 | 目前未知 |
| 作品页面读应用的回答 | 没有 CORS；CORP `same-origin`；禁止嵌入；Shell 和首页的 COOP 与 OAC `?1` 只在 https 上 | 目前未知 | 没有 COOP 和 OAC（浏览器在 http 上忽略它们）：打开了 Shell 或被 Shell 打开的页面能把那个窗口导航到别的地址；仍然什么也读不到 |
| 向应用投掷 cookie | `__Host-` cookie；重复 cookie 防护兜底 | 页面可以塞满这个域名的 cookie 罐，让浏览器丢掉应用的 cookie：这个人被登出（麻烦，但不是接管） | **未登录**的浏览器会把投进来的 `oa_session` 当成自己的：它就以页面植入的那个会话（攻击者的）登录，这个人在那里写的东西归了攻击者。两步投掷（先塞满 cookie 罐挤掉真的，再植入一个）对已登录的浏览器也能做到。防护只能发现重复。 |
| 同一域名下其他应用的 cookie | 内容路径去掉 `Cookie` 和 `Set-Cookie` | 作品页面的脚本能读、能设这个域名下不是 `HttpOnly` 的 cookie | 同左 |
| 共用浏览器进程 | OAC `?1`（只在 https 上）；HttpOnly 的会话 | 在按站点一个进程的浏览器里，推测执行攻击可能读到 Shell 的内存 | 作品页面和 Shell 总在同一个进程里（http 上没有 OAC），所以在所有浏览器里都有同样的风险 |
| 仿冒登录页、自动填充 | 无能为力 | 人可能被骗；密码管理器按域名匹配 | 同左 |

所以：在 https 上，一个域名的代价除了仿冒风险和同域名的其他应用，没有多少。在 http 上代价更大：一个人在未登录时打开了恶意
作品，可能不知不觉登进了别人的账号。在内网里，尽量用两个名字：作品用 `nip.io`，只要 DNS 能用就行
（[hosting-lan.zh-CN.md](hosting-lan.zh-CN.md#选名字)）。

**签名密钥。** 应用源在本机或内网上的 Node 站点会自己生成签名密钥（`keys.json`），两种模式都一样。同站模式不改变这一点：
密钥签的是页面地址和分享链接，邻居主机读不到。

## 页面类作品

`page` 作品（Agent 写的自由 HTML 页面，带它声明的能力）在站点（Node 或 Cloudflare）上运行时，每个人多用一个主机名，仍在内容源的通配符下：

| | 例子 | 提供什么 |
| --- | --- | --- |
| 作品的内容主机 | `art-0mwr….oa-content.example.net/page/<页面令牌>/` | 内层外壳：页面外的那层框，以及所有写入都要经过的 API |
| 页面主机 | `art-0mwr…--k3vq…7x.oa-content.example.net` | 这个人看到的页面和它的文件，只读 |

- `--` 后面是 24 个字符，由站点签名密钥对作品、人和站点 epoch 算出。它不是页面令牌，也绝不会被当作页面令牌。只要这个人
  还有权限，它就不变，所以页面的源（以及浏览器为它存的东西）在刷新和重启后都还在；这个人失去权限，或者所有人被登出
  （新的 epoch）时，它就失效。
- **DNS** 不用改：内容源的通配符已经覆盖页面主机。
- **证书：页面类作品需要内容域名的通配符证书**（`*.oa-content.example.net`）。公开证书机构签发的每张证书都会写进证书透明度
  （Certificate Transparency）日志，任何人都能查。为某个页面主机单独签的证书会公开这个主机名，也就公开了有人在什么时候打开
  过这个页面。所以按需签发的询问端点（`/tls-ask`）默认拒绝页面主机，只对应用主机和内容主机回答可以。
  **`OA_PAGE_HOST_ON_DEMAND_TLS=true`** 让它对仍有权限的人的页面主机也回答可以；只在不在意这些日志的地方用（私有证书机构、
  测试站点）。启动输出里的 `tls-ask:` 一行会写明当前是哪种模式。
- **`OA_PAGE_NETWORK`**：`self`（默认），页面只能访问自己的源；`https`，还能访问任意 https 源，这时 `network.origins()`
  返回 `["https:"]`。
- **只有一个域名**（`OA_CONTENT_SAME_SITE=true`）：站点不运行页面，发布页面会被拒绝，启动输出会写 `pages: off`。Cloudflare
  站点也运行页面（见 [Page 作品](hosting-cloudflare.zh-CN.md#page-作品)）。

每个角色在页面上能做什么、哪些内容和发布它的电脑同步：见 [站点上的 Page](types/page.zh-CN.md#在站点上)。

## 发布的类型

运行页面的 **Node** 站点也会保存人们发布给它的类型（`open-artifact types publish`，见
[发布到网站](custom-types.zh-CN.md#发布到网站)），并运行用它们做的作品。

- **`OA_TYPES_PUBLISH`**：谁可以发布类型。`admins`（默认：站点管理员）、`members`（任何有账号的人）或 `off`（谁都不行；
  已经发布的照常运行）。只有一个域名（`OA_CONTENT_SAME_SITE=true`）时它总是 `off`，因为这样的站点不运行页面。启动输出里的
  `types:` 一行写明当前生效的设置和保存位置。
- **保存在哪里**：`<OA_DATA_DIR>/types/<uid>/<version>/`，里面是发布时的包（`package.oatype`）和解开的文件（`files/`，
  普通的 `0644` 文件）；每个类型只留一个版本，新版本会替换旧版本的文件夹。类型目录（id、uid、版本、发布者、可见性、sha256）
  在站点数据库的 `types` 表里。备份时和数据文件夹的其他内容一起备份。
- **类型在站点上能做什么**：服务器上什么都不运行。保存任何东西之前，包会按 `types install` 的方式检查（一个文件夹、普通文件、
  没有 `..` 和链接、大小限制、字面量声明），而且只收页面能原样提供的类型：没有 `entry`、不是页面类型。它的页面在作品的
  页面主机上、在沙盒框架里运行，Content-Security-Policy 由清单的 `openArtifact.network` 列表生成（`OA_PAGE_NETWORK` 不会
  放宽它）。站点上的 agent 会被告知：类型里的文字出自它的发布者。
- **管理员需要知道的**：管理员可以为任何人的类型发布新版本，也可以取消发布。还有作品在用的类型取消发布时只会下架（作品照常
  打开）；没有作品再用时才会删除。一个 id 归第一个占用它的 `uid`；内置类型的 id 永远不会被占用。每次发布和取消发布都记入审计
  日志（`type.publish`、`type.unpublish`），插件可以用 `type.publish` 守卫拒绝一次发布（见[插件](plugins.zh-CN.md)）。
- Cloudflare 站点暂时不保存发布的类型。

## 角色和分享

- 每个作品有一个**所有者**。所有者和站点管理员在站点的“分享”面板里决定谁能打开。
- 每个人有一个角色：**编辑者**、**评论者**或**查看者**。角色可以给一个邮箱、整个邮箱域名，或一个登录方提供的群组。
- 一般访问权限分三种：**受限**、**知道链接的任何人**（链接带一个角色；没有账号的人以具名访客身份加入）、**公开**（站点
  允许时，知道网址的人都能查看）。
- **站点管理员**是 `OA_OWNERS` 里的邮箱，加上用 **owner key** 登录的人。owner key 是给运行站点的人用的一个秘密登录地址。
  `OA_OWNERS` 为空时，第一个创建的账号也是管理员。
- **谁可以注册**（`OA_SIGNUP`）：`invite`（默认：有作品分享给他的人）、`owners-only`、`domain:<域名>` 或 `open`。

## 站点不做的事

- **从不运行浏览器。** 作品的图片、PDF、视频都在某个人自己的电脑上生成：人在自己的浏览器里导出（文档的 PDF 走浏览器的
  打印对话框），连接了电脑的 Agent 在那台电脑上、用工作副本截图和导出。只用远程 MCP 的 Agent 拿到的不是图片，而是一个
  短期有效的只读页面地址。
- **从不运行连接器。** 数据仪表盘的实时查询在所有者的电脑上运行。所有者发布仪表盘、并确认数据一起发布后，所有者的电脑
  运行这些查询，把结果放到站点上，那边的页面显示“数据截至 <时间>，来自 <所有者> 的电脑”。见
  [连接你的电脑和 Agent](connecting-agents.zh-CN.md#仪表盘和它的数据)。
- 没有内网分享（由分享和链接代替），不会空闲退出，不能按服务器磁盘上的路径上传文件。

## 选哪一种站点

| | 内网 | 带域名的自有服务器 | Cloudflare |
| --- | --- | --- | --- |
| 指南 | [hosting-lan.zh-CN.md](hosting-lan.zh-CN.md) | [hosting-server.zh-CN.md](hosting-server.zh-CN.md) | [hosting-cloudflare.zh-CN.md](hosting-cloudflare.zh-CN.md) |
| 谁能访问 | 同一网络里的电脑 | 互联网上的任何人 | 互联网上的任何人 |
| 需要 | 一台常开的电脑（NAS、迷你主机、闲置的 Mac）；Node 22.18 或更高，或者 Docker | 一台有公网地址的服务器（VPS、EC2）和 Docker；两个你能管理的域名（或者一个，[更弱](#只有一个域名)）；80 和 443 端口 | 一个 Cloudflare 账号，上面有一个给作品用的 zone（域名）；部署用的电脑上装 Node 22.18 或更高 |
| 名字 | 不需要：`http://192.168.1.20:4900` 配 `nip.io`，或者内网通配 DNS（只用一个名字，`nas.lan` 和 `{id}.nas.lan`，[更弱](#只有一个域名)） | 一个应用主机名，加第二个可注册域名上的通配；或者都放在一个域名上，[更弱](#只有一个域名) | 应用用 `workers.dev` 地址，作品用你 zone 上的通配路由；或者应用用同一个 zone 上的 Custom Domain，[更弱](#只有一个域名) |
| HTTPS | 没有，走 http（仅限内网） | 有，Caddy 自动申请证书 | 有，用 Cloudflare 的 |
| 费用 | 电费 | 服务器和域名 | 实际可用的是 Workers Paid（每月最低 5 美元），超出部分按量计费 |
| 备份 | `deploy/backup.sh` | `deploy/backup.sh`，AWS 上每天自动 | 目录库用 D1 Time Travel；作品各自导出 zip |
| 做不到 | 网络外的人访问；加密传输 | 在一个域名上，没法把两个源隔得和两个域名时一样开 | `open-artifact-host` 命令（`link-token` 由管理 API 代替）；超过 32 MiB 的上传；构建之后新加的类型 |
| 写指南时运行过 | 是，在一台电脑上用 `127-0-0-1.nip.io`（不是真实内网） | 不用 Docker 的站点，运行过；Docker、Caddy、AWS 没有 | 本地 `wrangler dev` 运行过；2026-11-22 做过一次真实部署 |

然后连接你的电脑和 Agent：[connecting-agents.zh-CN.md](connecting-agents.zh-CN.md)。

## 可能遇到的毛边

- 已发布作品在你电脑上的地址（本地的 `/a/<id>`），站点连得上时会跳到站点；连不上时，打开的是本地的工作副本，你的改动先
  存在电脑上，等站点恢复再发送。所以同一个地址在不同网络状况下会显示两个不同的页面。
- 在 Cloudflare 上，经过测试的布局是：作品用一个 zone，应用用 `workers.dev` 地址。应用主机名和作品放在同一个 zone，
  除非设置 `OA_CONTENT_SAME_SITE=true`，否则会被拒绝；这种布局只在 `wrangler dev` 下运行过，没有在真实 zone 上运行过。
- 站点上仪表盘的数字，取决于所有者电脑最后一次刷新的时间（默认每 6 小时一次，或者有人点了刷新）。
