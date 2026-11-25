# Known limits

[中文](limits.zh-CN.md)

After reading this you know what does not work yet, what was not tested, and what to do meanwhile. Each item says where
it shows.

## Pages

| Limit | Meanwhile |
| --- | --- |
| A Shell served by a site (a published artifact opened at its site address) cannot read the daemon's declared origins, so it treats every host as undeclared: `new_session` comes with an empty prompt, `comment_summon` with empty text, and there is no `open_external`, `saved_file` or destinations. | Embed the local view URL (`viewUrl`), not the site address. |
| A page loaded from `file://` has the origin `null` and cannot be declared. | Serve your UI from a custom scheme, or use a top-level view. |
| An artifact a newer type release wrote is read-only on this computer, including the page's comment box. | The page and the tools' `newer_release` error tell the person to update; the agent's tools may still reply to comments. |

## Examples

| Limit | Meanwhile |
| --- | --- |
| `examples/harness-electron` was written against Electron's APIs but not run in Electron. Its shared modules are tested through `examples/harness-node`. | Treat it as a reference for the webview checklist, and test your own app. |

## Runtime

| Limit | Meanwhile |
| --- | --- |
| Update provenance attestations are recorded, not verified. The tarball is verified against the registry's sha512 digest. | Use `bundled` and ship runtimes with your app when you need more. |
| The single executable for apps with no Node is not published; each app builds its own, on each platform, with an official Node 25.5 or later. | Build it with `node scripts/build.mjs --only sea`, or require Node 22.18 or later on the computer. |
| In PowerShell, a command the single executable's daemon gives the agent starts with a quoted program path, which must be called with `&`; the daemon's text does not add it. | Have the agent add `&`, or run the command in another shell. |
| The single executable has been built and tested on macOS arm64 only. | Test it on every platform you ship before you rely on it. |

## Wakes

| Limit | Meanwhile |
| --- | --- |
| On Windows a nudge runs only an `.exe`; a `.cmd` or `.bat` is skipped and logged, because Node runs those only through a shell. | Point the nudge at the `.exe`, or rely on the inbox and hooks. |
| HTTP polling adapters get no events and cannot show pages. | Use the WebSocket or the stdio bridge. |
| An artifact with no owner (made by a call with no caller) has its wakes in a shared inbox. | Always pass a caller. |

## Checking

| Limit | Meanwhile |
| --- | --- |
| The conformance run (`doctor --session`) cannot see what needs a person or a real browser: it says `n/a` for those parts. | Click through the page once yourself ([testing](testing.md#a-conformance-run)). |
| The `harness-compat` end-to-end suite does not yet run against earlier releases of the kit: the kit is not published. | Run your tests against the oldest daemon version you support. |

## DeepSeek Harness (DSH)

The DSH plugin is a level-3 integration. For want of a DSH API, three things are not wired: cards of the artifacts a turn
made, the person's selection on the page as context, and `agent.wrote` for files DSH's own tools write.

## Security

Session permissions and person-only commands keep an honest agent on its path; they do not stop code that runs as the
person ([security](security.md#what-it-does-not-do)).

A restricted type's page (installed, or in a project not trusted yet) cannot reach another origin from its frame, but
it can still put text before the agent through the paths every page has: a comment sent to the agent
(`comments.sendToAgent`), a message to the agent's session (`room.sendToAgentSession`, `/api/frame/agent`) and a
title it proposes (`proposeTitle`). Those reach the agent as the page's, never as the person's words, and what the
agent reads back from such an artifact carries a page-content `third_party_notice` ([security](security.md#type-packages)).
The page's address opened on its own in a tab has the page's policy but not its frame's sandbox.
