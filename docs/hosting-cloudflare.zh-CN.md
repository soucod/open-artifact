# Cloudflare 上的站点

[English](hosting-cloudflare.md)

**做完以后**，你会有一个运行在 Cloudflare 上的 Open Artifact 站点：应用在
`https://open-artifact.<your-subdomain>.workers.dev`，每个作品在 `https://art-….example.com`，不需要自己维护服务器。
你的 Agent 发布到这里；别人登录后打开分享给自己的作品。

**开始之前**你需要：

- 一个 Cloudflare 账号，并且有权限在上面添加 Workers、D1 和 DNS 记录；
- **一个没有别的用途的 zone（托管在 Cloudflare 上的域名）**，给作品用，比如 `example.com`。它下面的每个主机名都会
  交给这个 Worker；
- 你的电脑上装好 Node 22.18 或更高版本和 git，用来构建和部署；
- 如果选 Workers Paid，需要一个付款方式（见[费用](#费用)）。

它是什么：一个 Worker。目录库（账号、会话、分享、Link）放在一个 D1 数据库里；每个作品住在自己的 Durable Object 里（一个
自带 SQLite 存储的小服务器）；另有一个 Durable Object，也就是站点中枢（site hub），负责实时事件。静态文件（各个编辑器、
Shell）是 Worker 的 assets。

> **如果你是替人操作的 Agent**
>
> - 这些要问，不要猜：用哪个 Cloudflare 账号（一次登录可能能访问好几个）；哪个 zone 给作品用、上面有没有别的东西；应用留在
>   `workers.dev` 上，还是放到同一个 zone 上（[只有一个域名](#只有一个域名)：更弱，由这个人决定）；Worker 和数据库的名字；谁可以注册；作品能不能设为公开；仪表盘的数据能不能发布；用 Workers Free 还是 Paid。
> - 只有人能做：运行 `wrangler login`（要在浏览器里登录）；如果你的令牌不能写 DNS，添加通配 DNS 记录；用 owner key 打开
>   登录页；批准电脑；选择付费套餐。
> - 不要打印密钥。把 `OA_SIGNING_KEYS` 和 `OA_OWNER_KEY` 生成到权限 600 的文件里，再用管道交给 `wrangler secret put`；
>   告诉人 owner key 文件的路径。
> - 运行 `d1 create`、`deploy`、`delete` 或任何收费的操作之前先问。不要部署 `wrangler.rooms.jsonc`（那是一个谁都能进的
>   测试 Worker）。
> - 每一步确认后再做下一步。同一步失败两次就停下来报告。

**写指南时运行了什么。** 在本地运行过：构建、`wrangler deploy --dry-run`、`wrangler dev` 下的 Worker（健康检查、登录、
管理 API、缺少密钥时的报错），以及文中引用的所有配置消息。在 Cloudflare 上：**2026-11-22 用一个真实账号**按这些步骤做过
（一个 zone，应用在 `workers.dev` 上），下文标“2026-11-22 看到”的事实来自那次部署。和 Cloudflare 交互的命令没有为写这篇
指南再运行一次，所以没有引用它们的确切输出；其中的名字都是占位符（`<your-subdomain>`、`example.com`、`<account-id>`、
`<database-id>`）。在那次部署上和别的地方都没有试过的：`wrangler rollback`、`d1 export`、升级（在站点上部署更新的
版本）、Cloudflare Access、Workers Free、费用、删除，以及应用用 Custom Domain 的单 zone 布局（[只有一个域名](#只有一个域名)，
只在 `wrangler dev` 下运行过）。

## 布局

| | 地址 | 怎么到达 |
| --- | --- | --- |
| 应用源 | `https://open-artifact.<your-subdomain>.workers.dev` | Worker 自己的 `workers.dev` 地址。 |
| 内容源 | `https://{id}.example.com` | 一条把 `*.example.com/*` 交给 Worker 的通配**路由**，加一条开启代理的通配 DNS 记录。 |

为什么这样布局：两个源必须属于不同的可注册域名（[hosting.zh-CN.md](hosting.zh-CN.md#两个源)），而大多数人只有一个域名。
`workers.dev` 和 `example.com` 是不同的站点，所以一个 zone 就够了。Cloudflare 免费的 Universal SSL 覆盖一级名字，比如
`art-….example.com`；`{id}.content.example.com` 这种更深的名字需要付费证书。

如果你有第二个 zone，应用也可以改用那里的自定义域名（`artifacts.example.net`），同时设 `"workers_dev": false`。这种方式
在这里和 2026-11-22 都没有运行过。只有这一个 zone、又不想用 `workers.dev` 的话，见[只有一个域名](#只有一个域名)。

## 步骤

### 1. 构建

在代码仓库的根目录：

```bash
git clone https://github.com/JimLiu/open-artifact.git && cd open-artifact
```

```bash
npm ci && npm run build
```

```bash
cd deploy/cloudflare && npm ci && npm run build
```

**预期**（最后几行；在这里运行过）：

```
build: dist/site/worker.js 4.2 MB from 458 files; built-ins left to workerd: ./sheets.wasm node:buffer …
build: dist/rooms/worker.js 3.4 MB from 386 files; …
build: host plugins from plugins.mjs
build: sheets.wasm 7.8 MB; 8 types (data, design, design-system, docs, motion, sheets, slides, whiteboard); version 0.14.6
```

`deploy/cloudflare` 有自己的 `package.json`（wrangler 4.166.0、esbuild），不属于根目录的安装。

**检查：**

```bash
./node_modules/.bin/wrangler --version
```

输出 `4.166.0`。

**失败时：** 必须先运行根目录的 `npm run build`（Worker 里带着各个编辑器和 Shell）。

### 2. 登录 Cloudflare，选定账号

```bash
./node_modules/.bin/wrangler login
```

由人在浏览器里批准。然后：

```bash
./node_modules/.bin/wrangler whoami
```

**预期：** 邮箱，以及这次登录能访问的账号列表和它们的 id。

如果有不止一个账号，wrangler 在脚本里没法自己选（它会停下来问，或者直接失败）。问人用哪个，然后：

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
```

在这个终端里后面的命令都保持这个设置。2026-11-22 看到：那次登录有两个账号，需要设 `CLOUDFLARE_ACCOUNT_ID`。

**没有浏览器时**（CI，或者 agent 在一台没人能批准 `wrangler login` 的机器上）：wrangler 改用账号 API 令牌，从
`CLOUDFLARE_API_TOKEN` 读取，同时要设 `CLOUDFLARE_ACCOUNT_ID`。令牌由人在控制台创建（**Account API tokens > Create
Token**，从 **Edit Cloudflare Workers** 模板开始），存在权限 600 的文件或 CI 的密钥存储里，绝不放进仓库。按 Cloudflare
的 “Authorization” 文档（2026-11-22 读过）：第一次创建 Worker 需要 Workers 的 **Admin** 角色（之后的部署对这个 Worker
有 **Editor** 就够）；路由和 Custom Domain 需要这个 zone 上的 *Zone > Workers Routes > Write*；`d1 create`、`d1 list`
和 `d1 export` 需要账号上的 D1 权限（Workers 角色不包括 D1）；第 8 步的通配记录需要这个 zone 的 DNS 写权限。
**没有运行过：** 本指南只用 `wrangler login` 走过，到底哪一组权限刚好够用没有验证。

### 3. 创建 D1 数据库

先问：这会在账号上创建资源。

```bash
./node_modules/.bin/wrangler d1 create open-artifact
```

**预期：** 一条成功消息，和一段带新 `database_id` 的配置片段。2026-11-22 看到：片段里的绑定名是 `open_artifact`。
**Worker 要的绑定名是 `DB`。** 只把 `database_id` 抄到下一步，不要粘贴整段片段。

名字也要对上：第 4 步里的 `database_name` 必须是这里创建时用的名字（`open-artifact`），本指南后面的 `d1` 命令（`d1 export`、
`d1 delete`）也用这个名字指代数据库。如果你换了名字，三处都要改。

**检查：**

```bash
./node_modules/.bin/wrangler d1 list
```

列出 `open-artifact`。

在这里没有运行（需要账号）。

### 4. 写你自己的配置文件

你的账号 id、数据库 id 和域名不应该放进仓库里的 `wrangler.jsonc`。把它复制成 `wrangler.local.jsonc`（这个名字在
`deploy/cloudflare/.gitignore` 里，git 永远看不到它）：

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

然后在 `wrangler.local.jsonc` 里改下面这些部分，其余保持不变：

```jsonc
{
  "name": "open-artifact",
  "account_id": "<account-id>",
  // ... main、compatibility_date、flags、assets、durable_objects、migrations、triggers：不变 ...
  "d1_databases": [{ "binding": "DB", "database_name": "open-artifact", "database_id": "<database-id>" }],
  "workers_dev": true,
  "routes": [{ "pattern": "*.example.com/*", "zone_name": "example.com" }],
  "vars": {
    "OA_APP_ORIGIN": "https://open-artifact.<your-subdomain>.workers.dev",
    "OA_CONTENT_ORIGIN": "https://{id}.example.com"
  }
}
```

你现在可能还不知道 `<your-subdomain>`：第一次部署后才会显示（第 6 步）。先留着占位符。

其他设置（`OA_SIGNUP`、`OA_OWNERS`、`OA_PUBLIC_ACCESS`、`OA_LINK_MAX_ROLE`、`OA_TRASH_DAYS`……）放在 `vars` 里，含义和
Node 版相同（[hosting-server.zh-CN.md](hosting-server.zh-CN.md#先决定)）。`OA_AUTH` 里有客户端密钥：把它设成 secret
（第 7 步），不要放在 `vars` 里。Cloudflare 上不接受 `OA_ALLOW_HTTP`。

**检查：**

```bash
./node_modules/.bin/wrangler deploy --dry-run -c wrangler.local.jsonc --outdir "$(mktemp -d)"
```

**预期**（在这里用仓库里的文件运行过，即同一条命令写 `-c wrangler.jsonc`；你的会显示你自己的数据库和源）：

```
Attaching additional modules:
│ sheets.wasm      │ compiled-wasm │ 7995.03 KiB │
✨ Read 291 files from the assets directory …/deploy/cloudflare/dist/assets
Total Upload: 12321.77 KiB / gzip: 3886.45 KiB
Your Worker has access to the following bindings:
env.ROOMS (ArtifactObject)                                        Durable Object
env.HUB (SiteHubObject)                                           Durable Object
env.DB (open-artifact)                                            D1 Database
env.ASSETS                                                        Assets
env.OA_APP_ORIGIN ("http://localhost:8787")                       Environment Variable
env.OA_CONTENT_ORIGIN ("http://{id}.content.localhost:8787")      Environment Variable

--dry-run: exiting now.
```

只有一个附加模块（`sheets.wasm`），绑定名是 `env.DB`。什么都不会上传。

**失败时：** JSON 错误会指出是哪一行；看到 `env.open_artifact` 而不是 `env.DB`，说明粘贴了第 3 步的片段。

### 5. 确认 zone 没有别的用途

路由 `*.example.com/*` 会把这个 zone 下的**每个**主机名都交给 Worker。问人这个 zone 上有没有别的服务。有的话，换一个
zone，或者在控制台（**Workers Routes**）里给那个主机名加一条不指定 Worker 的路由；越具体的路由优先。2026-11-22 看到：
那个 zone 没有别的用途。

### 6. 第一次部署

先问。

```bash
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc
```

**预期：** 上传（大约 12 MiB，和 dry run 说的一样；2026-11-22 看到启动耗时 43 ms）、绑定列表、路由 `*.example.com/*`，以及 Worker 的地址
`https://open-artifact.<your-subdomain>.workers.dev`。Durable Object 的类由这次部署里的 `v1` 迁移创建。记下这个地址。

为什么要部署两次：`workers.dev` 地址要第一次部署后才知道，而 secret（下一步）只能在 Worker 存在之后设置（两点都是
2026-11-22 看到的）。secret 设好（第 7 步）之前，Worker 对每个请求（包括 `/__open-artifact/health`）都回 500，并说明
缺的第一样东西。一个 secret 都没有时（在这里用 `wrangler dev` 运行过）：

```
Open Artifact is not configured: OA_SIGNING_KEYS: is required: one or more random secrets of at least 32 characters, comma-separated (the first signs).
```

有签名密钥、没有 owner key 时：

```
Open Artifact is not configured: OA_OWNER_KEY: is required while the owner-key sign-in is on (OA_AUTH lists owner-key, the default): a Worker cannot print a generated key. Set a random secret of at least 24 characters with `wrangler secret put OA_OWNER_KEY` (locally: in .dev.vars).
```

现在把真实地址填进 `wrangler.local.jsonc` 的 `OA_APP_ORIGIN`。

### 7. 设置 secret

把它们生成到只有你能读的文件里，再用管道传进去。不会打印任何东西。

```bash
umask 077 && mkdir -p ~/.config/open-artifact
```

```bash
openssl rand -base64 48 | tr -d '\n' > ~/.config/open-artifact/signing-key.txt
```

```bash
openssl rand -base64 32 | tr -d '\n=+/' > ~/.config/open-artifact/owner-key.txt
```

```bash
./node_modules/.bin/wrangler secret put OA_SIGNING_KEYS -c wrangler.local.jsonc < ~/.config/open-artifact/signing-key.txt
```

```bash
./node_modules/.bin/wrangler secret put OA_OWNER_KEY -c wrangler.local.jsonc < ~/.config/open-artifact/owner-key.txt
```

**检查：**

```bash
./node_modules/.bin/wrangler secret list -c wrangler.local.jsonc
```

列出 `OA_SIGNING_KEYS` 和 `OA_OWNER_KEY`（只有名字）。

**失败时：** 提示 Worker 不存在，说明第 6 步没有完成。签名密钥至少 32 个字符，owner key 至少 24 个。`openssl` 命令在这里
运行过；`secret put` 在 2026-11-22 用过。

保留 `owner-key.txt`：所有者靠它登录。把路径告诉人。

### 8. 添加通配 DNS 记录

在这个 zone 上加一条记录，让每个名字都解析到 Cloudflare。这个地址永远不会被真正访问，因为路由会先应答：

| 类型 | 名称 | 内容 | 代理 |
| --- | --- | --- | --- |
| `AAAA` | `*` | `100::` | 已代理（橙色云朵） |

如果你的 wrangler 登录或 API 令牌对这个 zone 只有读权限（2026-11-22 看到：`zone (read)`，不能写 DNS），由人在控制台添加：
**DNS > Records > Add record**。

**检查：**

```bash
dig +short anything.example.com
```

**预期：** Cloudflare 的地址（不是 `100::`）。

### 9. 第二次部署

```bash
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc
```

**检查：**

```bash
curl -s https://open-artifact.<your-subdomain>.workers.dev/__open-artifact/health
```

**预期：** `{"openArtifact":1,"version":"0.14.6"}`。另外：

| 请求 | 应答 |
| --- | --- |
| `https://open-artifact.<your-subdomain>.workers.dev/` | 303，跳到 `/auth/sign-in?return_to=%2F` |
| 不是作品的名字，比如 `https://www.example.com/` 或 `https://art-test.example.com/`（`test` 不是作品 id） | 421，`www.example.com is not this site's app host nor an artifact's: Open Artifact does not answer it.` |
| 格式正确、但后面没有作品的名字，`https://art-0000000000.example.com/` | 404，`Not found.` |
| 以上任何名字上的 `/__open-artifact/health` | 200 |

表里的应答是在这里用 `wrangler dev` 看到的（应用 `http://localhost:8797`，作品 `http://{id}.content.localhost:8797`：
`www.localhost:8797` 和 `art-test.content.localhost:8797` 回 421，`art-0000000000.content.localhost:8797` 回 404）。
2026-11-22 的部署上看到了 health 和 303；对其他名字回 421 是之后才加的，没有在 Cloudflare 上看到过。目录库的表在第一个
请求时创建，没有单独的迁移步骤。

**失败时：** 500 加 `Open Artifact is not configured: …` 会指出是哪个设置。内容主机名解析不了：回到第 8 步。内容主机名
证书报错：名字在 zone 下面不止一级。

### 10. 用 owner 身份登录

由人打开 `https://open-artifact.<your-subdomain>.workers.dev/auth/sign-in`，输入 `owner-key.txt` 里的 owner key（或者打开
同一个地址，末尾加上 `#key=<owner key>`）。用它登录的人就是站点管理员。

**站点的日志。** Worker 不写日志文件。`./node_modules/.bin/wrangler tail -c wrangler.local.jsonc` 在运行期间实时显示每个
请求和 Worker 记下的内容（出错的插件、配置错误）；控制台里 Worker 的 **Logs** 也有同样的内容。**没有运行过：** 这里和
2026-11-22 都没用过。审计日志（谁做了什么，以及每条 `plugin.failed`）在目录库里：已登录的站点管理员在
`/api/open-artifact.admin.audit` 读取（[plugins.zh-CN.md](plugins.zh-CN.md#查看正在运行什么)）。

### 11. 连接你的电脑

按 [connecting-agents.zh-CN.md](connecting-agents.zh-CN.md#把电脑连接到站点) 操作，地址填 `workers.dev` 那个。想不经过
浏览器批准就配置好一台电脑，用下面的管理 API。2026-11-22 看到：通过浏览器批准完成 `remote add`、`publish`、页面外框来自
`art-….example.com`、本地改动大约 4 秒后出现在打开的页面上、分享链接、访客加入，以及从页面的 Ask 面板发出的请求到达
电脑。

**发布由人来做。** Agent 不能替人完成这一步。在 Agent 的会话里（Claude Code、Codex、Antigravity，或任何设置了会话变量的
Agent 应用）运行 `open-artifact publish` 和 `remote add` 会停下，比如：

```
open-artifact: Publishing an artifact to a site is the person's decision, and this command runs inside an agent session (claude-code: CLAUDECODE is set), so it was not done.
Ask the person to publish it from the artifact’s Share panel, or to run `open-artifact publish art_0mwrnigw79b6e26beae1fac85 --remote work` in their own terminal.
```

（在这里运行过）。这个人可以允许 Agent 发布到某一个站点（`agentMayPublish`，见
[connecting-agents.zh-CN.md](connecting-agents.zh-CN.md#默认站点和自动发布)）。另外，没有终端时（脚本、CI、管道）运行
`publish`，仪表盘上去时**不带数据行**，因为它要问的那个问题需要有人回答：

```
Its live data was not published: the page there shows no figures until the person publishes the data, from the dashboard's Share panel ("Publish its data") or with `open-artifact publish art_…` in their own terminal, which asks.
```

## 只有一个域名

应用用同一个 zone 上的 **Custom Domain** `https://app.example.com`，作品用通配路由 `https://{id}.example.com`，再加上
`OA_CONTENT_SAME_SITE=true`。这样就不用 `workers.dev` 地址了，但作品放到了应用自己的域名上，会更弱：先和对方一起读
[只有一个域名](hosting.zh-CN.md#只有一个域名)。由对方决定。

**只在 `wrangler dev` 下运行过**（见下）。没有部署过：Cloudflare 在真实 zone 上怎么分配这两者，来自 Cloudflare 的文档，
不是亲眼看到的。

请求怎么到达 Worker，依据 Cloudflare 的 “Routes” 页面（Workers > Configuration > Routing，2026-11-22 读）：路由和
Custom Domain 可以指向同一个主机名，这时 “Routes … take precedence if configured on the same hostname”；多条路由之间，
最具体的模式胜出；路由模式里不能在一段名字中间放通配符（`art-*.example.com` 无效），所以模式是 `*.example.com/*`，它匹配
所有子域名。因此到 `app.example.com` 的请求会经路由运行 Worker。那是同一个 Worker，所以结果不变；Custom Domain 的作用是
提供 DNS 记录和证书。Universal SSL 覆盖 `app.example.com` 和 `art-….example.com`（zone 下一级）。

在 `wrangler.local.jsonc` 里，代替第 4 步的值：

```jsonc
"workers_dev": false,
"routes": [
  { "pattern": "app.example.com", "custom_domain": true },
  { "pattern": "*.example.com/*", "zone_name": "example.com" }
],
"vars": {
  "OA_APP_ORIGIN": "https://app.example.com",
  "OA_CONTENT_ORIGIN": "https://{id}.example.com",
  "OA_CONTENT_SAME_SITE": "true"
}
```

再加上第 8 步的 `AAAA * 100::` 记录。应用的地址在第一次部署前就知道，所以部署之后没有占位符要替换；其他步骤不变。

这个 zone 的其他名字也会到达 Worker，这种模式下它回答 421（`www.example.com … is not this site's app host nor an
artifact's`）。`/_open-artifact/` 下的静态文件在任何经路由的名字上都会返回（它们是公开的）。想在这个 zone 上保留别的服务，
给它自己的 DNS 记录，并在后台（**Workers Routes**）为那个主机名加一条不指向任何 Worker 的路由：这样的路由会把这些请求从
通配路由里拿走。

**预期**：在 `wrangler dev` 下，设 `OA_APP_ORIGIN=http://app.oa.localhost:<port>`、
`OA_CONTENT_ORIGIN=http://{id}.oa.localhost:<port>` 和 `OA_CONTENT_SAME_SITE=true`（在这里运行过）：

| 请求 | 回答 |
| --- | --- |
| `app.oa.localhost/` | 303 到 `/auth/sign-in?return_to=%2F`，带 `Cross-Origin-Resource-Policy: same-origin` 和 `Origin-Agent-Cluster: ?1` |
| `app.oa.localhost/api/open-artifact.auth.me`，`oa_session` 发了两次 | 200，未登录，10 行删除副本的 `Set-Cookie` |
| `art-….oa.localhost/_open-artifact/support.js` | 200，`Origin-Agent-Cluster: ?1` |
| `www.oa.localhost/` | 421 |
| `www.oa.localhost/__open-artifact/health` | 200 |

**检查**，部署之后：

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.example.com/
```

**预期：** `421`（如果 `www` 上没有别的服务）。

**如果失败：** 500 `Open Artifact is not configured: OA_CONTENT_ORIGIN: must be a different site … With only one domain,
OA_CONTENT_SAME_SITE=true allows it …` 说明 `vars` 里少了这个变量。`app.example.com` 上出现 421，说明 `OA_APP_ORIGIN`
和它不完全一致。应用上出现证书错误：Custom Domain 没有加上（`wrangler deploy` 会按 `routes` 加上它）。

## Cloudflare 上的 Link 令牌

Worker 旁边没有能操作目录库的命令行，所以 `open-artifact-host link-token` 在这里是应用源上的一个 API，给已登录的站点
管理员用。登录后在站点页面的浏览器控制台里：

```js
await (await fetch('/api/open-artifact.admin.link-tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'ada@example.com', label: 'Ada laptop' }) })).json();
```

**预期**（在这里用 `wrangler dev` 运行过，略去令牌）：

```
{"id":"agt_SUJBbO8G2k5wMbl-zfD1Dw","user":"ada@example.com","remote":"http://localhost:8787","token":"<shown once>"}
```

把 `remote` 作为 `OPEN_ARTIFACT_REMOTE`、`token` 作为 `OPEN_ARTIFACT_REMOTE_TOKEN` 交给那台电脑
（[预设](connecting-agents.zh-CN.md#提前配置电脑)）。撤销：

```js
await (await fetch('/api/open-artifact.admin.link-tokens.revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'agt_…' }) })).json();
```

**预期：** `{"revoked":"agt_…"}`（在这里运行过）。没有登录会话时 API 回 401
`{"code":"unauthorized","message":"Sign in first.",…}`；它也拒绝 Bearer 令牌和来自其他站点的请求。

## 登录方式和 Cloudflare Access

登录方式和 Node 版一样（[hosting-server.zh-CN.md](hosting-server.zh-CN.md#登录方式)），回调地址在应用源上：
`https://open-artifact.<your-subdomain>.workers.dev/auth/<id>/callback`。`OA_AUTH` 里有客户端密钥，用
`wrangler secret put OA_AUTH` 设置。

**Cloudflare Access** 也可以负责登录：在 `OA_AUTH` 里写
`{"kind":"cloudflare-access","teamDomain":"https://<team>.cloudflareaccess.com","aud":"<application AUD tag>"}`。站点在
每个请求上检查 `Cf-Access-Jwt-Assertion`（签名、签发者、受众、过期时间）。程序用自己的令牌调用的路径必须**绕过** Access：
`/api/open-artifact.link.*`、`/mcp`、`/.well-known/oauth-*`、`/oauth/token`、`/oauth/register`、`/oauth/revoke`；内容
主机名不需要 Access 应用。完整的表格和两种布局见 `deploy/cloudflare/README.md`（“Cloudflare Access” 一节，英文）。
**没有运行过**，在这里和 2026-11-22 都没有：只跑过令牌校验的单元测试。

## 费用

没有用实际账单核对过。下面来自 2026-11-22 读到的 Cloudflare 价格页面（美元；以页面为准）：

- **Workers Paid，每月最低 5 美元**，是实际可用的套餐：包含 1000 万次请求和 3000 万 CPU 毫秒。Workers Free 每个请求只允许
  10 毫秒 CPU，打开和导入作品经常会超过。
- **Durable Objects：** 按对象在内存里的时间计费。一个作品的对象在它最后一个页面关闭大约一分钟后离开内存
  （`OA_ROOM_IDLE_CLOSE_MS`，默认 60000）。**什么会让 room 保持唤醒：** 只有打开着这个作品的标签页，没有别的；没有轮询。
  **什么会让站点中枢保持唤醒：** 任何打开着的 Shell 标签页，以及每台连接着的电脑（中枢为它保持事件流）。一台一直开着并
  连接着的电脑，会让中枢一直留在内存里。
- **D1：** 按读写的行数计费。本地计数：首页 3 次查询，作品列表 10 次查询，和列表长短无关。

## 限制

| | Cloudflare | Node |
| --- | --- | --- |
| 上传（`.zip`） | 32 MiB | 100 MiB |
| 一次 Link 推送 | 32 MiB，单个文件最大 16 MiB | 100 MiB，单个文件最大 64 MiB |
| 每个作品的存储 | 10 GB（Paid），1 GB（Free） | 磁盘大小 |
| 目录库 | D1：10 GB（Paid），500 MB（Free） | 磁盘大小 |

## Page 作品

`page` 作品（Agent 写的自由 HTML 页面，见 [Page](types/page.zh-CN.md)）在 Worker 上的运行方式和 Node 站点一样（见
[页面类作品](hosting.zh-CN.md#页面类作品)）：作品的内容主机提供内层外壳（`art-<id>.example.com/page/<页面令牌>/`），每个人在
自己的页面主机 `art-<id>--<24 个字符>.example.com` 上看到页面，这个主机只提供页面的文件。两者都在作品的 Durable Object 里
运行，和它的文件、数据库在一起。

- **路由和 DNS 不用改。** 页面主机只是内容源通配符下的又一个名字：路由 `*.example.com/*` 把它送到 Worker，第 8 步的
  `AAAA * 100::` 记录解析它，Universal SSL 也覆盖它（它在 zone 下一级）。内容源更深（`{id}.content.example.com`）时，页面
  主机一样深，需要同样的付费证书。
- Worker 把页面主机的请求不带 cookie 地交给作品的对象，对象按这个人当前的权限检查 `--` 后面的部分：这个人失去权限，或者
  所有人被登出时，它就失效。
- **`OA_PAGE_NETWORK`**（`vars` 里的一项）：`self`（默认），页面只能访问自己的源；`https`，还能访问任意 https 源。其他值会
  让站点报配置错误，并写出这个变量名。
- **只有一个域名**（`OA_CONTENT_SAME_SITE=true`）：站点不运行页面。`link.hello` 不带 `features.pages`，发布页面会以
  `unsupported` 被拒绝，页面主机会像不认识的名字一样得到 421。
- **不支持页面的快照地址**：站点会拒绝（403），和 Node 站点一样。请改为分享页面。
- 框架自己的脚本作为 Worker 静态资源存在 `/_open-artifact/frame/<hash>/`，每次构建都换新路径。对象在每个 isolate 里从那里
  读一次，再自己提供给页面，不缓存，和 Node 站点一样。
- 打开的页面和它的对象之间有一条 WebSocket，对象用 `accept()` 接受它（不休眠），所以页面开着时对象一直在内存里，和作品的
  任何一个打开的标签页一样（见[费用](#费用)）；最后一个关掉后大约一分钟对象关闭（`OA_ROOM_IDLE_CLOSE_MS`）。

**这里只在 `wrangler dev` 下运行过**（`e2e/cloudflare-page.test.mjs`，页面主机在 `*.content.localhost` 上）：从电脑发布一个
页面，所有者打开它；另一个人用 viewer 链接加入，之后被改成 commenter；页面上的写入回到电脑上的文件夹，本地的修改出现在打开
的页面上；`link.hello` 带 `features.pages`；通过远程 MCP 改的能力声明回到电脑上的
`.artifact.json`；上传的 page zip。没有部署过。

## 这里不支持的

- `open-artifact-host` 命令：`link-token` 由上面的管理 API 代替；备份用 D1 Time Travel 加上每个作品的导出。
- 构建之后新加的类型：类型是构建进去的；要加一个就重新构建并部署。
- 在站点上生成图片和 PDF：和所有站点一样，在各人自己的电脑上生成。
- 仪表盘的实时连接器：它的数字来自所有者的电脑，截至最后一次刷新（默认每 6 小时），并且要所有者确认数据可以发布之后才有。
- `OA_ALLOW_HTTP`，以及除 `wrangler dev` 下的 `localhost` 之外的任何 http。
- page 作品的快照地址；[只有一个域名](#只有一个域名)模式下的所有页面。

## 更新

```bash
git pull && npm ci && npm run build && cd deploy/cloudflare && npm ci && npm run build
```

```bash
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc
```

目录库在部署后的第一个请求时迁移。只改了代码的部署可以用 `wrangler rollback` 撤回。升级和回滚都没有运行过，在这里和 2026-11-22 的部署上都没有。

## 导出和备份

- 目录库：D1 Time Travel 可以恢复到最近 30 天（Paid）或 7 天（Free）里的任意一分钟。想自己留一份：
  `./node_modules/.bin/wrangler d1 export open-artifact --remote --output=catalog.sql -c wrangler.local.jsonc`。
  没有运行过，在这里和 2026-11-22 的部署上都没有。
- 作品：没有覆盖整个账号的 Durable Object 存储导出。每个作品的所有者在 Shell 里下载它（导出里的“整个文件夹（.zip）”）；
  连接着的电脑上的工作副本就是一份完整副本。恢复时在首页上传那个 zip，或者重新发布。

## 全部删除

先问；这会永久删除站点上的所有作品。在这里和 2026-11-22 都没有运行（那次部署保留着）。

```bash
./node_modules/.bin/wrangler delete -c wrangler.local.jsonc
```

```bash
./node_modules/.bin/wrangler d1 delete open-artifact
```

然后由人删掉 zone 上的 `AAAA *` 记录，你再删掉 `~/.config/open-artifact/` 里的密钥文件。

## 先在本地试一下

不需要账号（在这里运行过）：

```bash
cp .dev.vars.example .dev.vars
```

在 `.dev.vars` 里设置 `OA_SIGNING_KEYS` 和 `OA_OWNER_KEY`（这个文件被 git 忽略），然后：

```bash
PORT=8797 PERSIST_TO=/tmp/oa-cf-state npm run dev -- --ip 127.0.0.1
```

`npm run dev` 运行的是 `dev.sh`：它**每次都会重新构建 Worker**（`node build.mjs`，几秒钟；根目录的 `npm run build` 不会
重跑，改了编辑器或 Shell 要自己先构建根目录），然后启动 `wrangler dev`：应用在 `http://localhost:$PORT`（默认 8787），作品在
`http://{id}.content.localhost:$PORT`，状态存在 `PERSIST_TO`（默认 `./.state`）。`--` 后面的参数都交给 `wrangler dev`。
想把 secret 放在 `.dev.vars` 以外的地方，给一个同样是 `NAME=value` 行的文件：

```bash
PORT=8797 PERSIST_TO=/tmp/oa-cf-state npm run dev -- --ip 127.0.0.1 --env-file ~/.config/open-artifact/dev.env
```

**预期：** `Using secrets defined in …/dev.env`（或 `.dev.vars`）、绑定列表，然后是
`[wrangler:info] Ready on http://127.0.0.1:8797`（两种写法都在这里运行过）。
`curl -s http://localhost:8797/__open-artifact/health` 回 `{"openArtifact":1,"version":"0.14.6"}`；在
`http://localhost:8797/auth/sign-in` 用 owner key 登录。作品在 `http://{id}.content.localhost:8797`。用 Ctrl-C 停止；删掉
`PERSIST_TO` 指向的文件夹就能从头开始。

**失败时：** 每个请求（包括 health）都回 500 `Open Artifact is not configured: OA_SIGNING_KEYS: is required …`，说明
wrangler 没读到 secret：`deploy/cloudflare` 里没有 `.dev.vars`，或者 `--env-file` 路径写错了。用 `curl` 带一个不可能是
名字的 Host（`-H 'Host: a b'`）会得到 `wrangler dev` 自己回的 500 `Internal Server Error`，请求根本到不了 Worker；在
Cloudflare 上这种请求到不了 Worker，在 Node 上会得到 400。
