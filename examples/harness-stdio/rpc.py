"""JSON-RPC 2.0 with `open-artifact harness --stdio`: one JSON object per line, both ways.

The host sends requests (ids "h1", "h2", ...) and waits for their answers. The bridge sends its own requests
(`wake.deliver`, `host.open`, `shell.event`, with ids "d1", "d2", ...), which the host answers, and notifications
(`event`, `bridge.state`, `bridge.reattached`). Answers can arrive in any order, and a bridge request can arrive
while one of the host's own is still waiting (`host.open` during a `publish` with `open: "now"`), so a thread reads
stdout and each bridge request is answered on a thread of its own.
"""

import itertools
import json
import threading


class RpcError(Exception):
    """An error answer. `code` is Open Artifact's word for it (`not_granted`, `invalid_argument`, ...)."""

    def __init__(self, error):
        data = error.get("data") or {}
        super().__init__(data.get("message") or error.get("message") or "error")
        self.code = data.get("code") or str(error.get("code"))
        self.fix = data.get("fix")


class Peer:
    """Both ends of the conversation over a child process's stdin and stdout (text mode, UTF-8)."""

    def __init__(self, process, handlers, on_notify, on_answered=None, log=print):
        self._process = process
        self._handlers = handlers
        self._on_notify = on_notify
        self._on_answered = on_answered or (lambda method, result: None)
        self._log = log
        self._ids = itertools.count(1)
        self._pending = {}
        self._lock = threading.Lock()
        self._write = threading.Lock()
        self.closed = threading.Event()
        threading.Thread(target=self._read, daemon=True).start()

    def _send(self, message):
        line = json.dumps(dict(jsonrpc="2.0", **message), ensure_ascii=False, separators=(",", ":"))
        with self._write:
            self._process.stdin.write(line + "\n")
            self._process.stdin.flush()

    def request(self, method, params=None, timeout=60.0):
        """Sends a request and returns its result; raises RpcError on an error answer."""
        rid = "h%d" % next(self._ids)
        waiter = {"done": threading.Event()}
        with self._lock:
            self._pending[rid] = waiter
        self._send({"id": rid, "method": method, "params": params or {}})
        if not waiter["done"].wait(timeout):
            with self._lock:
                self._pending.pop(rid, None)
            raise TimeoutError("%s: no answer in %d s" % (method, timeout))
        if "error" in waiter:
            raise RpcError(waiter["error"])
        return waiter.get("result")

    def close(self):
        """Ends the bridge: it stops when its stdin ends (the daemon keeps running)."""
        try:
            self._process.stdin.close()
        except (BrokenPipeError, OSError):
            pass

    def _read(self):
        for line in self._process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError:
                self._log("not JSON from the bridge: %s" % line[:200])
                continue
            if "method" in message:
                if message.get("id") is not None:
                    threading.Thread(target=self._answer, args=(message,), daemon=True).start()
                else:
                    self._on_notify(message["method"], message.get("params") or {})
                continue
            with self._lock:
                waiter = self._pending.pop(str(message.get("id")), None)
            if waiter is None:
                if message.get("error"):
                    self._log("bridge error: %s" % message["error"].get("message"))
                continue
            if "error" in message:
                waiter["error"] = message["error"]
            else:
                waiter["result"] = message.get("result")
            waiter["done"].set()
        # stdout ended: the bridge is gone; nothing waiting will be answered.
        self.closed.set()
        with self._lock:
            for waiter in self._pending.values():
                waiter["error"] = {"code": -32000, "message": "the bridge ended", "data": {"code": "disconnected"}}
                waiter["done"].set()
            self._pending.clear()

    def _answer(self, message):
        method = message["method"]
        handler = self._handlers.get(method)
        try:
            if handler is None:
                raise LookupError("this host does not answer %s" % method)
            result = handler(message.get("params") or {})
            self._send({"id": message["id"], "result": result})
        except Exception as error:  # the bridge gets an error answer instead
            self._send({"id": message["id"], "error": {"code": -32000, "message": str(error), "data": {"code": "error", "message": str(error)}}})
            return
        self._on_answered(method, result)
