# 运行时与更新

[English](runtime.md)

读完后你能在应用里附带 Open Artifact，知道多个应用各带一份时由哪一份启动 daemon，并选择它怎么更新。

## 运行时是什么

运行时就是 npm 包 `@open-artifact/cli` 的内容：`scripts/open-artifact.mjs`（命令行和 daemon），以及 `vendor/` 里的 Shell、类型服务器和内置类型。每个 Open Artifact 主目录（`~/.agents/open-artifact`，或 `OPEN_ARTIFACT_HOME`）只运行一个 daemon，电脑上所有应用共用。

## 附带一份

把运行时目录随应用一起发布，连接时指明它：

```js
const oa = await createHarness({
  harness: 'my-agent',
  runtime: { dir: '/Applications/MyAgent.app/Contents/Resources/open-artifact', version: '0.14.6', update: 'prompt' },
});
```

`hello` 会把它登记到 daemon（记在 `<home>/runtimes.json`），daemon 会把宿主带来的最新运行时复制到共享目录 `<home>/runtime/<version>/`，这样卸载你的应用不会让电脑退回到旧的 daemon。已登记但目录已不存在的运行时会被跳过。

示例用 [`examples/harness-node/harness.mjs`](../../examples/harness-node/harness.mjs) 里的 `hostRuntime()` 找到自己附带的运行时：已安装的 `@open-artifact/cli` 包，在本仓库里则是构建好的 skill，并读出它的版本。设置了 `OPEN_ARTIFACT_DAEMON_BIN` 时它什么都不返回；找不到运行时时它抛出错误。

不传 `runtime` 时，kit 在其他应用登记的运行时和共享运行时中选择。`OPEN_ARTIFACT_DAEMON_BIN`（一个 `open-artifact` 入口文件）会跳过选择。没有可启动的东西时，它抛出 `no_daemon`，修复提示是：`Set OPEN_ARTIFACT_DAEMON_BIN to the open-artifact entry, or pass bin (createHarness: runtime.dir).`

## 哪一份会启动

没有 daemon 在运行时，kit 会在你自己的、已登记的和共享的运行时中，启动 Harness API 版本与你兼容的**最新**一份；人设置了版本锁定时（`open-artifact runtime pin ^0.14`），只在锁定范围内选。版本相同时优先你自己的。正在运行的 daemon 比你自己的运行时旧时，会被替换。

kit 以 `<你的 Node 或 Electron> <runtime>/scripts/open-artifact.mjs daemon run` 的方式、在后台、带 `ELECTRON_RUN_AS_NODE=1` 启动它，所以 Electron 应用不需要另外的 Node。它的输出写到 `<home>/logs/daemon.out`；启动失败时抛出 `daemon_failed`，写明这个文件。关掉了 `RunAsNode` fuse 的 Electron 应用要自己启动它（[见下文](#关掉-runasnode-fuse-的-electron-应用)）。

## 关掉 RunAsNode fuse 的 Electron 应用

`RunAsNode` fuse 关掉后，Electron 应用不能用 `ELECTRON_RUN_AS_NODE=1` 运行脚本，kit 自己的启动方式会失败。这时把 `daemon.spawn` 交给 kit，用 [`utilityProcess.fork`](https://www.electronjs.org/docs/latest/api/utility-process) 启动 daemon：

```js
const { utilityProcess } = require('electron');
const { createWriteStream } = require('node:fs');

const oa = await createHarness({
  harness: 'my-agent',
  runtime: { dir: runtimeDir, version: '0.14.6' },
  daemon: {
    spawn: ({ bin, args, env, logFile }) => {
      const child = utilityProcess.fork(bin, args, {
        env: { ...env, OPEN_ARTIFACT_NODE_CHILDREN: 'threads' },
        stdio: 'pipe',
        serviceName: 'Open Artifact',
      });
      const log = createWriteStream(logFile, { flags: 'a' });
      child.stdout?.pipe(log);
      child.stderr?.pipe(log);
      return child; // 可选：这一份结束时，kit 立刻去试下一份运行时
    },
  },
});
```

kit 交给 `spawn` 的是入口文件（`bin`）、`['daemon', 'run']`、带 `OPEN_ARTIFACT_HOME` 且不带 `ELECTRON_RUN_AS_NODE` 的环境变量，以及日志文件（`<home>/logs/daemon.out`，所在目录已建好）。选择运行时、等待 daemon、检查版本、一份启动不了就试下一份，这些仍由 kit 做；启动时抛出的错误会写进 `daemon_failed` 的消息。返回进程（任何有 `once('exit')` 的对象）可以让 kit 在它结束时立刻往下走；不返回时 kit 一直等到超时。不传 `spawn` 时行为不变。

在 utility process 里，`process.argv` 是 `[<Electron Helper>, <bin>, ...args]`，和 Node 的形状相同，所以 daemon 不需要包装脚本就能读到参数（在 Electron 42、44 和 45 上验证过）。

**应用退出时先让 daemon 停下。** Electron 会随应用结束 utility process，而且不发 daemon 能处理的信号：`daemon.json` 和 `daemon.lock` 留在 home 里，类型服务器做到哪儿就断在哪儿，`daemon.log` 里也没有任何记录。所以退出前先请 daemon 停止，并在有限的时间内等它结束：

```js
let daemon = null; // 在 `spawn` 里：daemon = child; child.once('exit', () => { daemon = null; });
let leaving = false;

app.on('before-quit', (event) => {
  if (leaving || !daemon) return; // 这个应用没有 fork daemon：别的应用的 daemon 已经在运行
  leaving = true;
  event.preventDefault();
  const timer = setTimeout(() => app.quit(), 8000); // daemon 最多等它的类型服务器 6 秒
  daemon.once('exit', () => {
    clearTimeout(timer);
    app.quit();
  });
  daemon.kill(); // 在 macOS 和 Linux 上是 SIGTERM
});
```

收到 `SIGTERM` 后，daemon 通过类型服务器自己的处理函数让它们停止并等它们结束，删除 `daemon.json` 和 `daemon.lock`，并在 `<home>/logs/daemon.log` 里写下 `daemon <version> stopped (SIGTERM)`；通常几毫秒内就结束，类型服务器收尾慢时最多 6 秒。只停止你的应用自己 fork 的 daemon：别的应用的 daemon 已经在运行时，`spawn` 根本不会被调用，也就没有要停的东西。在 Windows 上 `kill()` 会立刻结束进程，和直接退出一样。留下的文件会被下一个启动的 daemon 替换，除非 `daemon.lock` 里写的进程号现在属于另一个正在运行的进程：这时那个 daemon 会拒绝启动，直到锁文件被删除。[`examples/harness-electron`](../../examples/harness-electron/src/daemon-spawn.mjs) 就是这样做的（`stopDaemonUtilityProcess`；在 macOS 的 Electron 42 上分别验证过有、没有这一步的情况）。

**类型服务器。** daemon 以子进程方式、用它自己的可执行文件启动内置类型的服务器。daemon 运行在 Electron 进程里时，这个可执行文件是 Electron helper 或你的应用，不能当作 Node 启动，所以 daemon 改为在自己进程的 worker thread 里运行它们。它根据自己是怎样运行的来决定，不启动任何东西：

- daemon 环境里的 `OPEN_ARTIFACT_NODE_CHILDREN=process|threads` 优先（上面的示例在传给 `fork` 的 `env` 里设为 `threads`，明确说出来）；
- 在普通 Node 下用子进程；
- 在以 Node 方式运行的 Electron 下（`ELECTRON_RUN_AS_NODE` 生效，没有 `process.type`）用子进程；
- 在 Electron 进程里（设置了 `process.type`，比如 utility process）用 thread。fuse 打开、在 utility process 里启动 daemon、又想要子进程的应用，设置 `OPEN_ARTIFACT_NODE_CHILDREN=process`。

环境里有没有 `ELECTRON_RUN_AS_NODE` 不起决定作用：关了 fuse 的应用可能设了它，但它不生效。

`open-artifact doctor` 会显示这个选择（“Type server processes”），`GET /__open-artifact/health` 以 `nodeChildren` 返回它，daemon 日志里也会写一次。服务器命令不是 `node` 的第三方类型仍以子进程运行。

thread 模式的限制：

- 类型服务器和 daemon 共用内存：没有内存隔离，一个服务器内存耗尽会连带 daemon。每个 thread 各自加载 WebAssembly，所以 daemon 比单个进程占用更多内存。
- daemon 随你的应用结束，因为 utility process 不会比应用活得更久；退出前先请它停止（见上文），否则它的状态文件会留下。下一个连接的应用会再启动它。
- 需要用更新的运行时替换正在运行的 daemon 时，daemon 会停下，把启动交给你应用里的 kit，由它在下次连接时启动；daemon 不会去启动你应用的另一个副本。
- 停止时会请服务器结束（运行它的 `SIGTERM` 处理函数）；到时没有结束的会被强制终止，它的 `exit` 处理函数不会运行。
- thread 里的服务器自己启动的进程（比如连接器的 stdio MCP 服务器）由该服务器的 `exit` 处理函数停止。服务器被强制终止或 daemon 进程意外死掉时，这个处理函数不会运行：这些进程收不到信号，要等它们的 stdin 关闭才结束，stdio MCP 服务器就是这样做的。
- 服务器里的 `process.cwd()` 返回它的类型目录，但操作系统的工作目录仍是 daemon 的，所以直接交给原生代码的相对路径会相对 daemon 的目录解析。

## 更新

| 策略 | daemon 的做法 |
| --- | --- |
| `prompt`（默认） | 每天最多检查一次注册表，并通知已订阅的适配器（`runtime/update` 事件）；在有人同意之前什么都不下载 |
| `auto` | 还会在后台下载 |
| `bundled` | 从不检查；只用这台电脑上已有的运行时 |

生效的策略按以下顺序，第一个匹配的为准：

1. **机器。** `OPEN_ARTIFACT_RUNTIME_UPDATE=off`，或一个内容为 `{"runtimeUpdate": "off"}` 的机器策略文件（`$OPEN_ARTIFACT_MACHINE_POLICY`，否则 `/Library/Application Support/Open Artifact/policy.json`、`/etc/open-artifact/policy.json`、`%ProgramData%\Open Artifact\policy.json`），会关闭检查和更新。
2. **人。** `settings.json` 的 `runtime.update`，用 `open-artifact runtime policy auto|prompt|bundled` 设置（`default` 删除它）。
3. **适配器。** 已登记运行时里最保守的 `update`；说 `bundled` 的适配器弃权，除非所有适配器都说 `bundled`。
4. `prompt`。

不带参数的 `open-artifact runtime policy` 打印生效的策略及其来源。

### 在你的应用里同意更新

```js
oa.on('event', (event) => {
  if (event.type === 'runtime/update' && event.available) offerUpdate(event.available);
});
// when the person agrees:
const { installed, pending, message } = await oa.runtime.update();   // or update('0.14.6')
const status = await oa.runtime.status();
```

`oa.runtime.status()` 的回答和 `open-artifact runtime status --json` 打印的一样：正在运行的版本、将会启动的那份、这里的每个运行时、策略及其来源、版本锁定、注册表、上次检查结果和待切换的版本。`oa.runtime.update(version?)` 安装最新的兼容运行时，或指定版本；人选了 `bundled` 或机器关闭了更新时，它会以 `not_granted` 拒绝。daemon 没列出功能 `runtime.update` 时，两者都抛出 `unsupported`（修复提示：`Update the Open Artifact runtime this computer runs.`）。

### 更新怎么校验

- 来源是 npm 注册表上的 `@open-artifact/cli`：`$OPEN_ARTIFACT_REGISTRY`，否则 `settings.json` 的 `runtime.registry`，否则通常的 npm 配置，否则 `registry.npmjs.org`。只有回环地址上的注册表可以用明文 `http`。
- 检查时不发送凭据、cookie，也不发送任何关于人或其作品的信息。它选择最新的、非预发布、未弃用、在锁定范围内、能在这个 Node 上运行、并且兼容最近见过的每个适配器的 Harness API 的版本。
- 压缩包的 sha512 必须与注册表的 `dist.integrity` 一致，否则拒绝。注册表的来源证明（provenance attestation）会被记录并由 `runtime status` 显示，**但不做校验**。
- 压缩包最大 256 MiB，解压后最大 1 GiB。保留三份共享运行时。
- daemon 在空闲时（没有打开的页面，没有正在运行的工具调用或长操作）切换到新运行时，或在下次启动时切换。更新记录写到 `<home>/logs/daemon.log`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `open-artifact runtime status [--json] [--check]` | 这里的运行时和将会启动的那份；`--check` 立即查询注册表 |
| `open-artifact runtime update [--version <x.y.z>]` | 安装最新的兼容运行时，或指定版本 |
| `open-artifact runtime pin <range> \| --clear` | 把运行时限制在一个版本范围内 |
| `open-artifact runtime policy [auto\|prompt\|bundled\|default] [--json]` | 打印或设置人的策略 |

`update`、`pin` 和 `policy` 由人决定：在 Agent 会话里运行会被拒绝。

## 新版本写过的作品

两个应用可能带着不同的运行时，人可能在旧运行时上打开一个被新版本类型写过的作品。这时工具会把它当作只读（[Agent 工具](tools.zh-CN.md#新版本写过的作品)）。

## 单文件可执行程序

对于既没有 Node 也没有 Electron 的应用，`open-artifact-<platform>-<arch>`（Windows 上是 `.exe`）就是内含运行时的 Node。它的命令行和 `open-artifact` 相同，所以你的应用随附它，运行 `open-artifact-darwin-arm64 harness --stdio --harness my-agent` 即可（[非 JavaScript 应用](non-node.zh-CN.md)）。

第一次使用时，它把运行时解压到共享目录 `<home>/runtime/<version>/`，像更新一样按 sha512 校验，然后从那里运行。这个目录是普通的共享运行时：电脑上更新的运行时仍可能被选中启动，由这个可执行程序的 Node 运行。它启动的 daemon 和类型服务器也运行在这个可执行程序上，所以电脑上不需要 `node`。

daemon 交给 Agent 的命令（skill 文本和工具回答里的）以这个可执行程序的路径开头，而不是 `node`，路径有空格或 shell 特殊字符时加引号（在 Windows 上因为有反斜杠，总是加引号）；`open-artifact doctor` 显示 `Node.js <version> (inside the single-file executable <path>)`。有两个限制：

- 在 PowerShell 里，带引号的程序路径必须用 `&` 调用（`& "C:\Program Files\My Agent\open-artifact-win32-x64.exe" …`）。daemon 的文本不会加 `&`，所以在 PowerShell 里运行这类命令的 Agent 得自己加。
- 这个可执行程序只在 macOS arm64 上构建和测试过。其他平台用同一个脚本构建，但没有测试过。

它还没有发布：请在你要发布的每个平台上自己构建。

```text
npm run build
node scripts/build-skill.mjs
node scripts/build.mjs --only sea      # dist/sea/open-artifact-<platform>-<arch>
```

构建它的 Node 就是它里面的 Node：nodejs.org 的官方构建，Node 25.5 或更高版本（用 `--node <path>` 或 `OPEN_ARTIFACT_SEA_NODE` 指定）。不带单文件可执行程序支持构建的 Node（例如 Homebrew 的）不能用。在 macOS 上，结果是临时签名（ad hoc）的；发布前请用你自己的身份签名。
