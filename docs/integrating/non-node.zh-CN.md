# 非 JavaScript 应用

[English](non-node.md)

读完后你能接入用 Python、Go、Rust、Swift 或其他任何语言写的应用，自己不写一行 JavaScript：启动一个进程，在它的 stdin 和 stdout 上收发 JSON 行。

## 三种接入方式

| 方式 | 你需要 | 适用于 |
| --- | --- | --- |
| **stdio 桥** | 启动 `open-artifact harness --stdio --harness <name>` | 几乎所有情况：不用令牌，不用 WebSocket，自动重连 |
| WebSocket | 一个 WebSocket 客户端；从 `<home>/daemon.json` 读端口和令牌 | 你已经有 WebSocket 栈，不想要子进程 |
| HTTP 轮询 | 一个 HTTP 客户端 | 你无法保持连接（[Harness API](../spec/harness-api.zh-CN.md#http-轮询)）；没有事件，没有 `host.open` |

三种方式承载同样的方法（[Harness API](../spec/harness-api.zh-CN.md)）。

桥需要电脑上装有 Node 22.18 或更高版本来运行 `open-artifact`，或者使用自带 Node、由你构建并随应用发布的单文件可执行程序（[运行时](runtime.zh-CN.md#单文件可执行程序)）。在可执行程序里，daemon 让 Agent 运行的命令以可执行程序的路径开头，而不是 `node`；`open-artifact doctor` 的 Node.js 那一行会写明这个可执行程序。在 PowerShell 里，这种带引号的路径必须用 `&` 调用，而 daemon 的文本不会加 `&`。这个可执行程序只在 macOS arm64 上构建和测试过。

## stdio 桥

```text
open-artifact harness --stdio --harness my-agent
```

没有 daemon 在运行时它会启动一个，用 `daemon.json` 里的令牌替你发 `hello`（令牌从不经过 stdio），daemon 重启后自动重连，并重新挂上你的会话。它的 stdin 结束时它就退出；daemon 继续运行。

### 分帧

- 每行一个 JSON-RPC 2.0 对象，UTF-8，以 `\n` 结尾（之前的 `\r` 会被忽略）。空行跳过。
- 不支持批量（数组）。
- 不是 JSON 的行会收到 `id: null`、代码 `-32700` 的回答。超过 64 MiB 的行会让桥退出。
- stdout 只承载协议。stderr 承载桥的日志：读掉或丢弃都行，但别让管道堵满。

### 对话过程

1. **你先发 `hello`**，不带令牌。给出 `harness` 时必须和 `--harness` 一致。第二次 `hello` 得到 `conflict`。在它之前的任何请求得到 `unauthorized`。
2. **你调用方法**，用你自己的 id（字符串或数字）：`session.attach`、`tools.list`、`tools.call`、`subscribe`……
3. **桥调用你**，id 是 `d1`、`d2`……：你的 caps 有 `wake` 时是 `wake.deliver`，有 `open` 时是 `host.open` 和 `shell.event`。没有这些 caps 就收不到这些调用。用同样的 id 在 30 秒内回答每一个，否则 daemon 算作失败。
4. **通知**没有 id：`event`（只在 `subscribe {"on": true}` 之后），以及桥自己的 `bridge.state {state: "connected" | "disconnected"}` 和 `bridge.reattached {params, inbox}`（重连后重新挂上的会话，以及这期间为它攒下的消息）。

```text
→ {"jsonrpc":"2.0","id":1,"method":"hello","params":{"harness":"my-agent","caps":{"agentName":"My Agent","tools":"native","wake":{}}}}
← {"jsonrpc":"2.0","method":"bridge.state","params":{"state":"connected"}}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":1,"daemon":"0.14.6","connection":"…","features":[…]}}
→ {"jsonrpc":"2.0","id":2,"method":"session.attach","params":{"session":"chat-1","workspace":"/home/me/project"}}
← {"jsonrpc":"2.0","id":2,"result":{"key":"…","inbox":[]}}
← {"jsonrpc":"2.0","id":"d1","method":"wake.deliver","params":{"session":"chat-1","text":"[Artifact comment sent to agent]…","source":{…}}}
→ {"jsonrpc":"2.0","id":"d1","result":{"status":"delivered"}}
```

如果你在 `hello` 里没有指明 `runtime`，桥会登记它自己所在的运行时。

### Python 示例

```python
import json, subprocess, threading

bridge = subprocess.Popen(
    ["open-artifact", "harness", "--stdio", "--harness", "my-agent"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
pending, next_id = {}, 0

def send(message):
    bridge.stdin.write(json.dumps(message) + "\n")
    bridge.stdin.flush()

def call(method, params):
    global next_id
    next_id += 1
    done = threading.Event()
    pending[next_id] = [done, None]
    send({"jsonrpc": "2.0", "id": next_id, "method": method, "params": params})
    done.wait()
    reply = pending.pop(next_id)[1]
    if "error" in reply:
        raise RuntimeError(reply["error"]["data"]["fix"] if reply["error"].get("data") else reply["error"]["message"])
    return reply["result"]

def on_wake(params):
    # Only the owner's words become a user turn; anything else is a notice.
    owner = params.get("source", {}).get("from", {}).get("kind") == "owner"
    print(("turn: " if owner else "notice: ") + params["text"].splitlines()[0])
    return {"status": "delivered"}

def read():
    for line in bridge.stdout:
        message = json.loads(line)
        if "method" in message and "id" in message:          # the bridge calls us
            method = message["method"]
            result = on_wake(message["params"]) if method == "wake.deliver" else {"opened": False} if method == "host.open" else {"ok": True}
            send({"jsonrpc": "2.0", "id": message["id"], "result": result})
        elif "id" in message and message["id"] in pending:    # an answer to our call
            pending[message["id"]][1] = message
            pending[message["id"]][0].set()

threading.Thread(target=read, daemon=True).start()
hello = call("hello", {"harness": "my-agent", "caps": {"agentName": "My Agent", "tools": "native", "wake": {}}})
call("session.attach", {"session": "chat-1", "workspace": "/tmp/demo"})
tools = call("tools.list", {})["tools"]
result = call("tools.call", {"name": "Artifact", "arguments": {"action": "quickstart", "intent": "slides"},
                             "caller": {"session": "chat-1", "workspace": "/tmp/demo"}})
```

这个示例不显示页面，只声明了 `wake`、没有声明 `open`，所以桥不会给它发 `host.open` 或 `shell.event`。`read()` 里的这两个回答是给你加上 `open` 之后用的：`{"opened": false}` 让 daemon 退回到浏览器或链接。

## 直接用 WebSocket

读 `<home>/daemon.json`（`port`、`token`；只有本人能读这个文件），用子协议 `open-artifact-harness` 连接 `ws://127.0.0.1:<port>/__harness`，然后带 `token` 发 `hello`。其余和 stdio 相同，只是没有 `bridge.*` 通知：重连和重新挂上会话要你自己做。

## 你的 Agent 的工具

把 `tools.list` 里的 `Artifact`、`ArtifactData` 和 `ArtifactComments` 交给你的 Agent（每个都有 JSON Schema），用 `tools.call` 运行它们，并始终带上 `caller`。Agent 需要的 skill 文本来自 `skill.get`（[命令与 skill](../integrating.zh-CN.md#命令与-skill)）。

## 另见

- [`examples/harness-stdio`](../../examples/harness-stdio/README.md)：一个完整的 Python 宿主，对着真实 daemon 测试过
- [Harness API 参考](../spec/harness-api.zh-CN.md)
- [唤醒](wake.zh-CN.md)、[Agent 工具](tools.zh-CN.md)、[测试](testing.zh-CN.md)
