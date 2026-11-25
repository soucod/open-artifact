# Examples

Runnable code for the two ways people extend Open Artifact: agent apps that integrate it, and plugins for a self-hosted
site.

| Folder | What it is | Tested |
| --- | --- | --- |
| [`harness-node/`](harness-node/README.md) | The smallest complete agent app on `@open-artifact/harness-kit`: one chat session, no window. Connect, attach, register tools, install the skill, make an artifact, take wakes. | yes: `node --test examples/harness-node/harness-node.test.mjs` runs it against a real daemon (part of `npm test`) |
| [`harness-electron/`](harness-electron/README.md) | An Electron app that shows artifact pages in a top-level `WebContentsView` beside the chat, using the modules of `harness-node`. | no: written and bundled, never started in Electron |
| [`harness-stdio/`](harness-stdio/README.md) | A host in Python (standard library only) over `open-artifact harness --stdio`: hello, attach, tools, publish, and answering wakes and `host.open`. | yes: `node --test examples/harness-stdio/harness-stdio.test.mjs` runs it against a real daemon (part of `npm test`; skipped without `python3`) |
| [`host-plugins/`](host-plugins/README.md) | Six plugins for an Open Artifact host (sign-in, roles, invitations, webhooks). | yes: their own tests and `packages/host-plugin` |

For other languages, [docs/integrating/non-node.md](../docs/integrating/non-node.md) explains the stdio bridge that
`harness-stdio/` uses.

The guide that ties the agent-app examples together is [docs/integrating.md](../docs/integrating.md).
