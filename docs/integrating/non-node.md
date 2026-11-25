# Apps not written in JavaScript

[中文](non-node.zh-CN.md)

After reading this you can connect an app written in Python, Go, Rust, Swift or anything else, with no JavaScript of
your own: spawn one process and speak JSON lines over its stdin and stdout.

## Three ways in

| Way | You need | Use when |
| --- | --- | --- |
| **stdio bridge** | to spawn `open-artifact harness --stdio --harness <name>` | almost always: no token, no WebSocket, reconnects for you |
| WebSocket | a WebSocket client; read `<home>/daemon.json` for the port and token | you already have a WebSocket stack and want no child process |
| HTTP polling | an HTTP client | you cannot keep a connection open ([Harness API](../spec/harness-api.md#http-polling)); no events, no `host.open` |

All three carry the same methods ([Harness API](../spec/harness-api.md)).

The bridge needs Node 22.18 or later on the computer to run `open-artifact`, or the single executable, which carries
its own Node and which you build and ship with your app ([runtime](runtime.md#a-single-executable)). Inside the
executable, the commands the daemon tells your agent to run start with the executable's path instead of `node`, and
`open-artifact doctor` names the executable on its Node.js line. In PowerShell such a quoted path must be called with
`&`, which the daemon's text does not add. The executable has been built and tested on macOS arm64 only.

## The stdio bridge

```text
open-artifact harness --stdio --harness my-agent
```

It starts the daemon if none runs, says `hello` for you with the token from `daemon.json` (the token never crosses
stdio), reconnects when the daemon restarts, and attaches your sessions again. It ends when its stdin ends; the daemon
keeps running.

### Framing

- One JSON-RPC 2.0 object per line, UTF-8, ended by `\n` (a `\r` before it is ignored). Blank lines are skipped.
- No batches (arrays).
- A line that is not JSON is answered with `id: null` and code `-32700`. A line over 64 MiB ends the bridge.
- stdout carries only protocol. stderr carries the bridge's log: read it or drop it, but do not let the pipe fill.

### The conversation

1. **You send `hello` first**, without a token. `harness`, when given, must equal `--harness`. A second `hello` gets
   `conflict`. Anything before it gets `unauthorized`.
2. **You call methods** with ids of your own (strings or numbers): `session.attach`, `tools.list`, `tools.call`,
   `subscribe`, ….
3. **The bridge calls you** with ids `d1`, `d2`, …: `wake.deliver` when your caps have `wake`, `host.open` and
   `shell.event` when they have `open`. Without those caps you get none of these calls. Answer each with the same id,
   within 30 seconds, or the daemon counts it failed.
4. **Notifications** have no id: `event` (only after `subscribe {"on": true}`), and the bridge's own `bridge.state
   {state: "connected" | "disconnected"}` and `bridge.reattached {params, inbox}` (a session attached again after a
   reconnect, with what waited for it).

```text
→ {"jsonrpc":"2.0","id":1,"method":"hello","params":{"harness":"my-agent","caps":{"agentName":"My Agent","tools":"native","wake":{}}}}
← {"jsonrpc":"2.0","method":"bridge.state","params":{"state":"connected"}}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":1,"daemon":"0.14.6","connection":"…","features":[…]}}
→ {"jsonrpc":"2.0","id":2,"method":"session.attach","params":{"session":"chat-1","workspace":"/home/me/project"}}
← {"jsonrpc":"2.0","id":2,"result":{"key":"…","inbox":[]}}
← {"jsonrpc":"2.0","id":"d1","method":"wake.deliver","params":{"session":"chat-1","text":"[Artifact comment sent to agent]…","source":{…}}}
→ {"jsonrpc":"2.0","id":"d1","result":{"status":"delivered"}}
```

If you name no `runtime` in `hello`, the bridge registers the runtime it runs from.

### A Python sketch

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

The sketch shows no pages and declares `wake` but not `open`, so the bridge sends it no `host.open` or `shell.event`.
The two answers in `read()` are where they go once you add `open`: `{"opened": false}` makes the daemon fall back to
the browser or the link.

## The WebSocket directly

Read `<home>/daemon.json` (`port`, `token`; the file is readable only by the person), connect to
`ws://127.0.0.1:<port>/__harness` with the subprotocol `open-artifact-harness`, and send `hello` with the `token`.
Everything else is the same as over stdio, without the `bridge.*` notifications: reconnecting and attaching your
sessions again is your job.

## Your agent's tools

You give your agent `Artifact`, `ArtifactData` and `ArtifactComments` from `tools.list` (each has a JSON Schema), and run
them with `tools.call`, always with a `caller`. The skill text the agent needs comes from `skill.get`
([commands and the skill](../integrating.md#commands-and-the-skill)).

## See also

- [`examples/harness-stdio`](../../examples/harness-stdio/README.md): a complete host in Python, tested against a real daemon
- [Harness API reference](../spec/harness-api.md)
- [Wake](wake.md), [tools](tools.md), [testing](testing.md)
