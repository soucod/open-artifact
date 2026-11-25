/**
 * A stand-in for the app's own agent: a chat session with a transcript and a tool registry. A real app has a model
 * loop here; the example only needs somewhere to register tools, run them and put messages.
 */
export class ScriptedAgent {
  /** `id` and `workspace` name the session to the daemon; `print` shows each transcript line. */
  constructor({ id, workspace, title = 'Chat', print = () => undefined }) {
    this.id = id;
    this.workspace = workspace;
    this.title = title;
    this.print = print;
    /** `{ role, text }`: `user` (the person, or an owner wake), `notice` (an outside event), `tool`, `assistant`. */
    this.transcript = [];
    /** Tool name → `{ description, inputSchema, run(args) }`. */
    this.tools = new Map();
    this.status = 'idle';
  }

  register(name, tool) {
    this.tools.set(name, tool);
  }

  unregister(name) {
    this.tools.delete(name);
  }

  add(role, text) {
    this.transcript.push({ role, text });
    this.print(`[${this.id}] ${role}: ${text}`);
  }

  /** Runs one tool the way a model's tool call would, and records its result. */
  async runTool(name, args) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const result = await tool.run(args);
    this.add('tool', `${name}(${args.action ?? ''}) → ${result.error ? `error ${result.error.code}: ${result.error.message}` : 'ok'}`);
    return result;
  }
}
