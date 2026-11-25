# 插件：在站点上接入你自己的登录、权限和规则

[English](plugins.md)

**插件**把只有你的组织才知道的东西加到站点上：大家怎么登录、谁能打开什么、哪些操作必须拒绝、出了什么事要通知哪些系统。
它是一个 JavaScript 文件（或一个 npm 包），站点启动时加载。同一个插件在 Node 站点和 Cloudflare 上都能跑。

大多数人只需要**用**插件：选一个，把它的设置写进列表，重启站点。这是本页的前半部分。后半部分写给要**写**插件的人。

> **如果你是替人操作的 Agent**
>
> - 要问，不要猜：到底要不要装插件；信任哪个登录系统或权限系统；权限服务能看到人的哪些信息（每次询问都会发送这个人的
>   邮箱、所在组和作品标题）；哪个部门、组或地址给什么角色。
> - 插件拥有站点的全部权限。只装对方选定的代码，并说明它的来源。
> - 不要打印任何密钥（共享密钥、各种 key、Webhook 地址、所有者密钥）。放进环境变量或 Worker secret，并说明放在哪里。
> - 每次重启前先运行 `plugin check`。线上站点要得到对方同意才能重启。
> - 每一步先用它的 **检查：** 确认，再做下一步。同一步失败两次就停下，报告你运行了什么、看到了什么。

## 插件能做什么，一屏看完

| 你想要 | 钩子 | `examples/host-plugins/` 里的例子 |
| --- | --- | --- |
| 用公司账号登录（代理加的请求头、你们的 JWT Cookie、你们的 SSO） | `auth.authenticate`、`auth.signIn` | `header-auth.mjs`、`company-jwt.mjs` |
| 任何方式登录后补上所在组，或者拒绝某些人 | `auth.identity` | `company-jwt.mjs`（拒绝不在名单里的部门） |
| 权限来自你自己的服务 | `authz.role` | `http-authz.mjs` |
| 权限来自设置里的一张表（“设计组能编辑所有作品”） | `authz.role` | `static-groups.mjs`、`company-jwt.mjs` |
| 按规定拒绝某个操作（不许公开链接、不许下载、不许上传超过 10 MB 的文件） | `guard` | `company-jwt.mjs`（不许公开链接） |
| 把发生的事告诉 Slack 或你的日志系统 | `on.<event>` | `webhook-events.mjs` |
| 有东西分享给某人时给他发邮件 | `on.share.invited` | `invite-email.mjs` |
| 在站点页面上加一个链接或公司名称 | `ui` | `company-jwt.mjs`（账户菜单里的“My department”） |
| 插件自己的网址（接收 Webhook、一个小页面） | `routes` | `http-authz.mjs`（`/plugins/http-authz/invalidate`） |
| 把发给所有者 Agent 的请求交给你自己的执行器 | `wake.deliver` | 暂无 |

插件目前做不到的事见[插件做不到的事](#插件做不到的事)。

## 使用插件（运维）

### 插件列表

站点只读一份列表。每一项指定一个插件（`use`），并给出它的设置（`config`）：

```json
[
  { "use": "/srv/open-artifact/examples/host-plugins/header-auth.mjs",
    "config": { "secret": { "env": "PROXY_SECRET" }, "groupsHeader": "x-forwarded-groups" } },
  { "use": "/srv/open-artifact/examples/host-plugins/static-groups.mjs",
    "config": { "groups": { "design": "bob@example.com, carol@example.com", "staff": "@example.com" },
                "roles": { "staff": "viewer", "design": "editor" } },
    "cacheSeconds": 300 },
  { "use": "/srv/open-artifact/examples/host-plugins/webhook-events.mjs",
    "config": { "url": { "env": "SLACK_WEBHOOK_URL" }, "format": "slack" },
    "optional": true, "timeoutMs": 2000 }
]
```

| 字段 | 含义 |
| --- | --- |
| `use` | 插件文件的路径，或 npm 包名。在 Cloudflare 上：打包时给它起的名字。 |
| `config` | 插件的设置。每个插件有自己的一组（`plugin list` 会列出名字）。 |
| `enabled` | `false`：保留这一项，但不运行。 |
| `optional` | 加载不了或设置有错时，站点照常启动，只是不带它（并在日志里说明原因），而不是拒绝启动。用于可有可无的插件，登录和权限插件不要用。 |
| `timeoutMs` | 每次调用的时间上限，1 到 60000 毫秒，默认 5000。 |
| `cacheSeconds` | 站点复用一个权限答复的时长，0 到 86400 秒。优先于插件自己的默认值。 |

只写一个字符串（`"./audit.mjs"`）等于只有 `use` 的一项。顺序有影响：登录时第一个认出这个人的插件生效；算角色时，
每个插件看到的是前一个插件的答复。

### 列表放在哪里

| 站点 | 列表 | 哪个生效 |
| --- | --- | --- |
| Node | 环境变量 `OA_PLUGINS`（JSON），或文件 `OA_PLUGINS_FILE`（默认 `<数据目录>/plugins.json`） | 设置了 `OA_PLUGINS` 就用它，文件被忽略 |
| Cloudflare | Worker 变量或 secret `OA_PLUGINS` | 只有这一个 |

文件里的相对路径从文件所在目录算起；`OA_PLUGINS` 里的相对路径从站点启动时所在的目录算起。用完整路径就不用操心这些。
包名先在 `<数据目录>/plugins/node_modules` 里找（用 `npm install --prefix <数据目录>/plugins <包名>` 安装），再到站点
自己能找到包的地方找。

插件可以从任何目录导入 `@open-artifact/host-plugin`（辅助函数包；`header-auth.mjs`、`http-authz.mjs` 和
`company-jwt.mjs` 都导入了），不用安装：站点会把自己带的这个包交给每个插件（Node 上在加载插件时，Cloudflare 上在构建
Worker 时）。所以任何插件文件，包括这些例子，都可以复制到任何地方（包括数据目录），按那里的路径列出来。

### 设置和密钥

不要把密钥写进列表。任何设置都可以写成 `{"env": "NAME"}`，站点会从这个环境变量读取（在 Cloudflare 上：同名的 Worker
变量或 secret）。读到的文本按设置的类型解析：`map` 和 `json` 按 JSON 解析，`string[]` 按逗号分隔的列表或 JSON 数组解析。

站点启动时检查每一项设置。名字拼错会阻止启动，并提示你可能想写的是什么：

```
! Plugin "header-auth": unknown setting "emailHeadr". Did you mean "emailHeader"? Its settings are: emailHeader, nameHeader, groupsHeader, secretHeader, secret, jwtHeader, jwksUrl, issuer, audience.
```

密钥直接写进列表只是一条警告，站点仍会启动；但请把它移出去：

```
! Plugin "header-auth", setting "secret": the secret is written into the configuration; give it as {"env": "NAME"} to keep it out of the file.
```

密钥不会出现在 `plugin list`、管理 API 或日志里。

### Node 站点上的命令

在 Open Artifact 源码目录里运行，`OA_DATA_DIR` 要和站点用的一样。（提示信息里写的是 `open-artifact-host`；在源码目录里，
这个命令就是 `node packages/host/src/node/main.ts`。）

```
node packages/host/src/node/main.ts plugin list                 the plugins, their hooks and settings, and what is wrong
node packages/host/src/node/main.ts plugin check                the same; exits 1 when the site would not start
node packages/host/src/node/main.ts plugin role <artifact id> --as <email> [--json]   that person's role and what decided it
node packages/host/src/node/main.ts plugin add <path or package> [--config <json>] [--optional] [--disabled] [--timeout-ms <n>] [--cache-seconds <n>]
node packages/host/src/node/main.ts plugin remove|enable|disable <id or path>
node packages/host/src/node/main.ts plugin set <id or path> [<setting>=<value>…] [--secret <setting>=<ENV_NAME>…] [--timeout-ms <n>] [--cache-seconds <n>] [--optional | --required]
node packages/host/src/node/main.ts plugin unset <id or path> <setting>…
node packages/host/src/node/main.ts audit [--artifact <id>] [--actor <id>] [--action <prefix>] [--before <time>] [--limit <n>] [--json]
```

`add`、`remove`、`enable`、`disable`、`set` 和 `unset` 修改 `plugins.json`（写入时只有文件所有者可读），站点重启后生效。
设置了 `OA_PLUGINS` 时它们会拒绝执行：

```
open-artifact-host: OA_PLUGINS is set, and it wins over the plugin list file: change OA_PLUGINS instead (or unset it to use the file).
```

`plugin add ./my-plugin.mjs` 从你输入命令的目录算起，保存时会让它一直指向那里：在列表文件所在目录之下就存成相对那个
目录的路径，否则存成完整路径。命令会告诉你它存了什么。

`plugin set` 不用编辑文件就能改设置：`plugin set static-groups 'roles={"design":"editor"}'`（值按设置的类型解析，和从
环境变量读一样），`--secret key=CORP_JWT_KEY` 存成 `{"env":"CORP_JWT_KEY"}`（密钥本身不会写进文件），`--timeout-ms`、
`--cache-seconds`、`--optional` 或 `--required` 修改这一项。写入之前插件会先检查新设置；你的 shell 里没设置的环境变量会被
点名，要在站点运行的地方设置。`plugin unset <id> <设置名>` 删除设置。

`plugin role` 用这个 shell 里的设置，对一个人、一个作品先跑站点自己的规则，再依次问每个权限插件，告诉你最后是谁定的
（示例 2 里有用法）；站点管理员也可以用 `GET /api/open-artifact.admin.access?artifact=<id>&email=<地址>` 拿到同样的回答，
Node 和 Cloudflare 上都有。

`plugin check` 最后一行是 `All N plugin(s) that are on can run.`（退出码 0）或 `The host would not start: …`（退出码 1）。
`plugin list` 里 `on` 表示会运行，`off` 表示在列表里被停用，`failed` 表示没法运行；以 `!` 开头的行说明原因（文件找不到时，
会说找的是哪个文件）。

### 在 Cloudflare 上

Worker 运行时不能加载代码，所以插件要打包进去：

1. 在 `deploy/cloudflare/plugins.mjs` 里导入每个插件，并以一个名字导出：

   ```js
   import companyJwt from '../../examples/host-plugins/company-jwt.mjs';
   import staticGroups from '../../examples/host-plugins/static-groups.mjs';
   export default { 'company-jwt': companyJwt, 'static-groups': staticGroups };
   ```

2. 构建并部署（`npm run build`，然后 `wrangler deploy`，见 [Cloudflare 指南](hosting-cloudflare.zh-CN.md)）。
3. 用 `OA_PLUGINS` 按这些名字选择并配置插件：
   `[{"use":"company-jwt","config":{"key":{"env":"CORP_JWT_KEY"},"issuer":"https://login.corp.example","departments":{"design":"editor"}}}]`，
   其中 `CORP_JWT_KEY` 是一个 Worker secret（`wrangler secret put CORP_JWT_KEY`）。

| 你改的是 | 你需要 |
| --- | --- |
| 插件的设置，或运行哪些已打包的插件 | 只改 `OA_PLUGINS`，不用重新构建：写在 wrangler 配置里作为变量，然后 `wrangler deploy`；或者作为 secret，`wrangler secret put OA_PLUGINS`，它会自己部署一个新版本 |
| 新插件，或插件的新版本 | 改 `plugins.mjs`，`npm run build`，`wrangler deploy` |

`plugins.mjs`（或者你自己的文件，构建时用 `OA_PLUGINS_MODULE` 指定）可以从任何目录导入插件；导入了
`@open-artifact/host-plugin` 的插件用的是构建 Worker 时带的那一份。

`OA_PLUGINS` 里写了没打包进去的名字，每个请求都会得到（里面的文件名是构建时用的那个）：

```
Open Artifact is not configured: The plugin "header-auth" could not be loaded: it is not bundled into this Worker: add it to deploy/cloudflare/plugins.mjs as "header-auth" and build again (bundled: "company-jwt", "static-groups")
```

已实际运行：用 `OA_PLUGINS_MODULE=<文件> OA_BUILD_DIST=<目录> node build.mjs`（让构建使用你自己的文件和输出目录）把
`company-jwt` 和 `static-groups` 打包，在 `wrangler dev` 下运行：Cookie 登录、按部门给角色（编辑者、查看者）、守卫的拒绝
和管理 API 都和 Node 上一样；换一份 `OA_PLUGINS`（销售部从查看者改为评论者）重启后就生效，不用重新构建；没打包的名字
得到上面那条信息。未运行：`wrangler deploy` 和 `wrangler secret put`（没有碰任何已部署的站点）。

Cloudflare 上没有 `plugin` 命令。Worker 的每个部分（站点本身，以及每个作品的房间）各自运行一份插件，见[限制](#限制)。

### 插件出错时

插件抛出异常、超时，或答复了站点没法用的东西，就算出错。接下来怎么办取决于问的是什么：

| 问的是 | 出错时 | 为什么 |
| --- | --- | --- |
| 登录（`auth.*`） | 不会由它登录任何人；在 `auth.identity` 出错时，登录被拒绝，提示 “This sign-in could not be checked just now. Try again in a moment.” | 检查失败不能放任何人进来。 |
| 权限（`authz.role`） | 这个人对这个作品**没有访问权限**，这个结果不缓存。包括作品的所有者和被分享的人：插件出错，站点一律当作“不行”。已登录的人看到的是“权限检查暂时没能完成。请稍后再试；如果一直这样，站点的管理员可以在审计日志里看到原因。”（API 返回 403 `not_granted`，英文是 “A permission check could not be completed just now. Try again in a moment; if it persists, the site's operator can see why in the audit log.”），而不是“没有分享给你”。 | 权限检查失败不能打开任何东西。 |
| 受守卫的操作（`guard`） | 拒绝：“This could not be checked just now (<插件名>). Try again in a moment.” | 同上。 |
| 事件（`on.*`）、`wake.deliver` | 记日志后忽略；操作已经完成。发给 Agent 的请求照常进入所有者的发件箱。 | 通知 Slack 失败不能耽误正事。 |
| 插件自己的网址（`routes`） | 只有这个请求得到一个错误答复。 | |

所以，权限服务挂了，权限插件会把大家挡在外面，直到服务恢复。让这个服务和站点一样可靠，给插件设一个能覆盖短暂中断的
`cacheSeconds`；只有在你能接受“站点不带它也会启动”时才把它设为 `optional`。每次出错都会作为 `plugin.failed` 记进审计
日志，带插件、钩子和错误（见下文）。

服务一时恢复不了，又要让大家先进来，就把插件撤掉，权限重新由站点自己的分享决定：

- **Node**：`plugin disable <id>`，然后重启站点（设置了 `OA_PLUGINS` 时，在那里删掉这一项再重启）。
- **Cloudflare**：从 `OA_PLUGINS` 里删掉这一项（`wrangler secret put OA_PLUGINS`，或者改变量后 `wrangler deploy`），
  不用重新构建。

服务恢复后用同样的方法加回来。

### 查看正在运行什么

- **启动时**，Node 站点日志里有一行 `  plugins: header-auth, static-groups (from /srv/oa/plugins.json)`。
- **站点管理员**登录后可以在 `GET /api/open-artifact.admin.plugins` 看到列表（id、名称、版本、钩子、设置名、问题；
  不含设置的值）。其他人得到 403 `Only a site admin sees the plugin list.`
- **日志**里每次出错一行：`plugin http-authz: authz.role failed (refused): threw: fetch failed`。插件自己写的日志行以
  `plugin <id>: ` 开头。
- **审计日志**里：登录、权限或守卫出错时记 `plugin.failed`（`{"plugin","hook","reason","error"}`，错误里插件的密钥
  已去掉），守卫拒绝时记 `plugin.denied`（`{"action","artifact"}`），登录被拒绝时记 `auth.sign_in_refused`，还有插件
  自己写的条目（如 `invite.sent`）。在 Node 上用 `audit` 命令读：

  ```bash
  node packages/host/src/node/main.ts audit --action plugin.
  ```

  ```
  2026-11-22T12:05:06.533Z  plugin.failed  system:plugin:http-authz  {"plugin":"http-authz","hook":"authz.role","reason":"threw","error":"threw: fetch failed"}
  ```

  `--artifact <id>`、`--actor <id>`、`--action <前缀>`（`auth.` 是所有登录相关的条目）和 `--before <时间>` 用来筛选；
  最新的在前，每次 100 条（`--limit`，最多 500），最后一行 `More: … audit --before '…'` 给出下一页的命令。`--json` 按
  API 的格式输出这一页。

  站点管理员登录后，在两种站点上都可以用 `GET /api/open-artifact.admin.audit?action=plugin.&limit=50` 读同样的内容：
  `{"entries":[…],"next":"…"}`，最新的在前；把 `next` 作为 `before` 传入就是下一页（最后一页的 `next` 是 null）。筛选
  参数是 `artifact`、`actor`、`action`、`before` 和 `limit`，其他名字返回 400。其他人得到 403
  `Only a site admin reads the audit log.`；Agent 令牌会被拒绝。

### 升级：哪些保持稳定

插件声明它是为哪个版本的插件 API 写的（`apiVersion: 1`）。同一个版本内，站点只会**增加**：新钩子、新事件、新的受守卫操作、
钩子输入里的新字段、`ctx` 的新成员。为版本 1 写的插件，在之后所有支持版本 1 的发布里都能继续工作，所以升级站点时不用动
你的插件。

**破坏性**变更指会让一个原本正常的插件出错的变更：删除或改名某个钩子、事件、设置类型或 `ctx` 成员，改变某个答复的含义
（比如 `authz.role` 返回 `null` 的意思），或者把出错策略放宽。这样的变更会提升 API 版本号。届时站点会拒绝为更新版本写的
插件，并提示需要哪个发布；上一个版本的插件至少再支持一个大版本。发布说明（CHANGELOG.md）会写明。

升级后、重启前先运行 `plugin check`：它会用新发布加载每个插件并检查设置。

### Docker

Docker 镜像跑的是同一个 Node 站点，但只包含站点需要的文件，不含例子。把插件放进数据卷（`/data`，比如
`/data/plugins/header-auth.mjs`），在 `/data/plugins.json` 或 `OA_PLUGINS` 里用它在那里的路径
（`deploy/docker/compose.yaml` 会把 `OA_PLUGINS` 和 `OA_PLUGINS_FILE` 传进容器；插件用到的密钥加进容器的环境变量）。
每个例子都能从那里加载，导入了 `@open-artifact/host-plugin` 的也一样：镜像里带着这个包。

已实际运行：把 Dockerfile 复制的那些文件手工放进一个目录，设成只读，`/data` 放在别处，从这个目录运行站点；从数据目录
`plugin add` `header-auth.mjs` 和一个什么都不导入的插件、启动、通过请求头登录、导入作品都正常。未运行：没有构建镜像本身。

## 在你电脑上的示例

五个例子，每个都跑在你电脑上的 Node 站点里，用单独的目录和不会和已有站点冲突的端口（站点 4911，站点前面的登录代理 4912）。
这里的命令写本页时都实际运行过；你那边的 id、时间和密钥会不一样。路径简写为 `~/oa-plugins-demo`。

你需要：已经 `npm install` 过的 Open Artifact 源码目录、Node 22 或更新版本、`curl` 和 `openssl`。

### 0. 准备一个试插件的站点

1. 在 Open Artifact 源码目录里，创建演示目录和它的设置：

   ```bash
   mkdir -p ~/oa-plugins-demo
   cat > ~/oa-plugins-demo/env.sh <<'EOF'
   export WORK=~/oa-plugins-demo
   export OA_DATA_DIR=$WORK/site OA_PORT=4911
   export OA_APP_ORIGIN=http://localhost:4912 OA_CONTENT_ORIGIN='http://{id}.content.localhost:4912'
   export OA_OWNERS=ann@example.com OA_SIGNUP=domain:example.com
   unset OA_PLUGINS OA_PLUGINS_FILE
   oah() { node packages/host/src/node/main.ts "$@"; }
   EOF
   source ~/oa-plugins-demo/env.sh
   oah plugin list
   ```

   站点的地址是代理的地址（4912）：大家只能经过代理访问站点。`OA_SIGNUP=domain:example.com` 让所有 `@example.com`
   地址都能进来；Ann 是站点管理员。

   **预期：**

   ```
   No plugins (no OA_PLUGINS and no /Users/you/oa-plugins-demo/site/plugins.json).
   ```

   **出错时：** `Cannot find module` 说明你不在 Open Artifact 源码目录里，或者没运行过 `npm install`。

2. 生成一个稍后上传用的示例作品：

   ```bash
   node -e "import('./packages/type-server/src/archive.ts').then(a => a.writeArchive('test-artifacts/whiteboard/elements', process.argv[1])).then(console.log)" "$WORK/sample.zip"
   ```

   **预期：** `{ file: '/Users/you/oa-plugins-demo/sample.zip', bytes: 253451, files: 199 }`

每开一个新终端，先 `cd` 到 Open Artifact 源码目录，再 `source ~/oa-plugins-demo/env.sh`。

### 1. 通过公司的登录代理登录（`header-auth`）

很多公司在内部站点前面放一个登录代理（oauth2-proxy、SSO 网关、Ingress）。代理负责让人登录，再通过请求头把这个人的地址
传给站点。`header-auth` 只在请求头同时带着一个只有代理知道的共享密钥时才相信它。

1. 生成密钥，添加插件：

   ```bash
   openssl rand -hex 24 > "$WORK/proxy-secret" && chmod 600 "$WORK/proxy-secret"
   oah plugin add "$PWD/examples/host-plugins/header-auth.mjs" --config '{"secret":{"env":"PROXY_SECRET"}}'
   oah plugin check
   ```

   **预期：** `Added …/header-auth.mjs to …/site/plugins.json.`，然后因为这个终端里还没设置 `PROXY_SECRET`：

   ```
   ! Plugin "header-auth", setting "secret": the environment variable PROXY_SECRET is not set.
   ```

   退出码 1。如果设置里根本没有密钥，插件自己会拒绝运行：
   `! Plugin "header-auth": set "secret" (with "secretHeader") or "jwtHeader" and "jwksUrl": without one, anyone could send the header.`

2. 在环境里设好密钥，再检查一次：

   ```bash
   export PROXY_SECRET=$(cat "$WORK/proxy-secret")
   oah plugin check
   ```

   **预期：**

   ```
   Plugins from /Users/you/oa-plugins-demo/site/plugins.json:
     on   header-auth 1.0.0  (/Users/you/open-artifact/examples/host-plugins/header-auth.mjs)
            Header sign-in
            hooks: auth.authenticate
            settings: emailHeader, nameHeader, groupsHeader, secretHeader, secret, jwtHeader, jwksUrl, issuer, audience
   All 1 plugin(s) that are on can run.
   ```

3. 一个代替代理的小程序。真正的代理会检查密码或走你们的 SSO；这个只相信 `/login?as=<email>`，足够看清站点会怎么做。
   保存为 `~/oa-plugins-demo/proxy.mjs`：

   ```js
   // A stand-in sign-in proxy: listens on 4912, forwards to the site on 4911, and says who is asking.
   import http from 'node:http';
   import net from 'node:net';

   const who = (req) => /(?:^|;\s*)demo_user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
   const headers = (req) => {
     const h = { ...req.headers };
     delete h['x-forwarded-email']; delete h['x-forwarded-user']; delete h['x-proxy-secret']; // never pass on the client's own
     const email = who(req) && decodeURIComponent(who(req));
     if (email) Object.assign(h, { 'x-forwarded-email': email, 'x-forwarded-user': email.split('@')[0], 'x-proxy-secret': process.env.PROXY_SECRET });
     return h;
   };
   http.createServer((req, res) => {
     const as = new URL(req.url, 'http://x').searchParams.get('as');
     if (req.url.startsWith('/login') && as) {
       // Someone else now: the site sees the new header on the next request and changes its session to them.
       res.writeHead(302, { location: '/', 'set-cookie': `demo_user=${encodeURIComponent(as)}; Path=/; HttpOnly` });
       return res.end();
     }
     const up = http.request({ host: '127.0.0.1', port: 4911, method: req.method, path: req.url, headers: headers(req) }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
     up.on('error', () => res.destroy());
     req.pipe(up);
   }).on('upgrade', (req, socket, head) => {
     const up = net.connect(4911, '127.0.0.1', () => {
       up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers(req)).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
       up.write(head); up.pipe(socket); socket.pipe(up);
     });
     up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy());
   }).listen(4912, '127.0.0.1', () => console.log('proxy on http://localhost:4912 -> site on 127.0.0.1:4911'));
   ```

4. 在一个终端启动站点，另一个终端启动代理（两个终端都要 export `PROXY_SECRET`）：

   ```bash
   oah serve
   ```

   ```bash
   node ~/oa-plugins-demo/proxy.mjs
   ```

   站点**预期**输出：

   ```
   Open Artifact host 0.14.6 listening on http://127.0.0.1:4911
     app:     http://localhost:4912
     content: http://{id}.content.localhost:4912
     data:    /Users/you/oa-plugins-demo/site
     plugins: header-auth (from /Users/you/oa-plugins-demo/site/plugins.json)
   ```

   后面跟着所有者的登录地址（这是密钥，这里用不到）。代理输出：`proxy on http://localhost:4912 -> site on 127.0.0.1:4911`。

5. 经过代理以 Ann 的身份登录，再问站点她是谁：

   ```bash
   curl -s -c "$WORK/ann.jar" 'http://localhost:4912/login?as=ann@example.com' -o /dev/null
   curl -s -b "$WORK/ann.jar" -c "$WORK/ann.jar" http://localhost:4912/api/open-artifact.auth.me | head -c 130; echo
   ```

   **预期：**
   `{"principal":{"kind":"user","id":"usr_…","name":"ann","email":"ann@example.com","siteRole":"admin"},…`，Cookie 文件里
   多了一个 `oa_session`。在浏览器里打开 `http://localhost:4912/login?as=ann@example.com`，会以 Ann 的身份进入站点首页。

6. **检查**别人发不了这个请求头：

   ```bash
   # 直接访问站点，带一个猜的密钥
   curl -s -H 'x-forwarded-email: ceo@example.com' -H 'x-proxy-secret: guess' http://127.0.0.1:4911/api/open-artifact.auth.me | head -c 40; echo
   # 经过代理，但没在代理那里登录
   curl -s -H 'x-forwarded-email: ceo@example.com' http://localhost:4912/api/open-artifact.auth.me | head -c 40; echo
   ```

   两次都**预期**：`{"principal":{"kind":"anonymous"},"provi`。

   代理认识、但站点的注册规则不允许的人（`eve@other.org`）不会登录：打开页面看到的是说明原因的登录页（“This site only
   lets invited people in, …”），API 请求得到 401 `{"code":"sign_in_refused","reason":"not_invited",…}`。站点日志记
   `sign-in refused (plugin:header-auth): not_invited: plugin:header-auth eve@other.org`，审计日志记一条
   `auth.sign_in_refused`，内容 `{"provider":"plugin:header-auth","subject":"eve@other.org","reason":"not_invited"}`
   （是插件的 `auth.identity` 拒绝的，还会带 `plugin`）；同一个人、同一个原因，一小时最多记一次。

**出错时：** Ann 是匿名，说明站点和代理的 `PROXY_SECRET` 不一样（每个终端都要 export），或者没经过代理（你用了 4911 端口）。
`Address already in use`：4911 或 4912 已经被占用；停掉占用的程序，或者两个端口都换掉。

**在生产环境：** 代理换成你们真正的代理，配置它设置 `X-Forwarded-Email` 和密钥请求头；站点只能让代理访问到
（`OA_BIND=127.0.0.1`、内网、防火墙），因为任何能直接访问站点又知道密钥的人，说自己是谁就是谁。站点会保留一个会话
（`oa_session` Cookie），但每个请求都会拿请求头核对：还是同一个人就继续，换了人就换成新的人的会话，没有请求头（退出了
公司账号）就结束会话。代理不用清任何东西。如果你们的代理会签发 JWT（Cloudflare Access、Pomerium），用 `jwtHeader`、
`jwksUrl`、`issuer` 和 `audience`，不用共享密钥。

### 2. 按一张表给角色（`static-groups`）

`static-groups` 在设置里给一些人分组，再给每个组在所有作品（或某个人的作品）上一个角色。它从不降低站点已经给出的角色。这个示例只需要第 0 步：不用代理，也不用站点在运行，因为 `oah plugin role` 会直接问插件某人能得到什么。
（如果你做过示例 1，列表里还留着它的 `header-auth`；这里不受影响。）

1. 先故意写一份错的设置，看看检查怎么说：

   ```bash
   oah plugin add "$PWD/examples/host-plugins/static-groups.mjs" --config '{"groups":{"design":"bob@example.com"},"roles":{"desing":"editor","design":"admin"}}'
   oah plugin check
   ```

   **预期**（退出码 1）：

   ```
   ! Plugin "static-groups": roles.desing: there is no group "desing" in groups.
   ! Plugin "static-groups": roles.design is "admin": the role is viewer, commenter or editor.
   The host would not start: The plugin configuration has 2 problems:
   - Plugin "static-groups": roles.desing: there is no group "desing" in groups.
   - Plugin "static-groups": roles.design is "admin": the role is viewer, commenter or editor.
   ```

2. 换成能用的设置。Bob 在 `design` 组；所有 example.com 的人都在 `staff` 组。staff 能查看所有作品，design 能编辑 Ann 的作品：

   ```bash
   oah plugin remove static-groups
   oah plugin add "$PWD/examples/host-plugins/static-groups.mjs" --config '{"groups":{"design":"bob@example.com","staff":"@example.com"},"roles":{"staff":"viewer","design":"editor:ann@example.com"}}'
   oah plugin check
   ```

   **预期：** `Removed …static-groups.mjs from …/plugins.json. Its stored data (ctx.kv) is kept.`，然后列表里有
   `on   static-groups 1.2.0`、`hooks: authz.role, authz.artifacts`、`settings: groups, roles`，最后是
   `All 1 plugin(s) that are on can run.`（示例 1 的 `header-auth` 还开着的话是 `All 2 …`。）

3. 把示例作品作为 Ann 的作品放到站点上（站点停着或运行着都可以）：

   ```bash
   oah import "$WORK/sample.zip" --owner ann@example.com
   ```

   **预期：**

   ```
   Imported "Whiteboard element test" (whiteboard) as art_0mwrx200v024c5bf72ea3ec78
     http://localhost:4912/a/art_0mwrx200v024c5bf72ea3ec78
   ```

   记下 id：`ID=art_…`（你的会不一样）。

4. 问问 Bob、Carol 和一个公司外的人各能得到什么：

   ```bash
   for who in bob@example.com carol@example.com eve@other.org; do oah plugin role $ID --as $who; done
   ```

   **预期：**

   ```
   bob@example.com (never signed in: what they would get once they do, with a verified address) on "Whiteboard element test" (art_0mwrx200v024c5bf72ea3ec78, owned by ann@example.com, general access restricted):
     host: no access: no share, link or public access gives a role
     plugin static-groups: answered editor; role no access -> editor
   Role: editor (decided by plugin:static-groups).
   carol@example.com (never signed in: …) on "Whiteboard element test" (…):
     host: no access: no share, link or public access gives a role
     plugin static-groups: answered viewer; role no access -> viewer
   Role: viewer (decided by plugin:static-groups).
   eve@other.org (never signed in: …) on "Whiteboard element test" (…):
     host: no access: no share, link or public access gives a role
     plugin static-groups: no opinion; role stays no access
   Role: no access (decided by the host).
   ```

   这个命令先跑站点自己的规则（所有者、站点管理员、分享、链接、公开访问），再用这个 shell 里的设置依次问每个插件的
   `authz.role`，和站点处理请求时完全一样，最后告诉你是谁定的。谁都不用登录：没登录过的人按一个用这个地址、已验证的新账号
   来算；登录过的人按他现在的样子算（站点角色、登录时带来的组、打开过的分享链接、账号是否被停用）。`--json` 输出同样内容的
   JSON。它不检查这个地址能不能登录：这里 `eve@other.org` 本来也会被 `OA_SIGNUP=domain:example.com` 挡在外面。

**检查：** `oah plugin role $ID --as ann@example.com` 答复 `host: owner: the artifact's owner` 和
`Role: owner (decided by the host).`：插件从不降低角色。

**在运行中的站点上，** 站点管理员可以带着自己的会话（浏览器里，或示例 1 的 cookie 文件）通过 HTTP 问同样的问题：
`GET /api/open-artifact.admin.access?artifact=<id>&email=<地址>`。

```bash
curl -s -b "$WORK/ann.jar" "http://localhost:4912/api/open-artifact.admin.access?artifact=$ID&email=bob@example.com"
```

**预期：** `{"artifact":{"id":"art_…",…},"person":{"email":"bob@example.com","userId":null,…},"host":{"role":null,"reason":"no share, link or public access gives a role"},"plugins":[{"plugin":"static-groups","before":null,"answer":"editor","after":"editor"}],"role":"editor","decidedBy":"plugin:static-groups"}`。
不是站点管理员的人得到 403，没登录得到 401，agent 的令牌得到 401。Cloudflare 站点上（那里没有命令行）也有同一个接口。

**用所有者密钥登录的账号没有邮箱地址**，除非 `OA_OWNERS` 写了一个：只用所有者密钥登录过的所有者，没法写进 `--as` 或
`email=`，任何按地址分的组也不会包含他。不过他是站点管理员，本来就是每个作品的所有者。

**出错时：** 你以为在某个组里的人得到 `Role: no access`，说明 `groups` 里的地址不是他登录用的地址（不区分大小写；
`@domain` 匹配整个域名），或者 `oah plugin list` 里这个插件是 `off`。在站点上还要确认启动日志里列出了 `static-groups`：
列表在启动时读取，改了要重启。

**值得知道：** 某个组有角色的作品，也会列在组员的首页上（`authz.artifacts` 钩子，用 `ctx.host.artifacts.list` 列出
作品）。插件把每份列表保留 300 秒，最多取 1000 个作品，所以新作品可能要过五分钟才出现在首页上（链接马上就能用）；这适合
小站点，大站点请直接分享给这个组。角色答复会复用 300 秒（插件的 `cacheSeconds`）；改设置本来就要重启，所以重启后立刻生效。
`plugin role` 从不使用、也不填充这份缓存。

### 3. 权限来自你自己的服务（`http-authz`）

`http-authz` 对每个人和每个作品去问你的服务：他是什么角色。问题用共享密钥签名；答复是 `{"role":"editor"}`、
`{"role":null}`（无权访问）或 `{}`（没有意见：沿用站点的判断）。你的服务可以调用 `/plugins/http-authz/invalidate`
让站点忘掉缓存的答复。

1. 停用 `static-groups`（只看这个插件），添加 `http-authz`，检查：

   ```bash
   oah plugin disable static-groups
   openssl rand -hex 24 > "$WORK/perms-secret" && chmod 600 "$WORK/perms-secret"
   export PERMS_SECRET=$(cat "$WORK/perms-secret")
   oah plugin add "$PWD/examples/host-plugins/http-authz.mjs" --config '{"url":"http://127.0.0.1:4913/","secret":{"env":"PERMS_SECRET"}}'
   oah plugin list
   ```

   **预期：** `Disabled …static-groups.mjs in …/plugins.json.`；列表里 `off  static-groups 1.2.0 …` 带
   `! disabled in the plugin list`，以及 `on   http-authz 1.0.0`、`Permission service`、
   `hooks: authz.role, routes`、`settings: url, secret`。

2. 一个代替你们服务的小程序，`~/oa-plugins-demo/perms-service.mjs`。它按一张表答复，表变了就通知站点：

   ```js
   // A stand-in permission service: answers the site's signed questions from a table (e-mail -> role).
   //   curl 'http://127.0.0.1:4913/set?email=bob@example.com&role=viewer'   (role=none: no access)
   import http from 'node:http';
   import { createHmac, timingSafeEqual } from 'node:crypto';

   const SECRET = process.env.PERMS_SECRET;
   const SITE = 'http://localhost:4912';
   const table = { 'bob@example.com': 'editor' };
   const sign = (body) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
   const signedBy = (body, given = '') => given.length === sign(body).length && timingSafeEqual(Buffer.from(given), Buffer.from(sign(body)));

   http.createServer(async (req, res) => {
     const url = new URL(req.url, 'http://x');
     if (url.pathname === '/set') {
       const email = url.searchParams.get('email');
       table[email] = url.searchParams.get('role');
       const body = JSON.stringify({}); // {} forgets every cached answer; {"artifactId": "art_…"} one artifact's
       const told = await fetch(`${SITE}/plugins/http-authz/invalidate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-oa-signature': sign(body) }, body });
       console.log(`set ${email} -> ${table[email]}; the site answered ${told.status} ${await told.text()}`);
       return res.end('ok\n');
     }
     let body = '';
     for await (const chunk of req) body += chunk;
     if (!signedBy(body, req.headers['x-oa-signature'])) return res.writeHead(401).end();
     const asked = JSON.parse(body); // {user: {id, email, groups}, artifact: {id, type, title, owner}, role}
     const role = table[asked.user.email];
     const answer = role === undefined ? {} : { role: role === 'none' ? null : role };
     console.log(`${asked.user.email} on "${asked.artifact.title}" (site says ${asked.role}) -> ${JSON.stringify(answer)}`);
     res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
   }).listen(4913, '127.0.0.1', () => console.log('permission service on http://127.0.0.1:4913'));
   ```

3. 在第三个终端启动它（`node ~/oa-plugins-demo/perms-service.mjs`，要 export `PERMS_SECRET`），再在站点的终端里重启
   站点（同样要 export `PERMS_SECRET`）。

4. 通过示例 1 的代理分别以 Bob、Carol 和 Ann 的身份登录，打开示例 2 的作品（`$ID`）：

   ```bash
   for who in bob carol ann; do
     curl -s -c "$WORK/$who.jar" "http://localhost:4912/login?as=$who@example.com" -o /dev/null
     printf '%s: ' $who; curl -s -b "$WORK/$who.jar" -c "$WORK/$who.jar" "http://localhost:4912/api/open-artifact.artifact?id=$ID" | node -p "const j = JSON.parse(require('fs').readFileSync(0)); j.role ?? j.message"
   done
   ```

   **预期：** `bob: editor`、`carol: No such artifact, or it is not shared with you.`（服务对 Carol 没有意见，站点也没给她
   权限）、`ann: owner`。服务每收到一个问题打印一行：

   ```
   bob@example.com on "Whiteboard element test" (site says null) -> {"role":"editor"}
   ann@example.com on "Whiteboard element test" (site says owner) -> {}
   ```

   快速连问三次：服务只收到一次。答复会复用 60 秒。

5. 在服务里改 Bob 的角色：

   ```bash
   curl -s 'http://127.0.0.1:4913/set?email=bob@example.com&role=viewer'
   ```

   服务里**预期**：`set bob@example.com -> viewer; the site answered 200 {"ok":true}`，Bob 的下一个请求立刻答复 `viewer`
   （不用等 60 秒）。用 `role=none`，Bob 得到 `not_found`。

6. **检查**只有你的服务能清缓存：签名不对的调用会被拒绝：

   ```bash
   curl -s -X POST -H 'x-oa-signature: sha256=00' -d '{}' http://localhost:4912/plugins/http-authz/invalidate; echo
   ```

   **预期：** `{"code":"plugin_error","message":"Bad signature."}`（状态码 401）。

7. 看看服务挂了会怎样：停掉服务（Ctrl-C），用正确签名清一次缓存，再问：

   ```bash
   SIG=$(printf '%s' '{}' | openssl dgst -sha256 -hmac "$PERMS_SECRET" | sed 's/^.* //')
   curl -s -X POST -H "x-oa-signature: sha256=$SIG" -d '{}' http://localhost:4912/plugins/http-authz/invalidate; echo
   ```

   **预期：** `{"ok":true}`。之后 Bob **和所有者 Ann** 都被拒绝：API 返回 403 `not_granted`，内容是 “A permission
   check could not be completed just now. Try again in a moment; if it persists, the site's operator can see why in
   the audit log.”，作品页面上也是这句话。站点日志记 `plugin http-authz: authz.role failed (refused): threw: fetch failed`，
   审计日志记 `plugin.failed`，内容 `{"plugin":"http-authz","hook":"authz.role","reason":"threw","error":"threw: fetch failed"}`。重新启动服务，下一个请求就恢复访问。清缓存之前，服务挂掉前给出的答复仍会被使用。

**出错时：** 每个请求都是 `not_found`，服务里出现 `401`：两边的 `PERMS_SECRET` 不一样。服务的终端里什么都没有：`url`
指向了别处，或者站点没重启。

**在生产环境：** 你的服务必须在时间上限内答复（默认 5 秒，除非 `timeoutMs` 另有设置），并且和站点一样可靠：它挂着的时候，
插件被问到的作品谁都打不开（所有者也不行）。它会看到每个人的邮箱、所在组和作品标题。`url` 请用 `https:`。

### 4. 把发生的事告诉别的系统（`webhook-events`）

`webhook-events` 把选定的事件 POST 到一个地址：JSON 格式（可以签名），或者 Slack 消息（`"format": "slack"`，配 Slack 的
Incoming Webhook 地址）。

1. 一个代替接收方的小程序，把收到的内容打印出来，`~/oa-plugins-demo/receiver.mjs`（例子 5 也会用）：

   ```js
   // Prints every request it gets. PORT=4914 node receiver.mjs
   import http from 'node:http';

   const PORT = Number(process.env.PORT ?? 4914);
   http.createServer(async (req, res) => {
     let body = '';
     for await (const chunk of req) body += chunk;
     const shown = ['content-type', 'authorization', 'x-oa-signature'].filter((h) => req.headers[h]).map((h) => `${h}: ${h === 'authorization' ? req.headers[h].replace(/ .*/, ' …') : req.headers[h]}`);
     console.log(`${req.method} ${req.url}\n  ${shown.join('\n  ')}\n  ${body}\n`);
     res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
   }).listen(PORT, '127.0.0.1', () => console.log(`listening on http://127.0.0.1:${PORT}`));
   ```

   启动它：`PORT=4914 node ~/oa-plugins-demo/receiver.mjs`。

2. 移除 `http-authz`（让大家恢复正常的访问权限），添加插件，地址和签名密钥都从环境变量读取：

   ```bash
   oah plugin remove http-authz
   oah plugin add "$PWD/examples/host-plugins/webhook-events.mjs" --config '{"url":{"env":"EVENTS_URL"},"events":["artifact.created","share.changed","share.invited"],"signingSecret":{"env":"EVENTS_SECRET"}}'
   openssl rand -hex 24 > "$WORK/events-secret" && chmod 600 "$WORK/events-secret"
   export EVENTS_URL=http://127.0.0.1:4914/events EVENTS_SECRET=$(cat "$WORK/events-secret")
   oah plugin check
   ```

   **预期：** `on   webhook-events 1.0.0`、`Webhook events`、它的钩子 `on.user.created, on.user.signed_in, …`、
   `settings: url, events, format, signingSecret`，最后是 `All N plugin(s) that are on can run.`

3. 重启站点（export 好 `EVENTS_URL` 和 `EVENTS_SECRET`）。Ann 再上传一次示例作品，并分享给从没登录过的 Dave：

   ```bash
   curl -s -b "$WORK/ann.jar" -H 'origin: http://localhost:4912' -H 'content-type: application/zip' \
     --data-binary @"$WORK/sample.zip" http://localhost:4912/api/open-artifact.artifacts.import > "$WORK/art2.json"
   ID=$(node -p "require(process.argv[1]).id" "$WORK/art2.json")
   curl -s -b "$WORK/ann.jar" -H 'origin: http://localhost:4912' -H 'content-type: application/json' \
     -d "{\"id\":\"$ID\",\"members\":{\"email:dave@example.com\":\"commenter\"}}" http://localhost:4912/api/open-artifact.artifact.share -o /dev/null -w '%{http_code}\n'
   ```

   **预期：** `200`，接收方收到三次 POST（有删节）：

   ```
   POST /events
     content-type: application/json
     x-oa-signature: sha256=b2c73431f8d154d2a1880e8fe3df1644a878d3f14b7a8b29d13385c053ad3bdb
     {"artifact":{"id":"art_0mwrsl0nl1e93b6314acbdfc5","type":"whiteboard","title":"Whiteboard element test","owner":"usr_MHNWuy2i52-pw931ZINjiQ"},"by":{"kind":"user","id":"usr_MHNWuy2i52-pw931ZINjiQ","name":"ann"},"via":"import","event":"artifact.created","at":"2026-11-22T12:07:21.529Z"}

   POST /events
     …
     {…,"changes":{"grants":[{"subjectKind":"email","subject":"dave@example.com","role":"commenter"}]},"event":"share.changed",…}

   POST /events
     …
     {…,"invitee":{"email":"dave@example.com"},"role":"commenter","url":"http://localhost:4912/a/art_0mwrsl0nl1e93b6314acbdfc5","event":"share.invited",…}
   ```

4. 像接收方那样**检查**签名：用签名密钥对原样的请求体做 HMAC-SHA256，十六进制。把第一个请求体存为 `body.json`：

   ```bash
   printf '%s' "$(cat body.json)" | openssl dgst -sha256 -hmac "$EVENTS_SECRET"
   ```

   **预期**得到和 `x-oa-signature` 里 `sha256=` 后面相同的十六进制串。

5. 接收方挂了，操作照样完成：停掉接收方，再上传一次。**预期**上传返回 `201`，日志里有
   `plugin webhook-events: on.artifact.created failed (ignored): threw: fetch failed`。插件把这条 POST 存在自己的存储里，
   下一个事件之前先补发，一天内最多试 5 次：启动接收方，再分享一次，接收方先收到漏掉的 `artifact.created`，然后是
   `share.changed`。

**出错时：** 什么都没收到：确认站点运行的终端里 export 了 `EVENTS_URL`，并且站点重启过。只收到一部分事件：`events` 决定
发哪些；`share.invited` 只在有人按地址或名字新获得角色时才发，改角色不发。

**在生产环境：** 用 Slack 时设 `"format": "slack"`，把 Incoming Webhook 地址作为密钥给出（`{"env":"SLACK_WEBHOOK_URL"}`）；
Slack 的这个地址本身就是密码。你自己的接收方应该校验签名，并且尽快答复。

### 5. 邀请邮件（`invite-email`）

站点自己不发邮件。有人按地址获得角色时，`invite-email` 通过你们邮件服务的 HTTP API 发邀请（一次 JSON `POST`，含 `from`、
`to`、`subject`、`text`）。这里用例子 4 的接收方代替邮件服务。

1. 在 4915 端口再启动一个接收方：`PORT=4915 node ~/oa-plugins-demo/receiver.mjs`。
2. 添加插件，API key 从环境变量读取：

   ```bash
   openssl rand -hex 16 > "$WORK/mail-key" && chmod 600 "$WORK/mail-key"
   export MAIL_KEY=$(cat "$WORK/mail-key")
   oah plugin add "$PWD/examples/host-plugins/invite-email.mjs" --config '{"apiUrl":"http://127.0.0.1:4915/send","apiKey":{"env":"MAIL_KEY"},"from":"Artifacts <artifacts@example.com>"}'
   oah plugin check
   ```

   **预期：** `on   invite-email 1.0.0`、`Invitation e-mail`、`hooks: on.share.invited`、
   `settings: apiUrl, apiKey, authHeader, authScheme, from, subject, text`，最后是
   `All 3 plugin(s) that are on can run.`

3. 重启站点（export 好 `MAIL_KEY`），按例子 4 第 3 步把作品分享给 Dave。

   4915 的接收方**预期**收到：

   ```
   POST /send
     content-type: application/json
     authorization: Bearer …
     {"from":"Artifacts <artifacts@example.com>","to":"dave@example.com","subject":"ann shared \"Whiteboard element test\" with you","text":"Hello dave@example.com,\n\nann gave you commenter access to \"Whiteboard element test\".\n\nOpen it: http://localhost:4912/a/art_0mwrsl0nl1e93b6314acbdfc5\n"}
   ```

4. **检查**审计日志：

   ```bash
   oah audit --action invite.sent
   ```

   **预期：** `2026-11-22T12:07:21.617Z  invite.sent  system:plugin:invite-email  {"artifact":"art_0mwrsl0nl1e93b6314acbdfc5","role":"commenter"}`

**出错时：** 4915 什么都没收到：分享给的人原本就有角色（这时不发邀请），或者 `apiUrl` 写错了。站点日志会写出插件名和错误。

**在生产环境：** 把 `apiUrl` 指向你们邮件服务的发送接口。插件 POST 的是 JSON `{from, to, subject, text}`；Resend 正好收这个，
其他服务的字段名不同，需要一个小的中转，或者改一份你自己的插件。`authHeader` 和 `authScheme` 决定 key 怎么发送（默认
`Authorization: Bearer <key>`）。用 `subject` 和 `text` 改邮件内容（`{title}`、`{role}`、`{url}`、`{inviter}`、`{name}`）。
未运行：真实的邮件服务。

### 收尾

停掉站点、代理、服务和接收方（每个终端里 Ctrl-C），然后 `rm -rf ~/oa-plugins-demo`。

## 完整例子：用公司的 JWT Cookie 登录，按部门给角色

场景：公司的登录系统已经在 `.corp.example` 上设置了一个 Cookie `corp_token`，里面是一个 JWT，带着这个人的 id、邮箱、
名字和 `department`。站点会放在 `artifacts.corp.example`，所以浏览器会把这个 Cookie 带给站点。你想要：

- 用这个 Cookie 让人登录，其他人都不能靠它登录；
- 不在名单上的部门拒绝登录；
- 设计部能编辑、销售部能查看所有作品；
- 不许公开链接；
- 账户菜单里有一项“My department”。

插件是 `examples/host-plugins/company-jwt.mjs`（76 行），测试 `company-jwt.test.mjs` 在它旁边。

```js
import { verifyJwt } from '@open-artifact/host-plugin';

const RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const departmentOf = (principal) => {
  const person = principal.kind === 'agent' ? principal.user : principal; // an agent acts with its person's role
  const group = person.kind === 'user' && person.groups?.find((g) => g.startsWith('plugin:company-jwt:dept:'));
  return group ? group.slice('plugin:company-jwt:dept:'.length) : null;
};

export default {
  id: 'company-jwt',
  apiVersion: 1,
  name: 'Company sign-in',
  version: '1.0.0',
  config: {
    cookie: { type: 'string', default: 'corp_token', description: 'The cookie that holds the JWT.' },
    key: { type: 'secret', description: 'The HS256 key the tokens are signed with (or use jwksUrl).' },
    jwksUrl: { type: 'string', description: 'Where the signing keys are published (RS256, ES256).' },
    issuer: { type: 'string', required: true, description: 'The `iss` every token must carry.' },
    departments: { type: 'map', default: {}, description: 'Department -> viewer, commenter or editor on every artifact.' },
  },
  validate(c) { /* exactly one of key and jwksUrl; every role viewer, commenter or editor */ },
  auth: {
    async authenticate({ request }, ctx) {
      // read the cookie, verifyJwt(...) against the key or the JWKS and the issuer, and answer
      // {subject: sub, email, emailVerified: true, name, groups: ['dept:<department>']}, or null
    },
    identity({ identity, provider }, ctx) {
      // for plugin:company-jwt sign-ins: {reject: 'Your department does not use this site yet.'} unless listed
    },
  },
  authz: {
    cacheSeconds: 300,
    role({ principal, role }, ctx) { /* the department's role, never lower than the site's own */ },
  },
  guard({ action, detail }) {
    if (action === 'share.change' && detail.changes.access === 'public') return { deny: 'Public links are turned off here: share with people or departments instead.' };
    return undefined;
  },
  routes: [{ method: 'GET', path: '/me', handler: ({ principal }) => Response.json({ department: departmentOf(principal) }) }],
  ui: { links: [{ label: 'My department', href: '/plugins/company-jwt/me', where: 'account-menu' }] },
};
```

（上面省略的函数体见文件。）注意各部分怎么衔接：`authenticate` 把部门作为 `dept:design` 放进身份的 `groups`；站点把它存成
`plugin:company-jwt:dept:design`，`authz.role` 和路由读到的就是这个。

1. 运行它的测试：

   ```bash
   node --test examples/host-plugins/company-jwt.test.mjs
   ```

   **预期：** 七个测试，`ℹ pass 7`、`ℹ fail 0`。

2. 为它准备一个站点（单独的目录和端口，不用代理：Cookie 本身就是凭证）。开一个新终端：

   ```bash
   mkdir -p ~/oa-jwt-demo && openssl rand -hex 32 > ~/oa-jwt-demo/corp-key && chmod 600 ~/oa-jwt-demo/corp-key
   export OA_DATA_DIR=~/oa-jwt-demo/site OA_PORT=4921 OA_APP_ORIGIN=http://localhost:4921 OA_CONTENT_ORIGIN='http://{id}.content.localhost:4921'
   export OA_OWNERS=ann@corp.example OA_SIGNUP=domain:corp.example CORP_JWT_KEY=$(cat ~/oa-jwt-demo/corp-key)
   unset OA_PLUGINS OA_PLUGINS_FILE
   node packages/host/src/node/main.ts plugin add "$PWD/examples/host-plugins/company-jwt.mjs" \
     --config '{"key":{"env":"CORP_JWT_KEY"},"issuer":"https://login.corp.example","departments":{"design":"editor","sales":"viewer"}}'
   node packages/host/src/node/main.ts plugin check
   ```

   **预期：**

   ```
     on   company-jwt 1.0.0  (/Users/you/open-artifact/examples/host-plugins/company-jwt.mjs)
            Company sign-in
            hooks: auth.authenticate, auth.identity, authz.role, guard, routes, ui
            settings: cookie, key, jwksUrl, issuer, departments
   All 1 plugin(s) that are on can run.
   ```

3. 启动：`node packages/host/src/node/main.ts serve`。**预期** `plugins: company-jwt (from …)`。

4. 像公司登录系统那样生成令牌。保存 `~/oa-jwt-demo/mint.mjs`：

   ```js
   // node mint.mjs <sub> <email> <name> <department>: an HS256 token signed with CORP_JWT_KEY
   import { createHmac } from 'node:crypto';
   const [sub, email, name, department] = process.argv.slice(2);
   const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
   const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'https://login.corp.example', sub, email, name, department, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
   console.log(`${body}.${createHmac('sha256', process.env.CORP_JWT_KEY).update(body).digest('base64url')}`);
   ```

   然后在第二个终端（同样的 export）让四个人登录：

   ```bash
   cd ~/oa-jwt-demo
   signin() { node mint.mjs "$@" > "$1.tok"; printf '%s: ' "$3"; curl -s -c "$1.jar" -b "corp_token=$(cat $1.tok)" http://localhost:4921/api/open-artifact.auth.me | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0)).principal)"; }
   signin e1001 ann@corp.example Ann design
   signin e1002 bob@corp.example Bob design
   signin e1003 cy@corp.example Cy sales
   signin e1004 lee@corp.example Lee legal
   ```

   **预期：**

   ```
   Ann: {"kind":"user","id":"usr_…","name":"Ann","email":"ann@corp.example","siteRole":"admin"}
   Bob: {"kind":"user","id":"usr_…","name":"Bob","email":"bob@corp.example","siteRole":"member"}
   Cy: {"kind":"user","id":"usr_…","name":"Cy","email":"cy@corp.example","siteRole":"member"}
   Lee: {"kind":"anonymous"}
   ```

   Lee 的部门（legal）不在名单上；站点日志记
   `sign-in refused (plugin:company-jwt): plugin_refused: plugin company-jwt: Your department does not use this site yet.`
   用别的 key 签名的令牌，人仍是匿名，日志记 `plugin company-jwt: refused a token: bad signature`。

5. Ann 上传；Bob 和 Cy 打开；Ann 试着把它设为公开：

   ```bash
   O='origin: http://localhost:4921'
   ID=$(curl -s -b e1001.jar -H "$O" -H 'content-type: application/zip' --data-binary @"$HOME/oa-plugins-demo/sample.zip" \
     http://localhost:4921/api/open-artifact.artifacts.import | node -p "JSON.parse(require('fs').readFileSync(0)).id")
   for u in e1001 e1002 e1003; do printf '%s: ' $u; curl -s -b $u.jar "http://localhost:4921/api/open-artifact.artifact?id=$ID" | node -p "JSON.parse(require('fs').readFileSync(0)).role"; done
   curl -s -w ' %{http_code}\n' -b e1001.jar -H "$O" -H 'content-type: application/json' -d "{\"id\":\"$ID\",\"access\":\"public\"}" http://localhost:4921/api/open-artifact.artifact.share
   curl -s -b e1002.jar http://localhost:4921/plugins/company-jwt/me; echo
   ```

   （如果跳过了前面的例子，先按[第 0 步](#0-准备一个试插件的站点)生成 `sample.zip`。）

   **预期：**

   ```
   e1001: owner
   e1002: editor
   e1003: viewer
   {"code":"not_granted","message":"Public links are turned off here: share with people or departments instead."} 403
   {"department":"design"}
   ```

   按链接分享（`"access":"link"`）是允许的（200）。账户菜单里出现“My department”（站点在 `auth.me` 里给出
   `"site":{"links":[{"label":"My department","href":"/plugins/company-jwt/me","where":"account-menu"}]}`）。`oah audit --action plugin.denied`
   显示 `… plugin.denied  system:plugin:company-jwt  {"action":"share.change","artifact":"art_…"}`。

**出错时：** 所有人都是匿名：站点和 `mint.mjs` 用的 `CORP_JWT_KEY` 不一样，或者令牌的 `iss` 和 `issuer` 不一致。Bob 不是
编辑者：他令牌里的 `department` 和 `departments` 里的键不完全一样。

**上生产前要知道：**

- 每个请求都会核对这个 Cookie，有站点会话时也一样：还是同一个人就继续，换成别人的 Cookie 就换成那个人的会话，没有
  Cookie（退出了公司账号）就结束会话。带着 Bob 的会话和 Cy 的 Cookie，答复是 Cy。插件没法核对时（抛出异常），这一个请求
  按匿名处理，会话保留。
- 部门在会话开始时读取。换了部门的人，直到会话结束（退出站点或公司账号再登录）前都保持原来的角色。
- 角色答复复用 300 秒；在列表项里设 `cacheSeconds` 可以改。
- 身份提供方用 RS256 或 ES256 时，给 `jwksUrl` 而不是 `key`。
- 在 Cloudflare 上：已在 `wrangler dev` 下运行，见[在 Cloudflare 上](#在-cloudflare-上)。

## 写插件（开发者）

### 最小的插件

```js
// hello.mjs
export default {
  id: 'hello',
  apiVersion: 1,
  on: {
    'user.signed_in': (e, ctx) => ctx.log(`${e.user.name} signed in`),
  },
};
```

`oah plugin add "$PWD/hello.mjs"`，重启，登录：站点日志记 `plugin hello: ann signed in`。

插件就是模块默认导出的一个普通对象。`id` 由小写字母、数字和短横线组成（最多 64 个字符）；`apiVersion` 是 `1`。`name`、
`version` 和 `description` 会显示在 `plugin list` 里。不认识的键、钩子和事件会给出警告并被忽略。用 TypeScript 时，
`@open-artifact/host-plugin` 的 `definePlugin({...})` 会根据你的设置推出 `ctx.config` 的类型；Node 上 `.ts` 插件只能从
`node_modules` 以外的路径加载。

插件在 Node 和 Cloudflare Workers 上都要能跑，所以只用 Web API（`fetch`、`crypto.subtle`、`Request`、`Response`），
不要用 `node:` 模块。

### 钩子

每个钩子都是 `(input, ctx) => answer`，可以是 `async`，都是可选的。

| 钩子 | 输入 | 答复 | 出错时 |
| --- | --- | --- | --- |
| `auth.authenticate` | `{request}`（请求头和 Cookie；没有请求体） | 一个身份，或 `null` | 关闭（不让任何人登录） |
| `auth.recheck` | （一个布尔值，不是函数；默认 true） | `authenticate` 建立的会话是否在每个请求上再核对一次 | |
| `auth.signIn` | `{label, start({request, returnTo, callbackUrl}), finish({request})}` | `start`：一个 `Response`（通常是跳转）；`finish`：`{identity, returnTo?}` | 关闭 |
| `auth.identity` | 任何方式登录后的 `{identity, provider}` | 改过的身份、`{reject: 一句话}`，或什么都不返回 | 关闭（拒绝登录） |
| `auth.signOutUrl` | `{principal}` | 退出登录后要跳转去的地址，或什么都不返回 | 用默认页面（照样退出登录） |
| `authz.role` | `{principal, artifact, role}`（`role`：站点的判断，或前一个插件的答复） | 一个角色、`null`（无权访问），或什么都不返回（没有意见） | 关闭（无权访问） |
| `authz.cacheSeconds` | （一个数字，不是函数） | 角色答复可以复用多久；默认 30 | |
| `authz.artifacts` | `{principal}` | 要额外列在他首页上的作品 id | 开放 |
| `guard` | `{action, principal, artifact?, detail}` | 什么都不返回，或 `{deny: 一句话}` | 关闭（拒绝） |
| `on.<event>` | 事件（见下） | 什么都不返回；事后在后台运行 | 开放 |
| `wake.deliver` | `{artifact, owner, payload, from}`，一个从 Ask 面板发给所有者 Agent 的请求 | `{delivered: true}`，或什么都不返回（进入发件箱） | 开放 |
| `routes` | 一组 `{method, path, public?, handler({request, principal, params}, ctx)}` | 一个 `Response` | 错误答复 |
| `ui` | （一个对象）`{links: [{label, href, where: 'account-menu' \| 'home'}], brand: {name?, logoUrl?}}` | | |

身份是 `{subject, email?, emailVerified?, name?, avatar?, groups?}`。principal 是 `{kind: 'user', id, name, email?,
groups?, siteRole}`、`{kind: 'guest', …}`、`{kind: 'agent', label, user}` 或 `{kind: 'anonymous'}`；不认识的 kind 就什么都
不返回。作品是 `{id, type, title, owner, generalAccess, createdAt, updatedAt, trashedAt}`。角色有 `owner`（所有者）、
`editor`（编辑者）、`commenter`（评论者）、`viewer`（查看者）。

`wake.deliver` 只用于 Ask 面板发来的请求。评论里请 Agent 帮忙的请求总是进入所有者的发件箱，因为 Agent 是在所有者的
电脑上、在那条评论里回复的。

### 事件

每个事件还带着 `event`（事件名）和 `at`（ISO 时间）。`artifact` 是 `{id, type, title, owner}`；`by` 是 `{kind, id, name?}`。

| 事件 | 字段 |
| --- | --- |
| `user.created` | `user {id, name, email}`、`provider` |
| `user.signed_in` | `user {id, name, email}`、`provider`（`github`、`oidc:<id>`、`plugin:<id>`、…） |
| `artifact.created` | `artifact`、`by`、`via`（`import`、`link`、`mcp`） |
| `artifact.changed` | `artifact`、`by`、`changes {title?, files?}` |
| `artifact.trashed`、`artifact.restored` | `artifact`、`by` |
| `artifact.deleted` | `artifact`、`by`、`reason`（`owner`、`expired`） |
| `share.changed` | `artifact`、`by`、`changes {access?, grants?, links?, guests?, settings?}` |
| `share.invited` | `artifact`、`by`、`invitee {email?, userId?, name?}`、`role`、`url` |
| `agent.requested` | `artifact`、`by`、`owner`、`text`、`label?` |
| `audit` | `action`、`actor`、`artifact`、`detail`：每条审计记录，插件自己写的除外 |

### 受守卫的操作

| 操作 | `detail` | 什么时候问 |
| --- | --- | --- |
| `artifact.create` | `{type, title, via}`（`via`：`import`、`link`、`mcp`） | 上传时解包之后；电脑发布一个新作品；Agent 通过 MCP 创建。站点自己没有“新建”。 |
| `artifact.import` | `{type: null, bytes, via: 'library'}` | 在首页上传、解包之前（电脑发布走的是 `link.publish`） |
| `artifact.delete` | `{permanent}` | 移到回收站、从回收站彻底删除、取消发布、Agent 删除 |
| `artifact.export` | `{format}` | 下载作品的 `.zip`（从站点下载，或由电脑下载） |
| `share.change` | `{changes}`（同 `share.changed`） | 任何对“谁能打开”的修改 |
| `link.connect` | `{client {name, harness?, version?}}` | 批准一台电脑连接 |
| `link.publish` | `{type, bytes, replaces}` | 电脑发布或替换一个作品 |
| `type.publish` | `{id, uid, version, bytes, visibility, replaces}`（`visibility`：`private`、`site`、`link`） | 一个类型发布到站点的类型目录（`open-artifact types publish`）时，在包检查完之后、保存任何东西之前；已有的类型发布新版本（或同一版本再发一次）时 `replaces` 为真。谁能发布由 `OA_TYPES_PUBLISH` 决定，先于它判断。 |
| `mcp.connect` | `{client {id, name}}` | 批准一个远程 MCP 客户端 |
| `agent.ask` | `{text, label?}` | 在 Ask 面板向所有者的 Agent 提需求 |

拒绝时返回 403 和你写的那句话（`{"code":"not_granted","message":"<你的那句话>"}`），并在审计日志里记 `plugin.denied`。
不认识的操作什么都不返回：以后可能会增加新的操作。

### `ctx` 的每个成员

| 成员 | 是什么 |
| --- | --- |
| `ctx.plugin.id` | 你的插件的 id。 |
| `ctx.config` | 检查过的设置，只读。默认值已填好，`{"env"}` 引用已读取。 |
| `ctx.log(message, fields?)` | 站点日志里的一行，形如 `plugin <id>: <message>`。密钥类设置的值会被抹掉。 |
| `ctx.fetch(url, init?)` | `fetch`，调用时间用完时会被中止。请用它，不要用全局的 `fetch`。 |
| `ctx.kv` | 一个属于你自己的小存储：`get(key)`、`set(key, value, {ttlSeconds?})`、`delete(key)`、`list({prefix?, after?, limit?})`（默认 100，最多 1000）。键最多 512 字节，值最多 64 KiB 的 JSON，最多 10,000 个键。重启后还在；`plugin remove` 也会保留。 |
| `ctx.now()` | 当前时间（测试工具可以拨动它）。 |
| `ctx.signal` | 调用时间用完时触发中止。 |
| `ctx.host.apiVersion`、`ctx.host.version` | 插件 API 版本和站点的发布版本。 |
| `ctx.host.appOrigin` | 站点地址（`https://artifacts.example.com`）。 |
| `ctx.host.supports(name)` | 这个站点是否有某个钩子、事件或受守卫操作（`'on.share.invited'`、`'guard.agent.ask'`）。 |
| `ctx.host.users.get(id)`、`.findByEmail(email)` | 一个用户 `{id, name, email, emailVerified, avatar, siteRole, createdAt, disabled}`，或 null。 |
| `ctx.host.artifacts.get(id)` | 一个作品，或 null。 |
| `ctx.host.artifacts.list({owner?, after?, limit?})` | 站点上不在回收站里的作品，按 id 分页：`{artifacts: [{id, title, type, owner, updatedAt}], next}`（把 `next` 作为 `after` 传入；最后一页是 null）。`limit` 默认 50，最多 200。适合小站点：用它算出来的结果存进 `ctx.kv`，不要每个请求都列一遍。 |
| `ctx.host.access.invalidate(artifactId?)` | 忘掉缓存的角色答复：某一个作品的，或全部。 |
| `ctx.host.audit(action, detail?)` | 写一条审计记录（`action` 形如 `invite.sent`；`detail` 是最多 8 KiB 的 JSON），操作者是 `plugin:<id>`。你自己写的记录不会再发给你的 `on.audit`。 |

### 设置

插件里的 `config` 是结构定义；运维在列表项里的 `config` 给出值：

```js
config: {
  url: { type: 'string', required: true, description: 'Where to ask.' },
  secret: { type: 'secret' },               // never shown in plugin list, the admin API or the logs
  events: { type: 'string[]', default: [] },
  retries: { type: 'number', default: 3 },
  verbose: { type: 'boolean', default: false },
  groups: { type: 'map', default: {} },     // {"name": "text"}, strings only
  rules: { type: 'json' },                  // any JSON value
},
validate(config) {                          // optional, synchronous
  if (!config.url.startsWith('https:')) return '"url" must be an https: address.';
},
```

`validate` 什么都不返回，或返回一句话、一组话（每一句都是一个会阻止站点启动的问题）；也可以直接抛出异常。它必须立即
答复：返回 promise 也算问题。`description` 会出现在 “is required” 的提示里。

### 身份的规则

- `subject` 是这个人在你们系统里的稳定 id（最多 256 个字符）。绝不要把它给另一个人复用。
- 站点按 provider 和 subject 找账户。找不到时，只有你标了 `emailVerified: true` 的邮箱才会关联到已有账户；再找不到，站点
  的注册规则（`OA_SIGNUP`）允许时才新建账户。只有你们系统确实验证过这个地址时才写 `emailVerified: true`。
- `OA_OWNERS` 里的地址无论用哪种方式登录都是站点管理员。
- `auth.identity` 可以加组、改名字，但不能改 `subject`：改了 subject 会导致登录被拒绝。
- 组存成 `plugin:<id>:<group>`；`authz.role` 看到的、分享时用来指定组的，都是这个形式。
- `auth.authenticate` 的答复会变成一个会话（30 天，或直到退出登录），之后这个会话的每个请求都会再问插件：同一个
  `subject` 保留会话，换了身份就结束它并让新的人登录，`null` 或什么都不返回就结束它。插件抛出异常或超时，这一个请求按
  匿名处理，会话保留。在 `auth` 里写 `recheck: false`，就只在没有会话时才问插件，会话也不再跟着上游变化。组和名字在会话
  开始时读取。
- `authenticate` 认出、但站点拒绝的人（站点的注册规则、插件的 `auth.identity`）会被告知原因：打开页面看到登录页，API 得到
  401 `sign_in_refused` 和原因。其他登录方式照常能用。

### 角色和缓存

站点先根据自己的分享设置算出角色，再按列表顺序用 `authz.role` 问每个插件；每个插件都看到当前的角色。最终答复会按同一个人、
同一个作品、同一个站点角色复用，复用时长是被问到的插件里最小的 `cacheSeconds`（列表项的 `cacheSeconds`，没有就用插件的
`authz.cacheSeconds`，再没有就是 30）。出错的答复不复用。

- 站点自己的分享设置一改就生效。
- `ctx.host.access.invalidate(id)` 或 `invalidate()` 让站点的每个部分在下次查询时忘掉缓存的答复；已经打开的页面也会更新。
  在一个由你们系统在权限变化时调用的路由里调用它，就像 `http-authz` 那样。
- 否则，你们系统里的变化最晚 `cacheSeconds` 之后被看到。

### 路由

```js
routes: [
  { method: 'POST', path: '/hook', public: true, async handler({ request }, ctx) {
      const body = await readText(request);                    // at most 1 MiB
      const ok = await verifyHmacSha256({ secret: ctx.config.secret, body, signature: request.headers.get('x-signature') ?? '', prefix: 'sha256=' });
      if (!ok) throw new HttpError(401, 'Bad signature.');
      return json({ ok: true });
  } },
],
```

- 路由的地址是 `/plugins/<id><path>`；`:name` 匹配一段路径并放进 `params.name`，末尾的 `*` 匹配剩下的全部。
- `principal` 是站点 Cookie 对应的登录用户（带 `Authorization: Bearer` 的请求算匿名）。
- 写操作（GET、HEAD、OPTIONS 以外）只接受来自站点自己页面的请求（否则 403 `Cross-site requests may not change anything
  here.`），除非 `public: true`。公开路由是给其他服务器调用的，必须自己校验签名。
- 请求体最大 1 MiB。`throw new HttpError(status, message)` 答复 `{"code":"plugin_error","message"}`；超时答复 504；
  其他错误 500。

### 链接和品牌

`ui.links` 往账户菜单（只对登录用户显示）或首页加链接。`href` 是站点上的路径，或 `https:`/`http:` 地址（页面会去掉其他主机
上的 `http:` 地址）；其他写法会阻止站点启动。`ui.brand {name, logoUrl}` 替换 Open Artifact 的名字和标志；第一个设置它的
插件生效。

### 辅助函数

`@open-artifact/host-plugin` 提供：`json(value, init?)`、`readText`、`readJson`（默认 1 MiB）、`readBody`、`HttpError`、
`timingSafeEqual(a, b)`、`signHmacSha256({secret, body, encoding?})`、`verifyHmacSha256({secret, body, signature, encoding?,
prefix?})`，以及 `verifyJwt({token, jwksUrl | key, issuer?, audience?, algorithms?, clockToleranceSeconds?, requireExpiry?,
now?}, fetch)`（RS256、ES256、HS256；答复 `{valid: true, claims, header}` 或 `{valid: false, reason}`）。`fetch` 传
`ctx.fetch`，`now` 传 `ctx.now()`。

### 测试

`@open-artifact/host-plugin/testing` 不需要站点，就能像站点那样运行插件：按站点的规则检查插件和设置，带着时间上限、出错策略
和答复检查调用每个钩子，并记录发生了什么。

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPluginHarness } from '@open-artifact/host-plugin/testing';
import plugin from './my-plugin.mjs';

test('the service makes Ann an editor', async () => {
  const h = createPluginHarness(plugin, {
    config: { url: 'https://perms.example.com', secret: { env: 'PERMS_SECRET' } },
    env: { PERMS_SECRET: 'test-secret' },
    fetch: async (request) => Response.json({ role: 'editor' }),
  });
  const artifact = h.addArtifact({ title: 'Plan' });
  const ann = h.userPrincipal(h.addUser({ email: 'ann@example.com' }), ['plugin:my-plugin:design']);
  assert.deepEqual(await h.role({ principal: ann, artifact, role: null }), { role: 'editor', cacheSeconds: 30 });
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.failures, []);
});
```

`createPluginHarness(plugin, {config, env, now, fetch, timeoutMs, cacheSeconds, appOrigin, hostVersion, features})` 在站点
会拒绝启动时抛出 `PluginRefusedError`（带 `problems`）。它提供 `authenticate`、`signInStart`、`signInFinish`、`identity`、
`signOutUrl`、`role`、`artifactsFor`、`guard`、`emit`、`deliverWake` 和 `request(method, path, {principal, body, headers})`；
记录 `logs`、`audits`、`fetches`、`failures`、`invalidated`、`warnings`；一个内存里的 `kv`（`kv.dump()`）；以及 `addUser`、
`addArtifact`、`userPrincipal`、`advance(ms)`。完整的测试文件见 `examples/host-plugins/company-jwt.test.mjs`，其他例子的测试
见 `packages/host-plugin/test/examples.test.ts`。

运行：`node --test my-plugin.test.mjs`。测试工具和辅助函数一样随 Open Artifact 源码提供，所以要在源码目录里面运行。

### 限制

- **时间：** 每次调用有 `timeoutMs`（5 秒）。到时 `ctx.fetch` 会被中止。从不等待的代码（`while (true)` 循环、极其复杂的正则
  表达式）停不下来，会卡住站点：每次只做少量工作。
- **存储：** `ctx.kv` 键 512 字节、值 64 KiB，每个插件 10,000 个键。
- **路由：** 请求体 1 MiB。
- **状态：** 不要把状态放在模块变量里。在 Cloudflare 上，站点的每个部分（Worker、每个作品的房间）各自运行一份你的插件；
  请用 `ctx.kv`。在房间里，`invalidate` 能到达正打开的房间；别处的页面大约 2 秒内看到变化。后台工作随请求结束；没有定时器。

### 插件做不到的事

在 API 版本 1 里，插件不能：

- 往站点页面里注入脚本或样式（只能加 `ui` 链接和品牌）；
- 增加作品类型，或改变编辑器的行为；
- 把作品或文件存到别的地方（站点的存储是固定的）；
- 看到在页面里完成的导出：PDF、PowerPoint 和图片导出在浏览器里生成，所以守卫的 `artifact.export` 只看得到 `.zip` 下载；
- 在登录之后改变一个人是谁（`subject`），或者在 `auth.authenticate` 里读请求体。

## 给运维的安全提示

- **插件拥有站点的全部权限。** 它在站点内部运行，能读到交给它的每个请求，看到大家的地址和所在组，能访问互联网上任何地址
  （`ctx.fetch`）、保存数据（`ctx.kv`）、读取任何用户和作品的记录（`ctx.host`）、清除权限缓存、写审计日志。只装你读过、
  或者和站点本身一样信任的代码，并固定它的版本。
- **请求头登录的安全性取决于网络。** 用 `header-auth` 时，代理必须是访问站点的唯一途径。把站点绑定到 `127.0.0.1` 或内网地址，
  或者用防火墙挡住，共享密钥要足够长并保密。
- **密钥放在环境变量里**，不要写进 `plugins.json` 或 `OA_PLUGINS`：用 `{"env":"NAME"}`。在 Cloudflare 上用 Worker secret。
  列表文件写入时只有所有者可读，但它终究是个文件。
- **权限检查出错即关闭。** 权限服务挂了，大家都会被挡在外面，所有者也不例外；他们会看到权限检查没能完成，审计日志里的
  `plugin.failed` 说明原因。像监控站点一样监控它；要先让大家进来，就把插件停掉（见[插件出错时](#插件出错时)）。
- **会话跟着上游登录走。** 插件的 `auth.authenticate` 建立的会话每个请求都会核对：退出公司账号、同一个浏览器换了人，都会
  结束它。站点自己的登录方式建立的会话（以及 `recheck: false` 的插件）持续 30 天或直到在站点上退出登录；有人离职时，也在
  站点上停用他的账户。
- **哪些信息会离开站点：** 权限插件会把每个人的邮箱、所在组和作品标题发给它的服务；事件插件会发出事件里带的内容（标题、
  地址、需求文字）。打开插件前先想清楚。
- **审计记录**包括登录、拒绝登录（`auth.sign_in_refused`）、插件出错（`plugin.failed`）、守卫拒绝（`plugin.denied`），
  以及插件自己写的记录。

## 文件

| 文件 | 是什么 |
| --- | --- |
| `examples/host-plugins/` | 六个示例插件，以及 `company-jwt.test.mjs`。 |
| `packages/host-plugin/README.md` | 插件 API 简介，写给插件作者（英文）。 |
| `packages/host-plugin/src/index.ts` | 类型定义，每个字段都有注释。 |
| `deploy/cloudflare/plugins.mjs` | 打包进 Worker 的插件。 |
| `<数据目录>/plugins.json` | Node 站点的插件列表（没有设置 `OA_PLUGINS` 时）。 |
