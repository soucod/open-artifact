# 家里或办公室内网的站点

[English](hosting-lan.md)

**做完以后**，你的网络里一台常开的电脑上会运行一个 Open Artifact 站点，地址类似 `http://192.168.1.20:4900`。同一网络里
的人都能打开分享给他们的作品，你的 Agent 也能发布到这里。它走 http，不需要域名，也不需要证书。

**开始之前**你需要：

- 网络里一台常开的电脑（NAS、迷你主机、闲置的 Mac 或 Linux 机器），装好 Node 22.18 或更高版本和 git，或者装好 Docker；
- 它的内网地址，以及让地址固定不变的办法（在路由器里做 DHCP 地址保留）；
- 大约 300 MB 磁盘放程序，再加上作品占的空间。

**做不到的事**：网络外的人访问不了，传输也不加密。只在你信任的网络里用。要放到互联网上，见
[hosting-server.zh-CN.md](hosting-server.zh-CN.md) 或 [hosting-cloudflare.zh-CN.md](hosting-cloudflare.zh-CN.md)。

> **如果你是替人操作的 Agent**
>
> - 这些要问，不要猜：哪台电脑运行站点、它的内网地址；用 `nip.io` 还是网络自己的 DNS；谁可以注册；作品能不能设为
>   公开；仪表盘的数据能不能发布。
> - 只有人能做：改路由器或 DNS 服务器、打开 owner 登录地址（它是密钥）、批准电脑。
> - 不要打印密钥。owner 登录地址由 `owner-key` 打印一次，让人自己打开，不要贴进对话。签名密钥在
>   `<OA_DATA_DIR>/keys.json`。
> - 改防火墙或安装系统服务之前先问。
> - 每一步确认后再做下一步。同一步失败两次就停下来报告。

**怎么读这些步骤。** 每一步都有命令、**预期：**（真实输出）、**检查：** 和 **失败时：**。“写指南时运行过”指在一台 Mac
上运行过，用 `127.0.0.1` 和 `127-0-0-1.nip.io`、端口 4977 代替真实的内网地址（没有第二台电脑，也没有动路由器）。
“未运行”会说明原因，以及这一步的依据。

## 哪些情况允许 http

站点和你电脑上的 Open Artifact 都只对本机或内网的名字允许 `http://`。判断只看**写出来的名字**，不做 DNS 查询
（`packages/protocol/src/network.ts`）：

| 允许 http | 例子 |
| --- | --- |
| 本机 | `localhost`、`*.localhost`、`127.x.x.x`、`::1` |
| 内网地址 | `10.x`、`172.16.x`–`172.31.x`、`192.168.x`、链路本地 `169.254.x`、IPv6 `fc00::/7` 和 `fe80::/10`（写成 IPv4 映射的 IPv6 也算） |
| 内网名字 | `.local`、`.lan`、`.home.arpa`、`.internal` 结尾的名字；单个词的名字，比如 `nas`（末尾不带点） |
| `nip.io` / `sslip.io` | 拼出来只包含内网或本机地址的名字，比如 `192-168-1-20.nip.io` |

其他名字都要 https，包括 `100.64.0.0/10` 的地址。这一段是运营商级 NAT 的地址，**Tailscale** 的 `100.x.y.z` 就在这里；它
是共享地址空间，不是内网，所以规则不把它当内网。`0.0.0.0` 和各种变形写法（八进制、十六进制、空段）也会被拒绝。

站点上设 `OA_ALLOW_HTTP=true` 可以对任何名字放开 http。电脑这边，`remote add … --insecure-http`（或
`OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1`）作用相同。

## 选名字

站点需要两个属于不同站点的源（原因见 [hosting.zh-CN.md](hosting.zh-CN.md#两个源)）：一个给应用，一个通配给作品。
`http://192.168.1.20:4900` 这样的裸地址可以当应用源，但不能当内容源，因为每个作品都要有自己的主机名。两种办法：

| | `nip.io` | 网络自己的通配 DNS |
| --- | --- | --- |
| 应用 | `http://192.168.1.20:4900` | `http://oa.lan:4900` |
| 作品 | `http://{id}.192-168-1-20.nip.io:4900` | `http://{id}.oa-content.lan:4900` |
| 需要 | 电脑能访问公网的 `nip.io` DNS，路由器不拦截指向内网地址的 DNS 应答 | 能应答通配的路由器或 DNS 服务器（dnsmasq、Pi-hole、AdGuard Home、OpenWrt） |
| 何时失效 | 断网，或 `nip.io` 出问题 | 换了 DNS 服务器 |

`nip.io` 那一列里，**应用是裸地址**（`http://192.168.1.20:4900`，不带 `nip.io`），**作品是它下面的 `nip.io` 名字**。站点
对每个名字只按它的身份应答：应用只在和 `OA_APP_ORIGIN` 完全一样的名字上（名字和端口都按那里写的），作品只在它自己的名字
上；其他到达站点的名字一律回答 421，别的什么都没有（没有页面、没有 cookie、没有跳转）。所以
`http://192-168-1-20.nip.io:4900`（不带前缀的 `nip.io` 名字）、`http://www.192-168-1-20.nip.io:4900` 和
`http://localhost:4900` 虽然都到得了同一台电脑，也都会被拒绝。在这里运行过，应用在 `http://127.0.0.1:4977`，作品在
`127-0-0-1.nip.io` 上：

```bash
curl -s http://127-0-0-1.nip.io:4977/
```

**预期**（状态 421）：

```
127-0-0-1.nip.io:4977 is not this site's app host nor an artifact's: Open Artifact does not answer it.
```

`curl -s http://www.127-0-0-1.nip.io:4977/` 和 `curl -s http://localhost:4977/` 的回答一样，只是换成各自的名字。给别人的
应用地址，要和 `OA_APP_ORIGIN` 里写的一字不差。

用 DNS 的话注意：两个名字最好属于不同站点。`oa.lan` 和 `oa-content.lan` 可以；`nas.lan` 和 `{id}.nas.lan` 不行，站点会
拒绝（在这里运行过）：

```
open-artifact-host: OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN (http://nas.lan:4977), so that artifact pages cannot reach the session cookie: use another registrable domain. With only one domain, OA_CONTENT_SAME_SITE=true allows it, at a cost: read "One domain for both" in docs/hosting.md first.
```

如果网络的 DNS 只能在一个名字下面应答，见下面的[只有一个域名](#只有一个域名)。

## 只有一个域名

应用用 `nas.lan`，作品用 `{id}.nas.lan`，再加上 `OA_CONTENT_SAME_SITE=true`。**在纯 http 上这是最弱的布局**：一个人在
未登录时打开恶意作品，可能变成以别人的身份登录（[hosting.zh-CN.md](hosting.zh-CN.md#只有一个域名) 里的表说明了原因）。
由运行站点的人决定；Agent 要先问，并先把那张表给对方看。两个名字更好，`nip.io` 免费给你第二个。

用下面这行代替[第 3 步](#3-生成-owner-登录地址)里的 export，其余步骤照做：

```bash
export OA_APP_ORIGIN=http://nas.lan:4900 OA_CONTENT_ORIGIN='http://{id}.nas.lan:4900' OA_CONTENT_SAME_SITE=true OA_DATA_DIR="$HOME/.open-artifact-host"
```

DNS 服务器必须把 `nas.lan` 和所有 `*.nas.lan` 都解析到这台电脑的地址（dnsmasq：`address=/nas.lan/192.168.1.20` 两者都管）。

**预期：** 在[第 4 步](#4-启动站点)，content 那一行会注明：

```
  app:     http://nas.lan:4900
  content: http://{id}.nas.lan:4900 (same site as the app: OA_CONTENT_SAME_SITE)
```

**检查**站点是否把两者分开。同一域名下的其他名字被拒绝；发送两次的 cookie 被拒绝并删除。下面的命令把名字放在 `Host`
头里发到地址上，所以 DNS 服务器还没应答 `www.nas.lan` 时也能用（DNS 配好以后，`curl -s http://www.nas.lan:4900/` 效果
一样）：

```bash
curl -s -H 'Host: www.nas.lan:4900' http://192.168.1.20:4900/
```

**预期：** `www.nas.lan:4900 is not this site's app host nor an artifact's: Open Artifact does not answer it.`（状态 421）。

```bash
curl -s -o /dev/null -D - -H 'Host: nas.lan:4900' -H 'cookie: oa_session=a; oa_session=b' http://192.168.1.20:4900/api/open-artifact.auth.me | grep -ci '^set-cookie'
```

**预期：** `5`（在 `nas.lan`、它的各级路径上，以及带 `Domain=nas.lan` 删掉这些副本），站点日志里有
`refused duplicate cookies (oa_session) on /api/open-artifact.auth.me: another host of this domain set them`。

**如果失败：** `must be a different site … OA_CONTENT_SAME_SITE=true allows it` 说明站点的环境里没有这个设置（systemd 单元或
launchd plist 里也要加）。`the app's host name (art-app.nas.lan) is, or is under, an artifact's content host` 说明应用自己的
名字以 `art-` 开头：每个 `art-…` 名字都属于作品，换一个。应用自己的名字上出现 421，说明 `OA_APP_ORIGIN` 和人们输入的名字
（包括端口）对不上。

`curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: nas.lan:4900' http://192.168.1.20:4900/` 回答 `303`（应用，带你去
登录），而裸地址 `http://192.168.1.20:4900/` 回答 421：在这种布局里，地址本身也不是应用。

在这里用 `nas.lan` 名字、在本机 4976 端口运行过（请求发到 `127.0.0.1`，带 `Host` 头，如上）；启动输出、421、`5`、日志
那一行和 303 都来自那次运行。没有在真实的内网 DNS 服务器上运行过。

## 步骤

命令里的 `192.168.1.20` 换成这台电脑的地址，`192-168-1-20` 换成同一个地址用短横线连起来的写法。

### 1. 获取程序并构建

```bash
git clone https://github.com/JimLiu/open-artifact.git && cd open-artifact
```

```bash
npm ci
```

```bash
npm run build
```

**预期：** `npm ci` 最后输出 `added 284 packages, and audited 325 packages in 3s`（数字随版本变化）；`npm run build` 最后
输出 `built everything in 28.6s`。

**检查：**

```bash
node packages/host/src/node/main.ts version
```

打印版本号，比如 `0.14.6`。

**失败时：** `node --version` 必须是 22.18 或更高。构建出错会指出是哪个包；`git pull` 之后再运行一次 `npm ci`。

写指南时在检出代码的副本上运行过。clone 这一行没有运行。

### 2. 确认名字能解析

用 `nip.io`：

```bash
dig +short anything.192-168-1-20.nip.io
```

**预期：** `192.168.1.20`。（写指南时用 `127-0-0-1.nip.io` 运行过，输出 `127.0.0.1`。）

**失败时：** 没有输出通常是路由器丢弃了指向内网地址的 DNS 应答（“DNS 重绑定保护”）。在路由器里放行 `nip.io`，或者用
同样方式的 `sslip.io`，或者用自己的通配 DNS。

用自己的 DNS，以 dnsmasq 为例（Pi-hole：放在 `/etc/dnsmasq.d/` 下的一个文件；OpenWrt：**网络 > DHCP/DNS**）：

```
address=/oa.lan/192.168.1.20
address=/oa-content.lan/192.168.1.20
```

第二行会应答 `oa-content.lan` 以及它下面的所有名字。

```bash
dig +short art-test.oa-content.lan
```

**预期：** `192.168.1.20`。未运行：手边没有内网 DNS 服务器。这两行是 dnsmasq 文档里的 `address=/domain/ip` 写法，它也会
应答子域名。

### 3. 生成 owner 登录地址

**owner key** 是给你（运行站点的人）用的秘密登录地址，用它登录的人是站点管理员。在第一次启动前生成，这样它只打印在这里，
不会进到系统服务的日志里：

```bash
export OA_APP_ORIGIN=http://192.168.1.20:4900 OA_CONTENT_ORIGIN='http://{id}.192-168-1-20.nip.io:4900' OA_DATA_DIR="$HOME/.open-artifact-host"
```

```bash
node packages/host/src/node/main.ts owner-key
```

**预期：**

```
Generated a signing key for this local host in /Users/you/.open-artifact-host/keys.json.
A new owner key replaces the old one. Sign in as the owner at:
  http://192.168.1.20:4900/auth/sign-in#key=<secret>
```

把这个地址存进密码管理器。再运行一次 `owner-key` 会生成新的，旧的随即失效。**签名密钥**（用来签署页面地址和分享链接）
已经生成在 `keys.json` 里，因为应用源是内网地址；其他情况下要自己设置 `OA_SIGNING_KEYS`。

**检查：** `ls -l "$OA_DATA_DIR"` 能看到 `host.db` 和 `keys.json`，权限都是 `-rw-------`。

**失败时：** 以 `open-artifact-host: OA_…` 开头的消息会指出哪个设置不对（见[站点拒绝启动时](#站点拒绝启动时)）。

写指南时用本机地址运行过。

### 4. 启动站点

```bash
OA_BIND=192.168.1.20 OA_PORT=4900 node packages/host/src/node/main.ts serve
```

`OA_BIND` 是站点监听的地址。默认的 `127.0.0.1` 只有本机能连。用内网地址（如上）只让这个网络连进来；用 `0.0.0.0` 则这台
电脑所在的所有网络都能连。

**预期：**

```
Open Artifact host 0.14.6 listening on http://192.168.1.20:4900
  app:     http://192.168.1.20:4900
  content: http://{id}.192-168-1-20.nip.io:4900
  data:   /Users/you/.open-artifact-host
```

**检查**，在另一个终端：

```bash
curl -s http://192.168.1.20:4900/__open-artifact/health
```

**预期：** `{"openArtifact":1,"version":"0.14.6"}`。（健康检查地址在任何名字上都应答，方便负载均衡和容器检查；其他一切
只在站点自己的名字上应答。）然后在网络里**另一台电脑**上打开 `http://192.168.1.20:4900/`，会跳到登录页。

**失败时：** `EADDRNOTAVAIL` 表示 `OA_BIND` 不是这台电脑的地址（地址变了：去路由器里保留它）。本机能连、别的电脑连不上：
见[第 5 步](#5-打开防火墙)。

写指南时用 `OA_BIND=127.0.0.1 OA_PORT=4977` 和 `OA_APP_ORIGIN=http://127.0.0.1:4977` 运行过。启动输出是：

```
Open Artifact host 0.14.6 listening on http://127.0.0.1:4977
  app:     http://127.0.0.1:4977
  content: http://{id}.127-0-0-1.nip.io:4977
  data:   /private/tmp/…/run8/host
```

后面跟着 owner 登录地址，因为那次运行跳过了第 3 步（`Sign in as the owner (shown this once; … owner-key makes a new
one):`）。健康检查如上，`/` 返回 `303` 跳到 `/auth/sign-in?return_to=%2F`，`http://art-….127-0-0-1.nip.io:4977/` 上的
作品页返回 200，没有 cookie。未运行：从另一台电脑访问。

### 5. 打开防火墙

只在别的电脑连不上时才需要。先问人。

macOS：第一次启动时会弹出“是否要应用程序 node 接受传入网络连接？”，选**允许**。或者在**系统设置 > 网络 > 防火墙 >
选项**里放行 `node`。

Linux 用 ufw，只放行你的网络：

```bash
sudo ufw allow from 192.168.1.0/24 to any port 4900 proto tcp
```

**检查：** `sudo ufw status` 里有这条规则。

未运行（只有一台电脑，而且防火墙属于系统设置）。

### 6. 登录

人在浏览器里打开第 3 步的 owner 登录地址。**预期：** 首页，还没有作品，显示“还没有作品。让 Agent 用 Artifact 工具发布
一个，或者请别人分享给你。”

走 http 时 cookie 是不带 `Secure` 的 `oa_session`（浏览器只在 https 下保留 `Secure` cookie）。

**不用浏览器检查**（在站点所在的电脑上；密钥是地址里 `#key=` 后面的部分）。页面把密钥提交到 `/auth/owner-key`；curl 也能
这么做，把会话存进 cookie 文件：

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -c jar -H 'Origin: http://192.168.1.20:4900' \
  --data-urlencode "key=<secret>" http://192.168.1.20:4900/auth/owner-key
```

**预期：** `303 http://192.168.1.20:4900/`（已登录；密钥不对时回答 401，再次显示登录页，写着 “That is not the owner
key.”）。然后

```bash
curl -s -b jar http://192.168.1.20:4900/api/open-artifact.auth.me
```

回答 `Owner`，带 `"siteRole":"admin"`。`Origin` 头可以不带（没有浏览器 `Sec-Fetch-Site` 头的客户端，站点看的就是
它）；写成别的源会被拒绝，返回 403。用完删掉 `jar`：里面是一个有效的会话。

在这里对 `http://127.0.0.1:4977` 运行过（303 到 `/`，之后 `auth.me` 如上）。

### 7. 放一个作品上去

Agent 所在的电脑连上站点（第 8 步）后会发布作品。不经过它，也有两种办法把作品放上站点。

**在站点所在的电脑上**，用和站点相同的环境（第 3 步的 export）：一个装着作品的文件夹，或者它的 `.zip`：

```bash
node packages/host/src/node/main.ts import ./team-board
```

**预期：**

```
Imported "Whiteboard element test" (whiteboard) as art_0mwrwyd1w7a6a58eb2f431e47
  http://192.168.1.20:4900/a/art_0mwrwyd1w7a6a58eb2f431e47
```

它属于 owner key 的主人（`--owner <email>` 把它给别人，账号不存在时会创建）。站点运行时也能用；打印的地址由
`OA_APP_ORIGIN` 拼出来，所以漏了 export 会打印 `http://localhost:4900`。

**在浏览器里：**首页的**上传**按钮接受作品“导出”页签生成的 `.zip`（“Whole folder (.zip)”），最大 100 MiB。用 curl 和
第 6 步的会话做同样的上传：

```bash
curl -s -b jar -H 'Origin: http://192.168.1.20:4900' -H 'content-type: application/zip' \
  --data-binary @team-board.zip http://192.168.1.20:4900/api/open-artifact.artifacts.import
```

**预期：**一个 JSON 回答，开头是 `{"id":"art_…","url":"http://192.168.1.20:4900/a/art_…","title":…`。zip 里必须是一个只装
文件的文件夹：对文件夹里的内容直接 `zip -r` 会被拒绝，提示 `".artifact.json" is at the top of the zip; an artifact
archive holds one folder.`；带文件夹条目的会被拒绝，提示 `"team-board/" is not a regular file …`；在文件夹的上一级运行
`zip -qrD team-board.zip team-board` 能做出合格的 zip。

**检查：**首页列出了它，它的地址能打开。

在这里对 `http://127.0.0.1:4977` 运行过：文件夹导入、用命令行导入 zip、两种拒绝，以及用 curl 上传。未运行：在浏览器里点
**上传**按钮。

### 8. 连接你的电脑

按 [connecting-agents.zh-CN.md](connecting-agents.zh-CN.md#把电脑连接到站点) 操作，填站点地址：

```bash
open-artifact remote add home http://192.168.1.20:4900
```

内网地址走 http 不需要额外参数。如果是 `nip.io` 名字，命令会先打印
`Warning: http://… uses plain http: the connection is not encrypted, so use it only on a network you trust.`

## 让它一直运行

三选一。每种都用同样的设置运行 `serve`，崩溃或重启后自动拉起。先按第 3 步、用同一个用户和同一个 `OA_DATA_DIR` 生成
owner key。

### Linux：systemd

未运行（这里是 macOS）。`/etc/open-artifact/host.env`（权限 600，属主 root）：

```
OA_APP_ORIGIN=http://192.168.1.20:4900
OA_CONTENT_ORIGIN=http://{id}.192-168-1-20.nip.io:4900
OA_BIND=192.168.1.20
OA_PORT=4900
OA_DATA_DIR=/var/lib/open-artifact
```

`/etc/systemd/system/open-artifact.service`：

```ini
[Unit]
Description=Open Artifact site
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=oa
Group=oa
WorkingDirectory=/opt/open-artifact
EnvironmentFile=/etc/open-artifact/host.env
ExecStart=/usr/bin/node packages/host/src/node/main.ts serve
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/open-artifact

[Install]
WantedBy=multi-user.target
```

`/opt/open-artifact` 是构建好的代码，`oa` 是为它建的用户，`/var/lib/open-artifact` 是归 `oa` 所有的目录。`serve` 收到
SIGTERM（`systemctl stop` 发的就是它）会正常退出。

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now open-artifact
```

**检查：** `systemctl status open-artifact` 显示 `active (running)`；`journalctl -u open-artifact -n 20` 里有 `listening on`
那几行；第 4 步的健康检查有应答。

**失败时：** `journalctl -u open-artifact` 里有 `open-artifact-host: OA_…` 消息。`OA_BIND` 填的是内网地址时，开机时网络可能
还没就绪：上面的 `network-online.target` 会等网络，`Restart=on-failure` 会重试。

### macOS：launchd

`~/Library/LaunchAgents/ai.openartifact.host.plist`（登录后才运行；Mac 平时不登录的话，放到 `/Library/LaunchDaemons`，
并加 `UserName` 键）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openartifact.host</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>packages/host/src/node/main.ts</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/you/open-artifact</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OA_APP_ORIGIN</key>
    <string>http://192.168.1.20:4900</string>
    <key>OA_CONTENT_ORIGIN</key>
    <string>http://{id}.192-168-1-20.nip.io:4900</string>
    <key>OA_BIND</key>
    <string>192.168.1.20</string>
    <key>OA_PORT</key>
    <string>4900</string>
    <key>OA_DATA_DIR</key>
    <string>/Users/you/.open-artifact-host</string>
    <key>NODE_OPTIONS</key>
    <string>--disable-warning=ExperimentalWarning</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/you/Library/Logs/open-artifact-host.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/Library/Logs/open-artifact-host.log</string>
</dict>
</plist>
```

第一个字符串换成 `which node` 的输出，`/Users/you` 换成你自己的路径。

```bash
plutil -lint ~/Library/LaunchAgents/ai.openartifact.host.plist
```

**预期：** `…/ai.openartifact.host.plist: OK`（写指南时运行过）。

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openartifact.host.plist
```

**检查：** `launchctl print gui/$(id -u)/ai.openartifact.host | grep state` 显示 `state = running`；日志文件里有
`listening on` 那几行。停止：`launchctl bootout gui/$(id -u)/ai.openartifact.host`。

未运行：加载这个任务（那会在写指南的电脑上启动一个服务）。文件通过了 `plutil` 检查。

### Docker

未运行：这里没有装 Docker。在内网里、不经代理，用仓库里的 `Dockerfile`。在单独的目录里放一个 `compose.yaml`：

```yaml
name: open-artifact-lan
services:
  host:
    build:
      context: /opt/open-artifact      # 代码所在目录
    image: open-artifact-host:local
    restart: unless-stopped
    init: true
    environment:
      OA_APP_ORIGIN: http://192.168.1.20:4900
      OA_CONTENT_ORIGIN: http://{id}.192-168-1-20.nip.io:4900
    ports:
      - "192.168.1.20:4900:4900"        # 只绑定内网地址
    volumes:
      - oa-data:/data
volumes:
  oa-data:
```

镜像里设了 `OA_DATA_DIR=/data`、`OA_BIND=0.0.0.0`（容器内部）和 `OA_PORT=4900`，以 `node` 用户运行，健康检查访问
`/__open-artifact/health`。

```bash
docker compose up -d --build
```

```bash
docker compose exec host node packages/host/src/node/main.ts owner-key
```

**预期：** 和第 3 步一样的 `Sign in as the owner at:` 地址。（不运行这一步的话，第一次启动会把地址在
`docker compose logs host` 里打印一次。）签名密钥生成在数据卷的 `keys.json` 里。

**检查：** `docker compose ps` 显示 `healthy`；`curl -s http://192.168.1.20:4900/__open-artifact/health`。

## owner key、备份和升级

- **换一个 owner key：** 用同一个 `OA_DATA_DIR` 再运行一次 `owner-key`（第 3 步）。**预期：** `A new owner key replaces the
  old one. Sign in as the owner at:` 加地址（运行过）。如果环境里设了 `OA_OWNER_KEY`，`owner-key` 会拒绝，改那个变量即可。
- **备份**，站点运行中也可以：

  ```bash
  OA_DATA_DIR="$HOME/.open-artifact-host" BACKUP_DIR="$HOME/oa-backups" sh deploy/backup.sh
  ```

  **预期：** `wrote /Users/you/oa-backups/open-artifact-20261122T094930Z.tar.gz (112640 bytes)`（运行过）。压缩包里有
  `.backup-host.db`（目录库的精确副本）、`artifacts/` 和 `keys.json`。保留 `BACKUP_KEEP` 份（默认 7）。备份时正被编辑的
  作品可能只备份到一半的改动。可以用 cron 或另一个 launchd 任务定时执行。
- **恢复：** 停掉站点，解压到一个空目录，改名目录库，用这个目录启动：

  ```bash
  mkdir -m 700 "$HOME/.open-artifact-host-restored"
  ```

  ```bash
  tar -xzf "$HOME/oa-backups/open-artifact-20261122T094930Z.tar.gz" -C "$HOME/.open-artifact-host-restored"
  ```

  ```bash
  mv "$HOME/.open-artifact-host-restored/.backup-host.db" "$HOME/.open-artifact-host-restored/host.db"
  ```

  然后把 `OA_DATA_DIR` 设成这个目录启动。**检查：** 健康检查有应答；备份时有效的 owner key 能登录；作品能打开。写指南时
  运行过：恢复的副本在另一个端口启动，owner key 登录成功（303），作品页返回 200。
- **升级：** 先备份，然后 `git pull && npm ci && npm run build`，再重启服务。目录库会在启动时自动迁移。没有在两个版本之间
  实际升级过。

## 安全，说清楚

- **什么都不加密。** 同一网络里能看到流量的人（共享 Wi-Fi、被入侵的设备）能读到页面、登录 cookie，以及连到站点的电脑的
  Link 令牌。只在你信任的网络里用，否则就用 https。
- **有两个隔离头不起作用。** 浏览器只在 https 或 `localhost` 上认 `Cross-Origin-Opener-Policy` 和
  `Origin-Agent-Cluster`，所以在纯 http 的内网名字上站点不发它们（发了 Chrome 也只会在控制台说它忽略了）。仍然有效的：
  `Cross-Origin-Resource-Policy`、禁止嵌入、CSP，以及对每个写操作的检查。剩下的风险主要在一个名字的布局里：打开了 Shell 的
  作品窗口能把它导航到别的地址；作品页面和 Shell 可能在同一个浏览器进程里。[hosting.zh-CN.md](hosting.zh-CN.md#只有一个域名)
  里的表逐条列出。
- **谁能连进来**由 `OA_BIND` 和防火墙决定，不是站点决定。如果这台电脑还接在别的网络上（VPN、第二块网卡），绑定内网地址，
  不要用 `0.0.0.0`。
- **一个名字给两者用**（`OA_CONTENT_SAME_SITE=true`）在 http 上比在别处都弱：见[只有一个域名](#只有一个域名)。
- **账号照样生效。** 没登录、也没有分享链接的人拿不到任何作品。只开了 owner key 登录时，其他人通过链接以访客身份加入，
  或者你加一种登录方式（见 [hosting-server.zh-CN.md](hosting-server.zh-CN.md#登录方式)；OIDC 的 issuer 必须是 https，多数
  登录服务只接受 `localhost` 上的 http 回调地址，所以纯 http 的内网站点通常靠 owner key 和分享链接进入）。
- **数据目录**创建时权限是 0700，`host.db` 和 `keys.json` 是 0600（运行时确认过）。备份时带上 `keys.json`：没有它，分享
  链接地址和已打开的页面都会失效。
- **Tailscale。** `100.x.y.z` 地址和 `*.ts.net` 名字不算内网，所以走 http 要在站点上设 `OA_ALLOW_HTTP=true`、每台电脑用
  `--insecure-http`，而且站点还需要你自己设 `OA_SIGNING_KEYS`（只有应用源是本机或内网时才会自动生成签名密钥）。写指南时
  运行过：应用源为 `http://100.101.102.103:4977` 并设了 `OA_ALLOW_HTTP=true` 时，站点停在
  `open-artifact-host: OA_SIGNING_KEYS: is required: …`；不设 `OA_ALLOW_HTTP` 时停在 `must use https`；
  `open-artifact remote add pub http://100.101.102.103:4977` 的回答是：

  ```
  open-artifact: http://100.101.102.103:4977: a host must use https (http only on this computer or a private network: a private address, .local, .lan, .home.arpa, .internal or a one-word name).
    Use its https address. If it really is on a network you trust and has no https, add it with --insecure-http (OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1).
  ```

  Tailscale 自身的流量由 WireGuard 加密，但这条规则看的是名字，不看隧道。完整的 Tailscale 配置（MagicDNS 没有通配名字，
  作品要用 `{id}.100-101-102-103.nip.io` 并配 `OA_ALLOW_HTTP`）没有运行过。`tailscale serve` 配 https 的 `*.ts.net` 名字
  只有一个主机名，不够作品的通配用。

## 站点拒绝启动时

它会打印一行，指出是哪个设置。写指南时见到过的：

| 消息开头 | 意思 |
| --- | --- |
| `OA_CONTENT_ORIGIN: must contain {id} exactly once, … A bare address such as http://192.168.1.20:4900 cannot be the content origin.` | 作品要用 `nip.io` 名字或通配 DNS 名字。 |
| `OA_APP_ORIGIN: must use https (http is only for this computer or a private network: …; OA_ALLOW_HTTP=true allows any)` | 这个名字不算内网（公网名字、`100.x` 地址）。 |
| `OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN …` | 两个名字属于同一个站点（`nas.lan` 和 `{id}.nas.lan`）。用两个名字，或者看[只有一个域名](#只有一个域名)。 |
| `OA_CONTENT_ORIGIN: the app's host name (…) is, or is under, an artifact's content host …` | 应用的名字以 `art-` 开头，这属于作品。换一个。 |
| `OA_SIGNING_KEYS: is required: …` | 应用源不是本机或内网：把 `OA_SIGNING_KEYS` 设成一个或多个 32 字符以上的随机密钥，用逗号分隔。 |

生成签名密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## 限制

- 所有人都得在这个网络里（或者通过 VPN 接入）。
- 图片和 PDF 在各人自己的电脑上生成，从不在站点上生成。
- 站点上仪表盘的数字来自所有者的电脑：截至最后一次刷新（默认每 6 小时），而且要所有者确认数据可以发布之后才有。
- 其他设置见 `packages/host/README.md`（英文）：登录方式、`OA_SIGNUP`、`OA_LINK_MAX_ROLE`、`OA_PUBLIC_ACCESS`、
  `OA_TRASH_DAYS`、`OA_PAGE_NETWORK`。
