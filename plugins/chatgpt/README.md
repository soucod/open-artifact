# Open Artifact for ChatGPT

**ChatGPT desktop** can install the Codex plugin from its Plugins tab. Follow the [Codex installation and upgrade guide](../codex/README.md).

**ChatGPT on the web** uses a connector that runs on your computer behind an HTTPS tunnel. With Node.js 22.18+
installed, download `open-artifact-plugins.zip` from [GitHub Releases](https://github.com/JimLiu/open-artifact/releases),
extract it and run the connector.

```bash
node "/path/to/open-artifact-plugins/chatgpt/skills/open-artifact/scripts/open-artifact.mjs" chatgpt --workspace ~/Documents
```

It prints a local address with a secret path, `http://127.0.0.1:4891/mcp/<secret>`. Then:

1. Expose port 4891 over HTTPS: OpenAI's Secure MCP Tunnel, or `cloudflared tunnel --url http://127.0.0.1:4891`.
2. In ChatGPT (chatgpt.com/plugins), add a custom MCP server: the tunnel's `https://…` address followed by
   `/mcp/<secret>`, with no authentication.
3. In a chat, pick it and ask for a deck, a design, a board, a spreadsheet, a dashboard, a doc or a short animation.

The secret path is the only key: anyone who has it can make and change artifacts under the workspace. Keep it to
yourself; `--rotate` makes a new one. New artifacts go in `<workspace>/artifacts/`.

To upgrade, stop the connector, replace the extracted folder with the one from the new ZIP and run the same
command again.

## What it adds to the daemon's tools

- **`ShowArtifact {url}`** shows the artifact as a card in the conversation, with **Open** (the page) and **Send
  comments to ChatGPT**, which posts a message asking ChatGPT to read and handle the comments. ChatGPT cannot be woken
  from outside a conversation, so this button is how "Send to agent" reaches it; comments also arrive in the result of
  ChatGPT's next Open Artifact call.
- A note in the instructions: ChatGPT has no file tools on your computer, so it writes and reads the artifact's files
  through `Artifact` (`publish` with `files`, `read` with `path`).

The page itself opens at `http://127.0.0.1:<port>/a/<id>`, so it opens on the computer running the connector.
