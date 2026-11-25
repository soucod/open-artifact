"""What this host does when the daemon calls it, and what it does with the bridge's notifications.

A real host gives a wake to its agent (a new turn for the owner, a notice for anyone else), shows `host.open`'s page
in its own window, and keeps its sessions across reconnects. This one prints a line for each, so a test (or a person)
can follow along:

    state connected | state disconnected
    reattached <session> inbox=<n>
    open <url> view=<address> [remote=<type>]
    wake <turn|notice> <reason> from <kind> on "<title>"
    shell <type>
    event <type> <artifact id>
"""

import threading


def say(*words):
    print(*words, flush=True)


class Host:
    def __init__(self, sessions):
        # session id -> workspace, for the sessions this host attached
        self.sessions = sessions
        self.connected = threading.Event()
        self.woken = threading.Event()
        self.reattached = threading.Event()

    # ---- the daemon's calls (answered) ----

    def wake_deliver(self, params):
        """`wake.deliver`: a message for one session. The owner's own request is a turn; anything else a notice."""
        if params.get("session") not in self.sessions:
            return {"status": "failed"}
        self.take_wake(params)
        # The agent here is idle and takes it at once; a busy one would queue it and still answer "delivered".
        return {"status": "delivered"}

    def take_wake(self, payload):
        source = payload.get("source") or {}
        sender = (source.get("from") or {}).get("kind", "owner")
        route = "turn" if sender == "owner" else "notice"
        say("wake %s %s from %s on \"%s\"" % (route, source.get("reason", "?"), sender, source.get("title", "")))

    def host_open(self, params):
        """`host.open`: show the artifact's page. A host with a top-level view loads `embed_url` (it carries a
        one-time ticket); one that frames the Shell loads `view_url`. A remote type's page comes from `remote.origins`,
        which a careful host lets in only after the person says yes."""
        remote = params.get("remote")
        say("open %s view=%s%s" % (params.get("url"), params.get("embed_url") or params.get("view_url"), " remote=%s" % remote["type"] if remote else ""))
        return {"opened": True}

    def shell_event(self, params):
        """`shell.event`: the Shell in a top-level view this host opened said something (a ready, a summon, ...)."""
        say("shell %s" % (params.get("event") or {}).get("type", "?"))
        return {"ok": True}

    def handlers(self):
        return {"wake.deliver": self.wake_deliver, "host.open": self.host_open, "shell.event": self.shell_event}

    # ---- the bridge's notifications ----

    def notify(self, method, params):
        if method == "bridge.state":
            say("state %s" % params.get("state"))
            (self.connected.set if params.get("state") == "connected" else self.connected.clear)()
        elif method == "bridge.reattached":
            # The daemon came back (the bridge started it again) and the bridge attached the session again; what
            # waited for it meanwhile comes along, to give to the agent like a wake.
            inbox = params.get("inbox") or []
            say("reattached %s inbox=%d" % ((params.get("params") or {}).get("session"), len(inbox)))
            for message in inbox:
                self.take_wake(message)
            self.reattached.set()
        elif method == "event":
            say("event %s %s" % (params.get("type"), params.get("id", "")))
