# 自己做作品类型

[English](custom-types.md)

除了内置类型，Open Artifact 也能运行你自己做的类型。一个类型就是一个文件夹：一个页面（`index.html`）、一份清单
（`artifact-type.json`），再加一份 `SKILL.md`，告诉 agent 怎么往这种作品里填内容。这个类型的每个作品都在 Shell
里打开同一个页面，评论、历史记录、“发送给 agent”都有，内容则存在作品自己的文件夹里。

同一种页面要反复做的时候，就做成类型：旅行计划、读书记录、每周记分卡。只做一次的页面，直接让 agent 做一个
`page` 作品就行。

## 类型放在哪里

| 哪种 | 文件夹 | 什么时候用 |
| --- | --- | --- |
| 你自己的 | `~/.agents/artifact-types/`（设置里的 `typeRoots.user`，或 `OPEN_ARTIFACT_USER_TYPES`） | 每个项目都能用。 |
| 项目的 | `<项目>/.agents/artifact-types/` | 在这个项目里用。信任这个项目之前，带着安装的类型的那些限制（见[信任一个项目](#信任一个项目)）。 |
| 额外的 | 设置里的 `typeRoots.extra`，或 `OPEN_ARTIFACT_EXTRA_TYPES`（冒号分隔） | 每个项目都能用。 |
| 安装的 | `<OPEN_ARTIFACT_HOME>/types/`（或 `OPEN_ARTIFACT_INSTALLED_TYPES`），由 `types install` 写入 | 每个项目都能用，但有[安装别人的类型](#安装别人的类型)里说的限制。 |
| 内置的 | 随 Open Artifact 一起提供 | 一直可用，除非你停用它。 |

同一个 id，离得更近的文件夹优先：项目的盖过你自己的，你自己的盖过额外的，额外的盖过安装的。安装的类型永远不能用
内置类型的 id。`open-artifact types list` 列出每个类型的 `scope`、`source`（`builtin`、`local` 或 `installed`，
安装的类型还有 `installedFrom`）、`version`、`uid`、文件夹和问题。主页的 **类型** 标签页显示的是同样的内容，
还会列出每个类型的页面能用哪些能力、能访问哪些网站。

## 新建一个类型

在你的终端里，或者让 agent 来跑：

```bash
open-artifact types new trip-planner --template page        # 内容是页面旁边的文件
open-artifact types new reading-log --template data          # 内容是数据库里的记录
open-artifact types new board --scope project                # 放进当前项目的 .agents/artifact-types/
```

也可以在主页的类型标签页点 **新建类型**：填 id、名称、模板和放在哪里。建好以后，对话框会显示类型的文件夹，
以及一段可以复制给 agent 的话，让它接着把类型做完整。

- id 只能用小写字母、数字和短横线，不能和内置类型同名，也不能叫 `new-type`；同名文件夹已经存在时会拒绝。
- `--template page`（默认）把作品内容存在 `content.json` 里：agent 写，你在页面上改了再保存。
  `--template data` 把内容存在作品的数据库里，页面和 agent 同时改。
- 生成的骨架拿来就能用：马上就可以用它新建作品。

agent 有一份把类型做完整的指南：`/open-artifact new-type`（在技能里的 `reference/new-type.md`）。里面讲了文件夹
结构、页面顶部的声明块、页面能用哪些能力、两种存内容的方式，以及怎么写类型自己的 `SKILL.md`。还讲了类型页面
该怎么设计（每种状态都要设计、不从别的站点加载东西、明暗两套主题、窄屏可用），并指向
[Page](types/page.zh-CN.md#设计指引) 类型自带的设计、图示和图表指引。

## 把页面变成类型

一个已经好用的 `page` 作品可以直接变成类型：

```bash
open-artifact types from art_… --id trip-planner
```

它会复制页面和 `artifact-type/` 文件夹，把作品声明过的能力写进页面，并起草清单和 `SKILL.md`。返回结果里列出了
没复制的文件（作品的内容、数据库和上传的文件），以及要改哪些地方，才能让每个新作品读它自己的内容。

### 从 claude.ai 保存下来的页面

从 claude.ai 的作品模板保存下来的页面（一个含 `index.html` 的文件夹，可能还有 `metadata.json` 和一个图标；或者
单个 `.html` 文件）也能这样变成类型：

```bash
open-artifact types from ./saved-page --id cite-check
open-artifact types from ./saved-page/index.html --id cite-check --scope project --name "Citation check"
```

- 页面里自带的那份框架运行时会被去掉，改用 Open Artifact 自己的。
- 页面没有声明能力时，会替它声明代码里调用到的能力。返回结果在 `capabilities.inferred` 里列出它们，另有
  `stubbed`（`mcp`、`sample`、`tts`、`paste` 在这里只会返回错误）和 `unknown`（Open Artifact 没有的名字，比如
  网络权限；要访问的网站请改写进 `openArtifact.network`）。
- `artifact-type.json` 的名称、描述和图标取自 `metadata.json`，每项一行、超长截断；`--name` 优先。图标只有是页面
  旁边的普通图片文件（`.svg`、`.png`、`.webp`、`.jpg`、`.gif` 或 `.ico`，不超过 512 KB）时才复制。版本是 `1.0.0`。
- `SKILL.md` 是页面里写给 Claude 的说明（`notes-for-claude` 块），并注明是页面作者写的；没有的话就是一份待填写的
  草稿。
- 文件夹里别的东西都不复制，返回结果会列出跳过了什么。页面从 claude.ai 加载的字体或文件不在这里，页面会退回到
  浏览器自带的。

页面和其中的说明是别人写的。用这个类型之前，先读一遍 `index.html` 和 `SKILL.md`：这样做出来的类型是你自己的
（用户类型，或者在信任项目之前受限的项目类型），它的页面能做你自己的类型能做的事。`--scope` 默认是 `user`。
这条命令需要 daemon 的令牌，所以只能从你的终端或 agent 运行，网页发不了。

## 检查

```bash
open-artifact types check trip-planner
open-artifact types check ./path/to/folder --for-share
```

它列出错误（类型跑不起来）和提醒（可能和本意不符），有错误时退出码是 1。会查这些：id 不合法、清单解析不了、
声明块不是纯数据（或者用了 `let`/`const`）、能力名不认识、`SKILL.md` 缺少开头的 front matter、id 和内置类型
撞名。只有桩实现的能力（`mcp`、`sample`、`tts`、`paste`）算提醒：它们在这台电脑上只会返回错误。
`--for-share` 再加上给别人用的类型要满足的规则：`slug`、`uid`、`name`、`version`、`description` 都要有；
`entry` 不能启动程序，也不能指向网址；不能有符号链接和点开头的文件；最多 2000 个文件，单个文件不超过 16 MiB，
总共不超过 64 MiB。

## 试一试

1. `open-artifact types list` 里能看到它，并且 `"runnable": true`。
2. 新建一个它的作品：让 agent 做，或者在类型标签页它的卡片上点 **新建 <类型>**。
3. 在页面上用一用，再让 agent 按类型的 `SKILL.md` 往里填内容。

agent 也可以自己看这个类型的作品：所有页面型类型都有 `snapshot` 动作，按它选的宽度、高度和明暗主题给页面拍一张 PNG（见 [Page](types/page.zh-CN.md#页面截图snapshot)）。截图只读，对任何作品都是安全的。

## 停用和启用

```bash
open-artifact types disable trip-planner
open-artifact types enable trip-planner
```

也可以用类型标签页卡片上的开关。类型停用期间，agent 不能新建它的作品。这件事由你决定：在 agent 的会话里运行
这条命令会被拒绝；daemon 也会拒绝别的网页发来的请求，以及自称来自 agent 会话的请求。这些是护栏，不是边界：
你电脑上的程序只要不说明自己在哪里运行，仍然可以发出这个请求。

## 信任一个项目

项目的类型来自项目文件夹，任何往这个项目里写过东西的人都可能改过它们。信任这个项目之前，它的类型照样能用
（要启动自己程序的类型，即 `entry.start`，不会启动），但带着安装的类型的那些限制（见[安装别人的类型](#安装别人的类型)）：不能有自己的程序（`entry.start` 或
`entry.url`），页面在沙盒框架里运行，只能访问它自己的地址和它列出的网站，agent 也会被告知这个类型里的文字不是你
写的。`types check` 会提醒这一点（`untrusted_restricted`）。信任这个项目后限制就取消，正在运行的页面也会去掉限制
重新启动：

```bash
cd ~/code/my-app && open-artifact types trust
open-artifact types untrust ~/code/my-app
```

也可以在类型标签页对应项目下点 **信任这个项目**。和停用、启用一样，信任由你来做，在 agent 的会话里同样会被拒绝。
`OPEN_ARTIFACT_TRUST_PROJECTS=1` 会信任所有项目（用于测试和 CI）。

## 分享一个类型

```bash
open-artifact types pack trip-planner                 # 在当前目录写出 trip-planner-<version>.oatype
open-artifact types pack ./path/to/folder --out ~/Desktop
```

`types pack` 先跑一遍 `types check --for-share`，有任何错误就拒绝；通过后把文件夹压成一个文件
`<id>-<version>.oatype`，并打印它的 sha256。把这个文件交给对方，或者放到一个对方能下载的 `https://` 地址上。

`artifact-type.json` 里的 `uid` 决定它在哪里都是同一个类型：改类型时保留它，用它做的作品才能一直打开。页面要访问
别的网站时，把它们列在 `openArtifact.network` 里（`["https://api.example.com"]`，只能是 `https://` 源）；安装后的
类型、或者还没信任的项目里的类型，页面访问不了别的地方。

## 安装别人的类型

```bash
open-artifact types install ./trip-planner-1.2.0.oatype
open-artifact types install https://example.com/trip-planner-1.2.0.oatype
open-artifact types install ./trip-planner-1.2.0.oatype --as trips      # 换一个 id 安装
open-artifact types update trip-planner                                  # 从记录的来源重新读取
open-artifact types uninstall trip-planner
```

也可以在类型标签页点 **安装类型**，选文件或者填地址。安装之前你会先看到这个包是什么：id、版本、来源、sha256、
页面要用的能力、能访问的网站，以及完整的 `SKILL.md`（agent 新建这种作品时会读到的内容）。命令行会问 `[y/N]`；
读过之后可以加 `--yes` 跳过提问。安装、更新、卸载都由你来做：和停用类型一样，在 agent 的会话里、从别的网页发来时
都会被拒绝。

安装的类型能做的事比你自己的类型少：

- 它永远不会在你的电脑上启动程序（`entry.start`），也不会指向别的地址（`entry.url`），即使安装后有人改了它的
  文件夹也一样：它的页面由 Open Artifact 当作文件来提供。
- 它的页面在浏览器里带着 Content-Security-Policy、在沙盒框架里运行：它发出的请求、图片、嵌入的页面和表单只能到
  它自己的地址和清单里列出的 `https://` 网站，别的都不行。它打不开弹窗或新标签页，挪不动 Shell 页面，也不能把
  自己所在的框架转到别的地址（链接、meta refresh 或改写 location 的脚本都不行），指向别的网站的下载链接也什么都
  取不到。这些是在 Chrome 里实测的，它自己的文件、数据、上传和下载照常可用。单独在标签页里打开页面地址时，有这条策略但没有框架的沙盒；
  页面也仍然可以把文字送到你的 agent 面前（发给 agent 的评论，或它建议的标题），agent 会被告知把这些当作数据读。
- agent 会被告知：它的 `SKILL.md`、标题和描述是发布者写的，不是你写的；只能用来做这个作品，不能借此扩大任务
  或者索要权限。
- 你不能把它发布到网站上：那是它作者的事。网站上有了它（同一个 `uid`）之后，用它做的作品可以照常发布到那里。
- 它的文件夹或作品文件夹里，指向文件夹外面的链接既不会被提供，也不能借它写入。

安装时先解压到一个临时文件夹，所有检查都通过后才移到位：包里有路径跑出自己的文件夹、有链接、有重名、文件数或
字节数超过上限、有 `entry.start`，都会被拒绝，而且被拒绝的安装什么都不会留下。包里的任何东西都不会在你的电脑上
运行，安装出来的都是普通文件（`0644`：无论包里怎么写，都不会变成可执行文件）。地址只通过 `https://` 下载，
不带你的 cookie 或凭据；下载到的字节的 sha256 和来源一起记在
`<OPEN_ARTIFACT_HOME>/types.json` 里。

同一个 id、不同的 `uid` 是另一个类型：`types install` 会拒绝，并让你用 `--as <id>`。`types update` 从记录的来源
重新读取，只有 `uid` 仍然相同时才安装。卸载后，用这个类型做的作品原样留着；重新安装后就又能打开。

## 发布到网站

你发布作品的 Node 网站（见[托管](hosting.zh-CN.md)）也可以保存你的类型，这样用它们做的作品在那里也能给你分享的人打开。

```bash
open-artifact types publish trip-planner                       # 发到默认网站；私有
open-artifact types publish trip-planner --remote work --visibility site
open-artifact publish art_x9k2 --with-type                     # 网站上没有这个类型时先发类型，再发作品
open-artifact types unpublish trip-planner --remote work
```

- **能发什么。** 你自己的类型：用户类型、额外根目录里的类型，或者你信任的项目里的类型。内置类型不行（每个网站都有），
  你安装的类型也不行（由它的作者来发）。只有网站能原样提供页面的类型才行：带 `// artifact.json` 声明的
  `index.html`、没有自己的 `entry`、不是页面类型（`openArtifact.style: "page"`）。它必须有 `uid`。
- **怎么发。** `types publish` 像 `types pack` 一样打包（先跑 `types check --for-share`，有错误就拒绝），再把包发过去。
  网站在保存任何东西之前，按 `types install` 完全相同的方式检查它，包里的东西在网站上永远不会运行：它的页面在作品
  自己的页面主机上、在和安装类型一样受限的框架里运行，Content-Security-Policy 由它的 `openArtifact.network` 列表生成。
- **id 归网站。** 一个网站上一个 id 只对应一个类型。别人已占用的 id 下、`uid` 不同的包会被拒绝，并写明占用它的 uid；
  请给你的类型换个 slug。再次发布同一个 `uid` 就是新版本，只有你（或网站管理员）能发；同一版本内容不同会被拒绝
  （请提高 `version`），同样的字节再发一次什么都不改变。
- **谁能看到。** `--visibility private`（新类型的默认值：你和网站管理员）、`site`（网站上所有有账号的人）或 `link`
  （任何说得出它名字的人）。可见性决定谁能列出和下载这个包，从不决定谁能运行它：能打开这种作品的人都会运行它。
  新版本沿用原来的可见性，除非你另外指定。
- **它的作品。** 网站上没有某个类型时，`open-artifact publish <id>` 发布这种作品会被拒绝，并写明类型 id 和该运行的两条
  命令。`--with-type` 先以 `link` 可见性发布类型，再发布作品。网站只接受做作品时那个 `uid` 的类型（否则返回
  `type_mismatch`）。自动发布不会动这些作品：它们的类型要由你亲手发到网站。
- **新版本。** 在网站上打开着的作品会立刻用上新版本：页面带着新文件和新的网络列表重新加载。
- **取消发布。** 还有作品在用这个类型时，只会把它下架：不再列出、不能下载、不能再用它新建作品，已有的作品照常打开。
  没有作品再用它时，网站会删除它。再次发布就重新上架。
- **由你来做。** 发布、取消发布类型，以及 `--with-type`，在 agent 的会话里都会被拒绝，不管网站是否允许 agent 发布作品。
  网站上的 agent 会被告知：发布的类型里的文字出自它的发布者，和安装的类型一样。

到底谁能发布类型由网站决定（`OA_TYPES_PUBLISH`：默认只有网站管理员）。

## 把作品搬到另一台电脑

在作品的导出面板里选 **整个文件夹（.zip）** 下载（对应 `artifact.archive` 接口），然后在另一台电脑上：

```bash
open-artifact import ./trip-to-porto.zip                 # 放进主页工作区
open-artifact import ./trip-to-porto.zip --folder ~/trips/porto
```

作品会记下做它的类型的 `uid`（`.artifact.json` 里的 `typeUid`，以及 `typeSource`：包的地址或文件名）。只有这个
uid 的类型能打开它，所以碰巧同名的另一个类型不会打开它。这台电脑上没有这样的类型时，`import` 返回
`type_missing`，写明类型的 id、uid 和来源：先安装那个类型，再导入一次。压缩包在写入任何东西之前会像类型包一样
先检查，里面的东西都不会被运行。

## 暂时还不行

凭链接从网站安装类型，以及列出网站上类型的页面，暂时还不支持。
