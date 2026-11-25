#!/usr/bin/env python3
"""A host in Python that reaches Open Artifact through `open-artifact harness --stdio` (standard library only,
Python 3.9 or later).

    python3 main.py [--harness example-stdio] [--workspace DIR] [--session ID] [--type TYPE] [--cli "open-artifact"] [--once]

It spawns the bridge, says hello, attaches one session, lists the tools, makes an artifact with quickstart and
publish (which shows it through `host.open`), then answers the daemon until stopped: `wake.deliver` when the person
asks from the page, `host.open`, and the bridge's `bridge.state` / `bridge.reattached`. `--once` stops after the
first wake. Every step prints one line (see host.py); `ready <url>` says the artifact is made.
"""

import argparse
import os
import shlex
import subprocess
import sys

from host import Host, say
from rpc import Peer, RpcError

VERSION = "0.1.0"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--harness", default="example-stdio", help="the harness name this host speaks for")
    parser.add_argument("--workspace", default=os.getcwd(), help="the session's folder")
    parser.add_argument("--session", default="py-1", help="the session id")
    parser.add_argument("--type", default=None, help="the artifact type to make (default: what quickstart recommends for a note)")
    parser.add_argument("--cli", default=os.environ.get("OPEN_ARTIFACT_CLI", "open-artifact"), help="how to run open-artifact, e.g. \"npx @open-artifact/cli\"")
    parser.add_argument("--once", action="store_true", help="stop after the first wake")
    args = parser.parse_args()

    workspace = os.path.abspath(args.workspace)
    host = Host({args.session: workspace})
    bridge = subprocess.Popen(
        shlex.split(args.cli) + ["harness", "--stdio", "--harness", args.harness],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,  # the bridge's log; never protocol
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    answered = {}

    def on_answered(method, result):
        if method == "wake.deliver" and (result or {}).get("status") == "delivered":
            host.woken.set()

    peer = Peer(bridge, host.handlers(), host.notify, on_answered, log=lambda line: print(line, file=sys.stderr, flush=True))
    caller = {"session": args.session, "workspace": workspace}
    try:
        # hello carries no token: the bridge reads daemon.json itself. caps say which calls this host answers.
        hello = peer.request("hello", {
            "harness": args.harness,
            "caps": {"wake": {"resume": True}, "open": True, "tools": "native", "agentName": "Example", "library": "own"},
            "kit": {"name": "harness-stdio-example", "version": VERSION},
        })
        say("connected protocol=%s daemon=%s" % (hello["protocol"], hello["daemon"]))
        peer.request("subscribe", {"on": True})
        attached = peer.request("session.attach", {"session": args.session, "workspace": workspace, "title": "Python example"})
        say("attached %s inbox=%d" % (args.session, len(attached.get("inbox") or [])))

        tools = peer.request("tools.list")["tools"]
        say("tools %s" % ",".join(tool["name"] for tool in tools))

        def artifact(arguments):
            return peer.request("tools.call", {"name": "Artifact", "arguments": arguments, "caller": caller})

        quick = artifact({"action": "quickstart", "type": args.type} if args.type else {"action": "quickstart", "intent": "a short note"})
        if quick.get("error") or not quick.get("create"):
            raise SystemExit("quickstart: %s" % (quick.get("error") or {}).get("message", "no type fits"))
        create = dict(quick["create"], title="Hello from Python", open="now", folder=os.path.join(workspace, "hello-from-python"))
        made = artifact(create)
        if made.get("error"):
            raise SystemExit("publish: %s" % made["error"]["message"])
        say("ready %s" % made["url"])

        # Now the daemon calls us: wakes, opens, the bridge's own notices. Wait until done (or forever).
        while not peer.closed.is_set():
            if args.once and host.woken.wait(0.2):
                break
            if not args.once:
                peer.closed.wait(1.0)
        answered["ok"] = host.woken.is_set() or not args.once
    except RpcError as error:
        raise SystemExit("open-artifact: %s%s" % (error, "\n  %s" % error.fix if error.fix else ""))
    except KeyboardInterrupt:
        pass
    finally:
        peer.close()
        try:
            bridge.wait(timeout=10)
        except subprocess.TimeoutExpired:
            bridge.kill()
    return 0 if answered.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
