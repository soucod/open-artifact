# 带域名的自有服务器站点

[English](hosting-server.md)

**做完以后**，你会在互联网上有一个 Open Artifact 站点，地址类似 `https://artifacts.example.com`，证书自动续期，有登录页，
需要的话还有每天的备份。你分享给谁，谁就能打开；你的 Agent 发布到这里。

**开始之前**你需要：

- 一台有公网 IPv4（IPv6 可选）地址的服务器：VPS、EC2 实例，或者做了端口转发的家用服务器；2 GB 内存比较宽裕；
- 服务器上装好 Docker 和 Compose 插件（或者 Node 22.18 或更高版本，加上你已经在用的反向代理）；
- **两个属于不同可注册域名的名字**，DNS 由你管理，比如应用用 `artifacts.example.com`，作品用 `oa-content.example.net`
  （原因见 [hosting.zh-CN.md](hosting.zh-CN.md#两个源)）。只有一个域名的话，见[只有一个域名](#只有一个域名)：能用，但更弱；
- 互联网能访问到 80 和 443 端口；
- 一个邮箱，用来接收 Let's Encrypt 的证书到期提醒。

> **如果你是替人操作的 Agent**
>
> - 这些要问，不要猜：应用主机名和内容域名；只有一个域名时，对方是否接受[只有一个域名](#只有一个域名)的做法（读过它削弱了什么之后，由对方决定）；云账号和区域（AWS）；谁可以注册（`OA_SIGNUP`）、谁是管理员（`OA_OWNERS`）；
>   用哪些登录方式；作品能不能设为公开（`OA_PUBLIC_ACCESS`）；仪表盘的数据能不能发布。
> - 只有人能做：添加 DNS 记录；在 Google、GitHub 或自己的身份服务里创建 OAuth 应用；打开 owner 登录地址；批准电脑；
>   接受费用。
> - 不要打印密钥：`OA_SIGNING_KEYS`、`OA_OWNER_KEY`、OAuth 客户端密钥和 DNS API 令牌都在 `deploy/docker/.env`（权限 600）
>   里。告诉人这个路径，不要显示内容。
> - 创建服务器、堆栈、存储桶或任何收费资源之前先问，删除任何东西之前也先问。
> - 每一步确认后再做下一步。同一步失败两次就停下来报告。

**写指南时运行了什么。** 写这篇指南的地方没有装 Docker，所以**镜像从没构建过，Compose 和 Caddy 也从没在这里启动过**；
也没有动 AWS。运行过的有：不用 Docker 的站点本身（就是镜像里运行的那个程序）、`deploy/docker/stage.sh`（镜像里的文件集，
输出 `staged the host into …`）、备份和恢复脚本，以及文中引用的所有站点命令和消息。用到 Docker、Caddy、DNS 或 AWS 的步骤
都标了**未运行**。

## 先决定

| 问题 | 设置项 | 默认 |
| --- | --- | --- |
| 应用的主机名 | `APP_HOST` | 无 |
| 内容域名（另一个可注册域名） | `CONTENT_DOMAIN` | 无 |
| 内容域名就是应用自己的域名（[只有一个域名](#只有一个域名)） | `OA_CONTENT_SAME_SITE` | `false` |
| 每个作品按需申请证书，还是用 DNS 申请一张通配证书 | `COMPOSE_FILE` | 按需 |
| 登录方式 | `OA_AUTH` | 只有 owner key |
| 谁登录时会自动建账号 | `OA_SIGNUP` | `invite` |
| 站点管理员 | `OA_OWNERS` | 无（owner key 用户；为空时第一个账号也是） |
| 分享链接最高给到什么角色 | `OA_LINK_MAX_ROLE` | `editor` |
| 作品能不能设为公开 | `OA_PUBLIC_ACCESS` | `true` |

## 步骤（Docker Compose 加 Caddy）

### 1. 添加 DNS 记录

由人在 DNS 服务商那里添加，指向服务器的地址：

```
artifacts.example.com.          A     203.0.113.10
*.oa-content.example.net.       A     203.0.113.10
```

服务器有 IPv6 的话再加 `AAAA` 记录。如果 DNS 在 Cloudflare，记录设成**仅 DNS**（灰色云朵），除非你明确要让 Cloudflare 的
代理挡在前面。

**检查：**

```bash
dig +short artifacts.example.com
```

```bash
dig +short anything.oa-content.example.net
```

**预期：** 两次都是服务器的地址。

**失败时：** 等记录生效（几分钟到一小时）；确认通配记录是 `*.oa-content.example.net`，不是 `*.example.net`。

未运行（没有域名）。

### 2. 把代码放到服务器上，填写 `.env`

```bash
git clone https://github.com/JimLiu/open-artifact.git && cd open-artifact/deploy/docker
```

```bash
cp .env.example .env && chmod 600 .env
```

生成一个签名密钥（它签署页面地址和分享链接；要保存好，恢复时需要同一个）：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

（服务器上没有 Node 就用 `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`。）把它写进 `.env` 的 `OA_SIGNING_KEYS=`，
至少设置这些：

```
APP_HOST=artifacts.example.com
CONTENT_DOMAIN=oa-content.example.net
ACME_EMAIL=you@example.com
OA_SIGNING_KEYS=<the key>
OA_SIGNUP=invite
```

`.env.example` 里其他设置都有注释，留空就是默认值。

**检查：** `grep -c '^OA_SIGNING_KEYS=.\{32,\}' .env` 输出 `1`（不会显示密钥本身）。

**失败时：** 密钥至少 32 个字符；多个密钥用逗号分隔，第一个用来签名。

生成签名密钥的命令运行过，其余未运行。

### 3. 选择证书方式

- **按需申请（默认，`Caddyfile.on-demand`）。** 每个作品的主机名第一次被访问时，Caddy 为它申请证书（HTTP-01）。申请前
  Caddy 会先问站点的内部接口 `http://host:4901/tls-ask`，它只对应用主机名、以及存在且不在回收站里的作品回答“可以”，所以
  外人没法让 Caddy 为乱编的名字申请证书。作品第一次被访问时要等几秒。Let's Encrypt 对每个注册域名每周最多发 50 张新证书；
  超过了就改用通配证书。
- **用 DNS-01 申请一张通配证书。** 在 `.env` 里加上：

  ```
  COMPOSE_FILE=compose.yaml:compose.dns.yaml
  CLOUDFLARE_API_TOKEN=<对内容域名所在 zone 有 Zone / DNS / Edit 权限的令牌>
  ```

  Compose 会构建一个带 Cloudflare DNS 插件的 Caddy（`caddy/Dockerfile`，`caddy-dns/cloudflare@v0.2.4`），并使用
  `Caddyfile.dns`。换别的 DNS 服务商，按 `Caddyfile.dns` 里的注释设置 `CADDY_DNS_MODULE` 并改掉 `dns cloudflare …` 那一行。

两种方式下，Caddy 都原样转发 `Host` 头，设置 `X-Forwarded-Proto`/`-Host`/`-For`（站点信任它们，因为 compose 设了
`OA_TRUST_PROXY=1`，而且不对外公开站点自己的端口），不缓冲服务器推送事件（`flush_interval -1`），上游空闲连接保持 90 秒
（比站点的 130 秒短），允许最大 101 MiB 的请求体。

### 4. 启动

```bash
docker compose up -d --build
```

**预期：** 两个服务，`host` 和 `caddy`。`host` 健康之后 Caddy 才启动（健康检查每 30 秒访问一次 `/__open-artifact/health`）。

**检查：**

```bash
docker compose ps
```

显示 `host` 为 `healthy`，`caddy` 为 `running`。然后：

```bash
curl -s https://artifacts.example.com/__open-artifact/health
```

**预期：** `{"openArtifact":1,"version":"0.14.6"}`（这个应答是在不用 Docker 运行同一个程序时看到的）。

**失败时：** `docker compose logs host` 里有 `open-artifact-host: OA_…` 一行，指出哪个设置不对；`docker compose logs caddy`
里是证书错误（DNS 还没指过来、80 端口没开，或者 ask 接口拒绝了某个名字）。Caddy 会一直重试，之后把 DNS 改好就行。

未运行（没有 Docker）。

### 5. 用 owner 身份登录

```bash
docker compose exec host node packages/host/src/node/main.ts owner-key
```

**预期**（同一个命令不用 Docker 运行时的输出）：

```
A new owner key replaces the old one. Sign in as the owner at:
  https://artifacts.example.com/auth/sign-in#key=<secret>
```

由人打开这个地址，并存进密码管理器。如果 `.env` 里设了 `OA_OWNER_KEY`，这个命令会拒绝；那时地址就是
`https://artifacts.example.com/auth/sign-in#key=` 后面接那个值。两者都没有的话，第一次启动时在 `docker compose logs host`
里打印过一个地址。

**检查：** 打开 `https://artifacts.example.com/` 看到的是首页，不是登录页。

### 6. 连接你的电脑

按 [connecting-agents.zh-CN.md](connecting-agents.zh-CN.md#把电脑连接到站点) 操作，地址填
`https://artifacts.example.com`。

## 登录方式

`OA_AUTH` 是一个 JSON 数组，在 `.env` 里写成一行。每个跳转式登录服务都要登记一个回调地址：`<应用源>/auth/<id>/callback`。

| 登录服务 | 配置项 | 要登记的回调地址 |
| --- | --- | --- |
| Owner key | `{"kind":"owner-key"}` | 无 |
| Google（OIDC） | `{"kind":"oidc","id":"google","name":"Google","issuer":"https://accounts.google.com","clientId":"…","clientSecret":"…"}` | `https://artifacts.example.com/auth/google/callback` |
| GitHub（**OAuth App**，不是 GitHub App） | `{"kind":"github","clientId":"…","clientSecret":"…"}` | `https://artifacts.example.com/auth/github/callback` |
| 其他 OIDC（Okta、Keycloak、Authentik、Microsoft Entra） | `{"kind":"oidc","id":"sso","name":"Company SSO","issuer":"https://login.example.com/realms/staff","clientId":"…","clientSecret":"…","scopes":["openid","email","profile","groups"]}` | `https://artifacts.example.com/auth/sso/callback` |

- `id` 只能用小写字母、数字、`-` 和 `_`；它就是回调地址里 `/auth/` 后面那一段。
- OIDC 的 `issuer` 必须是 https。只有登录服务标明已验证的邮箱才算数；群组取自 `groups` 声明。GitHub 申请的权限是
  `read:user user:email`。
- 在另一个管理员能登录之前，保留 `{"kind":"owner-key"}`。

示例：

```
OA_AUTH=[{"kind":"owner-key"},{"kind":"github","clientId":"Iv1.abc","clientSecret":"…"}]
```

改完运行 `docker compose up -d`（会用新的 `.env` 重建容器）。没有对真实登录服务运行过；回调路径来自
`packages/host/src/core/auth/fetch.ts` 里的 `callbackUrl()`。

## 谁可以注册

`OA_SIGNUP` 决定谁第一次用登录服务登录时会自动建账号：

| 值 | 谁 |
| --- | --- |
| `invite`（默认） | 已经有作品通过邮箱、域名或群组分享给他的人 |
| `owners-only` | 只有 `OA_OWNERS` 里的邮箱 |
| `domain:example.com` | 已验证邮箱在这个域名下的任何人 |
| `open` | 能用你的任一登录方式登录的任何人 |

没有账号的人，仍然可以通过分享链接以具名访客身份打开作品，角色最高到 `OA_LINK_MAX_ROLE`。

## 在 AWS 上用 CloudFormation

**未运行**（没有用 AWS 账号；模板只做了离线检查）。`deploy/aws/open-artifact-host.yaml` 创建一台 EC2 实例（默认 Ubuntu
24.04、t3.medium），带一块挂在 `/srv` 的加密数据卷、一个弹性 IP、一个安全组（80，443 的 tcp 和 udp；22 端口只在设了
`SshCidr` 时对它开放），以及一个用于 Session Manager 的角色。首次启动时它安装 Docker，按 `RepoRef` 克隆仓库，写好带新
`OA_SIGNING_KEYS` 的 `.env`，运行 `docker compose up -d --build`，并设置每天的备份定时器（写到 `/srv/backups`，给了
`BackupBucket` 的话也传到 S3）。

```bash
aws cloudformation deploy --stack-name open-artifact --template-file deploy/aws/open-artifact-host.yaml --capabilities CAPABILITY_IAM --parameter-overrides AppHost=artifacts.example.com ContentDomain=oa-content.example.net AcmeEmail=you@example.com VpcId=vpc-0123456789abcdef0 SubnetId=subnet-0123456789abcdef0
```

然后按输出 `DnsRecords` 添加 DNS 记录，用输出 `Shell` 里的命令打开一个 shell，再用
`sudo sh -c 'cd /srv/open-artifact/deploy/docker && docker compose exec host node packages/host/src/node/main.ts owner-key'`
拿到 owner 地址。子网必须是公有子网。如果要用存储桶，需要你自己先建好。费用包括实例、数据卷、弹性 IP 和数据传输。
`deploy/aws/README.md`（英文）里有实例上的升级、恢复，以及为什么不用 Fargate。

## 升级

```bash
cd deploy/docker && ../backup.sh
```

```bash
git pull && docker compose up -d --build
```

新版本启动时目录库会自动迁移。Compose 给旧容器 30 秒退出。**检查：** 健康检查返回新版本号。未运行（没有 Docker）。不用
Docker 时就是 `git pull && npm ci && npm run build`，再重启你的服务。

## 备份和恢复

`deploy/backup.sh` 写出一个 `.tar.gz`，里面有目录库的精确副本（站点运行中生成）、`artifacts/` 目录，以及 `keys.json`（如果
有）。设置项：`BACKUP_DIR`（默认 `/var/backups/open-artifact`）、`BACKUP_KEEP`（默认 7）、`BACKUP_S3`（一个
`s3://bucket/prefix`，需要 `aws` 命令行）。

```bash
deploy/backup.sh
```

用 Compose 时它通过 `docker compose exec` 读取 `host` 容器（未运行）。不用 Docker 时设置 `OA_DATA_DIR`，这种方式运行过：

```
wrote /…/backups/open-artifact-20261122T094930Z.tar.gz (112640 bytes)
```

用 Compose 恢复（未运行）：

```bash
docker compose down
```

```bash
docker run --rm -v open-artifact_oa-data:/data -v /var/backups/open-artifact:/b alpine sh -c 'rm -rf /data/* /data/.backup-host.db; tar -xzf /b/open-artifact-20261122T094930Z.tar.gz -C /data && mv /data/.backup-host.db /data/host.db && chown -R 1000:1000 /data'
```

```bash
docker compose up -d
```

不用 Docker 时，解压到一个空目录，把 `.backup-host.db` 改名为 `host.db`，再让 `OA_DATA_DIR` 指向它启动（运行过：恢复后的
站点能启动，备份时有效的 owner key 能登录，作品能打开）。

保留同一个 `OA_SIGNING_KEYS`（它在 `.env` 里，不在备份包里）：没有它，之前生成的分享链接地址和已打开的页面都会失效。把
`.env` 存一份到密码管理器。

## 放在你已有的反向代理后面

用你的服务管理器运行 `node packages/host/src/node/main.ts serve`（参考 [hosting-lan.zh-CN.md](hosting-lan.zh-CN.md#linuxsystemd)
里的 systemd 配置），设置 `OA_BIND=127.0.0.1`、`OA_TRUST_PROXY=1`、https 的源和 `OA_SIGNING_KEYS`。你的代理必须：

- 把两个名字（应用主机名和内容域名的 `*.`）都转给站点，`Host` 原样传递或设置 `X-Forwarded-Host`，并设置
  `X-Forwarded-Proto: https`；
- 放行 WebSocket 升级；
- 不缓冲 `text/event-stream`（站点已经为 nginx 发送了 `X-Accel-Buffering: no`）；
- 上游空闲连接保持时间短于 130 秒（站点在代理后面的空闲时间），否则会随机出现 502；
- 允许最大 101 MiB 的请求体；
- 有覆盖通配名字的证书（通常用 DNS-01 申请）。

nginx，**未运行**（`packages/host/test/proxy.test.ts` 用一个小测试代理检查了同样的要求）：

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
  listen 443 ssl;
  server_name artifacts.example.com *.oa-content.example.net;
  # ssl_certificate / ssl_certificate_key：要覆盖这两个名字
  client_max_body_size 101m;
  location / {
    proxy_pass http://127.0.0.1:4900;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

只有当代理是访问站点的唯一入口时才设 `OA_TRUST_PROXY=1`；否则任何人都能指定站点以为自己在服务哪个源。

## 只有一个域名

只有一个域名时，应用用 `app.example.com`，作品用 `{id}.example.com`。在 https 上代价不大，但不是没有：作品页面和登录页在
同一个域名下（仿冒页面、按域名填充的密码管理器），也和 `example.com` 上的其他服务在一起（它们的 cookie）。和对方一起读
[只有一个域名](hosting.zh-CN.md#只有一个域名)；由对方决定。

在 `.env` 里：

```
APP_HOST=app.example.com
CONTENT_DOMAIN=example.com
OA_CONTENT_SAME_SITE=true
```

DNS，在第 1 步：

```
app.example.com.          A     203.0.113.10
*.example.com.            A     203.0.113.10
```

通配记录也会接住这个域名下所有没有自己记录的名字，所以给 `example.com` 上的其他服务（`www`、`mail`）各自加上记录。仍然
到了这台服务器的名字不会被服务：按需申请证书时，站点的 ask 接口不给它证书；用 DNS 通配证书时，Caddy 把它转给站点，站点回答
421。Let's Encrypt 每个注册域名每周 50 张新证书的上限，现在和 `example.com` 上的其他服务共用；超过了就改用通配证书。Caddy
用 `app.example.com` 自己的配置块服务它，因为确切的名字优先于 `*.example.com`。

**预期：** `docker compose logs host` 显示 `content: https://{id}.example.com (same site as the app:
OA_CONTENT_SAME_SITE)`。

**检查：**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://app.example.com/
```

**预期：** `303`（跳到登录页）。发送两次的 cookie 被拒绝、它的会话被结束、副本被删除：

```bash
curl -s -o /dev/null -D - -H 'cookie: __Host-oa_session=a; __Host-oa_session=b' https://app.example.com/api/open-artifact.auth.me | grep -ci '^set-cookie'
```

**预期：** `1`（`__Host-` cookie 只有一个地方要删），`docker compose logs host` 里有 `refused duplicate cookies
(__Host-oa_session) on /api/open-artifact.auth.me`。

**如果失败：** `must be a different site … OA_CONTENT_SAME_SITE=true allows it`：`.env` 里没有这个设置，或者 `compose.yaml`
比这个设置旧（新版会把 `OA_CONTENT_SAME_SITE` 传给站点）。`app.example.com` 上出现 421：`APP_HOST` 和你输入的名字对不上。
`the app's host name … is, or is under, an artifact's content host`：应用的名字以 `art-` 开头；换一个。

**这里没有运行**（没有 Docker，也没有域名）。站点自己的回答（421、重复 cookie 的拒绝、启动时那一行）在这里不用 Docker、
用 http 名字运行过；`__Host-` 的情况由 `packages/host/test/same-site.test.ts` 覆盖。

## 出问题时

| 看到的现象 | 原因 |
| --- | --- |
| 站点停在 `open-artifact-host: OA_APP_ORIGIN: must use https …` | 公网名字用了 `http://` 源。 |
| `OA_CONTENT_ORIGIN: must be a different site from OA_APP_ORIGIN …` | 内容域名是应用所在可注册域名的子域名。换一个域名，或者看[只有一个域名](#只有一个域名)。 |
| `421 … is not this site's app host nor an artifact's` | 只有一个域名时：一个既不是 `APP_HOST`、也不属于作品的名字到了站点。 |
| `OA_SIGNING_KEYS: is required: …` | `.env` 里没设。 |
| 登录后又回到登录页 | 浏览器通过 http 访问了一个 https 源的站点（cookie 带 `Secure`）。 |
| 作品页面打不开 | `dig +short anything.<内容域名>` 不是这台服务器；或者用按需证书时，`docker compose logs caddy` 显示 ask 接口拒绝了某个名字（作品不存在或在回收站里）。 |
| 在你的代理后面实时编辑不工作 | 没有放行 WebSocket 升级。 |
| 列表和 Link 的更新来得很慢 | 代理在缓冲 `text/event-stream`。 |

## 限制

- 图片、PDF、视频在各人自己的电脑上生成，从不在站点上生成。
- 站点上仪表盘的数字来自所有者的电脑，截至最后一次刷新（默认每 6 小时，或者有人点了刷新），而且要所有者确认数据可以
  发布之后才有。
- 站点是单个进程，不适合在负载均衡后面跑多份。
- 上传和 Link 推送最大 100 MiB，一次推送里单个文件最大 64 MiB。
