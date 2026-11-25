/**
 * Making types: `open-artifact types new | check | from` and the settings that turn a type off or trust a project's
 * types (`types enable | disable | trust | untrust`). The CLI runs `check` in its own process; the others go through
 * the daemon's `types.*` routes, so the daemon that serves the types writes them and sees the change at once.
 *
 * A new type is a frame type: `index.html` with an inline `// artifact.json` declaration, which frame-host serves,
 * `artifact-type.json`, `SKILL.md` and an `artifact-type/` folder for the page's own files.
 */

import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import {
  DECLARATION_LINE,
  DeclarationError,
  FRAME_BACKED_CAPABILITIES,
  FRAME_STUBBED_CAPABILITIES,
  OpenArtifactError,
  RESERVED_TYPE_IDS,
  TYPE_ID,
  TYPE_PACKAGE_LIMITS,
  TYPE_TEMPLATES,
  capabilitiesProblem,
  capabilityStatus,
  declarationSource,
  manifestShareProblems,
  nameFromTypeId,
  packageEntryProblems,
  readStaticDeclaration,
  renderDeclaration,
  type ArtifactRecord,
  type ArtifactTypeManifest,
  type AuthoringScope,
  type OpenArtifactSettings,
  type PackageEntry,
  type TypeCheckProblem,
  type TypeCheckResult,
  type TypeTemplate,
  type TypesFromCapabilities,
  type TypesFromResponse,
  type TypesNewResponse,
  type TypesSettingResponse,
} from '@open-artifact/protocol';
import { files, readJson } from './paths.ts';
import { saveSettings } from './settings.ts';
import { BUILTIN_TYPE_IDS, isPageType, readFrontmatter, readTypeFolder, type ListedType, type TypeRegistry } from './types.ts';

/** The id a new type may take: a type id in lower case, not a built-in one, not reserved. Throws `invalid_argument`. */
export function checkNewTypeId(id: unknown): string {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!TYPE_ID.test(value) || value !== value.toLowerCase()) {
    throw new OpenArtifactError('invalid_argument', `${JSON.stringify(id ?? '')} is not a type id: lower-case letters, digits, ".", "_" and "-", starting with a letter or digit, at most 64.`, {
      fix: 'For example: open-artifact types new trip-planner',
    });
  }
  if (BUILTIN_TYPE_IDS.includes(value)) throw new OpenArtifactError('conflict', `${value} is a built-in type's id: give the new type another one.`);
  if (RESERVED_TYPE_IDS.includes(value)) throw new OpenArtifactError('invalid_argument', `${value} is reserved: give the new type another id.`);
  return value;
}

/** The type root `types new` writes to for a scope. `project` is the project's folder (not its type root). */
export function authoringRoot(settings: OpenArtifactSettings, scope: AuthoringScope, project?: string | null): string {
  if (scope === 'user') return resolve(settings.typeRoots.user);
  if (!project) throw new OpenArtifactError('invalid_argument', 'A project type needs the project folder.');
  return resolve(project, settings.typeRoots.project);
}

const scopeOf = (value: unknown): AuthoringScope => {
  if (value === undefined || value === null || value === '' || value === 'user') return 'user';
  if (value === 'project') return 'project';
  throw new OpenArtifactError('invalid_argument', `scope: "user" (the default) or "project", not ${JSON.stringify(value)}.`);
};

const templateOf = (value: unknown): TypeTemplate => {
  if (value === undefined || value === null || value === '') return 'page';
  if ((TYPE_TEMPLATES as readonly string[]).includes(String(value))) return value as TypeTemplate;
  throw new OpenArtifactError('invalid_argument', `template: ${TYPE_TEMPLATES.map((t) => `"${t}"`).join(' or ')}, not ${JSON.stringify(value)}.`);
};

const nameOf = (value: unknown, id: string): string => {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return name || nameFromTypeId(id);
};

/** Makes the type folder; `conflict` when it is there already. */
function makeFolder(root: string, id: string): string {
  const dir = join(root, id);
  if (existsSync(dir)) throw new OpenArtifactError('conflict', `${dir} is there already: pick another id, or change that type.`);
  mkdirSync(root, { recursive: true });
  try {
    mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OpenArtifactError('conflict', `${dir} is there already.`);
    throw error;
  }
  return dir;
}

function writeAll(dir: string, written: Record<string, string>): string[] {
  for (const [rel, text] of Object.entries(written)) {
    const file = join(dir, rel);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return Object.keys(written).sort();
}

/** What the person can hand their agent to build a new type out. */
export function buildOutPrompt(name: string, id: string, dir: string): string {
  return [
    `Build out my Open Artifact type "${name}" (${id}), in ${dir}.`,
    'Read the guide to making types first (/open-artifact new-type).',
    'Then change index.html, SKILL.md and artifact-type.json so that it does this: <say what it is for>.',
    `When it is done, run \`open-artifact types check ${id}\` and fix what it reports.`,
  ].join(' ');
}

interface Options {
  settings: OpenArtifactSettings;
  registry: TypeRegistry;
  /** The CLI's working directory, or the home workspace: where a project type goes and which project types count. */
  workspace?: string | null;
}

/** `types new`: writes a starter type that works as it is and passes `types check`. */
export function newType(args: { id: unknown; scope?: unknown; template?: unknown; name?: unknown; project?: unknown }, o: Options): TypesNewResponse {
  const id = checkNewTypeId(args.id);
  const scope = scopeOf(args.scope);
  const template = templateOf(args.template);
  const name = nameOf(args.name, id);
  const project = typeof args.project === 'string' && args.project ? resolve(args.project) : (o.workspace ?? null);
  const dir = makeFolder(authoringRoot(o.settings, scope, project), id);
  const uid = randomUUID();
  try {
    const written = writeAll(dir, starterFiles({ id, uid, name, template }));
    const check = checkType(dir, { ...o, workspace: scope === 'project' ? project : o.workspace });
    return { id, uid, scope, dir, files: written, check, prompt: buildOutPrompt(name, id, dir) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

// ---- the starters ---------------------------------------------------------------------------------------------------

const TEMPLATE_TEXT: Record<TypeTemplate, { description: string; capabilities: Record<string, unknown> }> = {
  page: {
    description: "A page that shows the sections of content.json, in the artifact's folder: the agent writes them, the person edits them on the page.",
    capabilities: { artifact: {}, downloads: {} },
  },
  data: {
    description: "A checklist kept in the artifact's database, which the page and the agent share: people add, tick and remove items on the page.",
    capabilities: { db: {} },
  },
};

/** The files of a new type, by path. */
export function starterFiles(t: { id: string; uid: string; name: string; template: TypeTemplate }): Record<string, string> {
  const text = TEMPLATE_TEXT[t.template];
  const manifest: ArtifactTypeManifest & Record<string, unknown> = {
    slug: t.id,
    uid: t.uid,
    name: t.name,
    title: t.name,
    description: text.description,
    artifactTitle: `Untitled ${t.name.toLowerCase()}`,
    version: '0.1.0',
    skill: 'SKILL.md',
    intents: [t.id],
    when: `The person asks for a ${t.name.toLowerCase()}.`,
    engines: { openArtifact: '>=1' },
    ...(t.template === 'data' ? { openArtifact: { store: 'db' } } : {}),
  };
  const declaration = renderDeclaration({ key: t.id, capabilities: text.capabilities, monitoring: {} }, '    ');
  return {
    'artifact-type.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'index.html': t.template === 'data' ? dataPage(t.name, declaration) : contentPage(t.name, declaration),
    'SKILL.md': t.template === 'data' ? dataSkill(t, text.description) : contentSkill(t, text.description),
    'artifact-type/style.css': STYLE,
  };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pageHead = (name: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(name)}</title>
    <link rel="stylesheet" href="artifact-type/style.css" />
  </head>`;

function contentPage(name: string, declaration: string): string {
  return `${pageHead(name)}
  <body>
    <main>
      <h1 id="title" contenteditable="true" spellcheck="false"></h1>
      <div id="sections"></div>
      <p id="empty" class="muted" hidden>Nothing here yet. Ask the agent to write it, or add a section.</p>
      <div class="bar">
        <button id="add" type="button">Add a section</button>
        <button id="save" type="button">Save</button>
        <button id="download" type="button">Download</button>
        <span id="status" class="muted" role="status"></span>
      </div>
    </main>
    <script>
${declaration}

    // The content lives in content.json, in the artifact's folder: { title, sections: [{ heading, body }] }.
    (async function () {
      var oa = window.openArtifact;
      var self = await oa.use('artifact');
      var downloads = await oa.use('downloads');
      var $ = function (id) { return document.getElementById(id); };
      var content = { title: '', sections: [] };
      try {
        var res = await fetch('content.json', { cache: 'no-store' });
        if (res.ok) content = await res.json();
      } catch (e) {
        // no content yet
      }

      function section(s) {
        var box = document.createElement('section');
        var h = document.createElement('h2');
        h.contentEditable = 'true';
        h.textContent = s.heading || '';
        var p = document.createElement('p');
        p.contentEditable = 'true';
        p.textContent = s.body || '';
        box.append(h, p);
        return box;
      }

      function render() {
        $('title').textContent = content.title || document.title;
        $('sections').replaceChildren.apply($('sections'), (content.sections || []).map(section));
        $('empty').hidden = (content.sections || []).length > 0;
      }

      function read() {
        return {
          title: $('title').textContent.trim(),
          sections: Array.from($('sections').children).map(function (box) {
            return { heading: box.children[0].textContent.trim(), body: box.children[1].textContent.trim() };
          }),
        };
      }

      $('add').onclick = function () {
        content = read();
        content.sections.push({ heading: 'New section', body: '' });
        render();
      };
      $('save').onclick = async function () {
        content = read();
        $('status').textContent = 'Saving…';
        try {
          await self.publish({ 'content.json': JSON.stringify(content, null, 2) + '\\n' });
          $('status').textContent = 'Saved';
        } catch (e) {
          $('status').textContent = 'Not saved: ' + e.message;
        }
      };
      $('download').onclick = function () {
        downloads.save({ filename: 'content.json', data: JSON.stringify(read(), null, 2) });
      };
      render();
    })();
    </script>
  </body>
</html>
`;
}

function dataPage(name: string, declaration: string): string {
  return `${pageHead(name)}
  <body>
    <main>
      <h1>${esc(name)}</h1>
      <form id="add" class="bar">
        <input id="text" placeholder="Add an item" autocomplete="off" aria-label="New item" />
        <button type="submit">Add</button>
      </form>
      <ul id="items"></ul>
      <p id="empty" class="muted" hidden>No items yet.</p>
    </main>
    <script>
${declaration}

    // The items live in the artifact's database, in the collection "items": { text, done, at }.
    (async function () {
      var db = await window.openArtifact.use('db');
      var items = db.collection('items');
      var list = document.getElementById('items');

      items.orderBy('at').onSnapshot(function (snap) {
        list.replaceChildren.apply(list, snap.docs.map(function (d) {
          var item = d.data();
          var li = document.createElement('li');
          var box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = !!item.done;
          box.onchange = function () { db.doc('items/' + d.id).update({ done: box.checked }); };
          var label = document.createElement('span');
          label.textContent = item.text;
          var remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = 'Remove';
          remove.onclick = function () { db.doc('items/' + d.id).delete(); };
          li.append(box, label, remove);
          return li;
        }));
        document.getElementById('empty').hidden = snap.docs.length > 0;
      });

      document.getElementById('add').onsubmit = async function (event) {
        event.preventDefault();
        var input = document.getElementById('text');
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        await items.add({ text: text, done: false, at: Date.now() });
      };
    })();
    </script>
  </body>
</html>
`;
}

const STYLE = `:root {
  color-scheme: light dark;
  --fg: #1d1d1f;
  --muted: #6e6e73;
  --bg: #ffffff;
  --line: #d2d2d7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #f5f5f7;
    --muted: #a1a1a6;
    --bg: #1c1c1e;
    --line: #3a3a3c;
  }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, sans-serif;
}
main {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 16px;
}
.muted {
  color: var(--muted);
}
.bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 16px 0;
}
button,
input {
  font: inherit;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
}
input:not([type="checkbox"]) {
  flex: 1;
  min-width: 0;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
li span {
  flex: 1;
}
[contenteditable]:focus {
  outline: 2px solid var(--line);
  outline-offset: 2px;
}
`;

const frontmatter = (id: string, description: string): string => `---\nname: ${id}\ndescription: >-\n  ${description}\n---\n`;

function contentSkill(t: { id: string; name: string }, description: string): string {
  return `${frontmatter(t.id, `Make a ${t.name.toLowerCase()}: ${description}`)}
# ${t.name}

An artifact of this type is a folder, \`<root>\`. The page belongs to the type; the artifact's own content is one
file, \`<root>/content.json\`.

## Make one

1. **Create it**: \`Artifact {"action": "publish", "type_url": "open-artifact://type/${t.id}", "title": "…"}\`. The
   result gives the folder (\`root\`).
2. **Write \`<root>/content.json\`**, with your own file tools or \`Artifact {"action": "publish", "url": "<url>",
   "files": {"content.json": "…"}}\`:

   \`\`\`json
   { "title": "Trip to Lisbon", "sections": [{ "heading": "Day 1", "body": "Arrive, walk Alfama." }] }
   \`\`\`

3. **Read it again before you change it.** The person edits the title and sections on the page and saves them to the
   same file.
`;
}

function dataSkill(t: { id: string; name: string }, description: string): string {
  return `${frontmatter(t.id, `Make a ${t.name.toLowerCase()}: ${description}`)}
# ${t.name}

An artifact of this type keeps its items in its database, which the page and you share. Each item is a document in
the collection \`items\`: \`{ "text": "…", "done": false, "at": <milliseconds since 1970> }\`. The page lists them
by \`at\`.

## Make one

1. **Create it**: \`Artifact {"action": "publish", "type_url": "open-artifact://type/${t.id}", "title": "…"}\`.
2. **Add the items** with \`ArtifactData\`:

   \`\`\`json
   ArtifactData {"action": "set", "url": "<url>", "collection": "items", "doc_id": "first",
                 "data": {"text": "Book the flights", "done": false, "at": 1767225600000}}
   \`\`\`

   Use \`batch\` for more than a couple.
3. **Read before you change.** The person ticks and removes items on the page: \`ArtifactData {"action": "list",
   "url": "<url>", "collection": "items"}\` shows what is there now.
`;
}

// ---- types check ----------------------------------------------------------------------------------------------------

/**
 * `types check`: what is wrong with the type folder `dir` (errors) and what may be (warnings). With `forShare`, also
 * the rules for a type meant to be shared: fields, a relative entry, no links, no dotfiles, the size limits.
 */
export function checkType(dir: string, o: Options & { forShare?: boolean }): TypeCheckResult {
  const errors: TypeCheckProblem[] = [];
  const warnings: TypeCheckProblem[] = [];
  const add = (p: Omit<TypeCheckProblem, 'level'>, level: 'error' | 'warning'): void => {
    (level === 'error' ? errors : warnings).push({ level, ...p });
  };
  const id = basename(dir);
  const forShare = o.forShare === true;
  const out = (): TypeCheckResult => ({ ok: errors.length === 0, id, dir, forShare, errors, warnings, ...(caps ? { capabilities: caps } : {}) });
  let caps: TypeCheckResult['capabilities'];

  let st;
  try {
    st = statSync(dir);
  } catch {
    add({ code: 'not_found', message: `${dir} is not there.` }, 'error');
    return out();
  }
  if (!st.isDirectory()) {
    add({ code: 'not_found', message: `${dir} is not a folder.` }, 'error');
    return out();
  }

  // The id.
  const builtinRoot = o.registry.roots().find((r) => r.scope === 'builtin')?.root ?? null;
  const isBuiltin = builtinRoot !== null && resolve(dir) === resolve(builtinRoot, id);
  if (!TYPE_ID.test(id)) add({ code: 'id_invalid', message: `The folder name ${JSON.stringify(id)} is not a type id: letters, digits, ".", "_" and "-", at most 64.` }, 'error');
  else if (!isBuiltin && BUILTIN_TYPE_IDS.includes(id)) add({ code: 'id_builtin', message: `${id} is a built-in type's id: this type would hide it. Rename the folder.` }, 'error');
  else if (RESERVED_TYPE_IDS.includes(id)) add({ code: 'id_reserved', message: `${id} is reserved. Rename the folder.` }, 'error');

  // The manifest.
  const manifestFile = join(dir, 'artifact-type.json');
  let manifest: (ArtifactTypeManifest & Record<string, unknown>) | null = null;
  if (!existsSync(manifestFile)) {
    add({ code: 'manifest_missing', file: 'artifact-type.json', message: 'There is no artifact-type.json: the type has no name, version or description of its own.' }, forShare ? 'error' : 'warning');
  } else {
    try {
      const parsed = JSON.parse(readFileSync(manifestFile, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) add({ code: 'manifest_invalid', file: 'artifact-type.json', message: 'artifact-type.json is not a JSON object.' }, 'error');
      else manifest = parsed as ArtifactTypeManifest & Record<string, unknown>;
    } catch (error) {
      add({ code: 'manifest_invalid', file: 'artifact-type.json', message: `artifact-type.json does not parse: ${(error as Error).message}` }, 'error');
    }
  }
  if (manifest) {
    if (typeof manifest.slug === 'string' && manifest.slug !== id) add({ code: 'slug_mismatch', file: 'artifact-type.json', message: `"slug" is ${JSON.stringify(manifest.slug)} but the folder is ${id}: the folder name is the id.` }, 'warning');
    if (forShare) for (const p of manifestShareProblems(manifest)) errors.push(p);
    else {
      if (typeof manifest.uid !== 'string' || !manifest.uid) add({ code: 'uid_missing', file: 'artifact-type.json', message: 'There is no "uid" (a UUID): sharing the type will need one.' }, 'warning');
      if (typeof manifest.version !== 'string' || !manifest.version) add({ code: 'version_missing', file: 'artifact-type.json', message: 'There is no "version".' }, 'warning');
    }
  }

  // What the registry makes of it (entry, runtime).
  const info = readTypeFolder(dir, { root: resolve(dir, '..'), scope: 'user', trusted: true });
  if (info) {
    for (const problem of info.problems) {
      if (problem.startsWith('artifact-type.json is not valid JSON')) continue;
      add({ code: 'type_problem', message: problem }, 'error');
    }
    if (!info.runnable && !info.problems.length) add({ code: 'not_runnable', message: 'Nothing serves this type: give it an index.html with an // artifact.json declaration.' }, 'error');
  } else if (TYPE_ID.test(id)) {
    add({ code: 'not_a_type', message: 'This folder has neither index.html nor artifact-type.json.' }, 'error');
  }

  // The declaration, read without running it.
  const indexFile = join(dir, 'index.html');
  if (existsSync(indexFile)) {
    const html = readFileSync(indexFile, 'utf8');
    if (DECLARATION_LINE.test(html) || declarationSource(html)) {
      try {
        const decl = readStaticDeclaration(html)!;
        if (!decl.key) add({ code: 'declaration_key_missing', file: 'index.html', message: 'The declaration has no `var key = "…"`.' }, 'warning');
        else if (decl.key !== id) add({ code: 'declaration_key_mismatch', file: 'index.html', message: `The declaration's key is ${JSON.stringify(decl.key)}, the type's id ${id}.` }, 'warning');
        for (const name of decl.lexical) {
          add({ code: 'declaration_lexical', file: 'index.html', message: `\`${name}\` is declared with let or const: frame-host reads only var declarations. Write \`var ${name} = …\`.` }, 'error');
        }
        for (const name of decl.names) {
          if (name !== 'key' && name !== 'capabilities' && name !== 'monitoring') {
            add({ code: 'declaration_name_unread', file: 'index.html', message: `\`${name}\` in the declaration is not read: only key, capabilities and monitoring are.` }, 'warning');
          }
        }
        const problem = capabilitiesProblem(decl.capabilities);
        if (problem) add({ code: 'capabilities_invalid', file: 'index.html', message: problem }, 'error');
        caps = { backed: [], stubbed: [], unknown: [] };
        for (const [name, config] of Object.entries(decl.capabilities)) {
          const status = capabilityStatus(name);
          if (status === 'backed') caps.backed.push(name);
          else if (status === 'stubbed') {
            caps.stubbed.push(name);
            add({ code: 'capability_stubbed', file: 'index.html', message: `${name} is declared, but nothing on this computer serves it: every call rejects. Write the page so it still works.` }, 'warning');
          } else if (status === 'unknown') {
            caps.unknown.push(name);
            add({ code: 'capability_unknown', file: 'index.html', message: `${name} is not a capability Open Artifact knows.` }, 'error');
          }
          if (config === false) add({ code: 'capability_false', file: 'index.html', message: `${name} is false: leave it out instead (frame-host grants a declared name either way).` }, 'warning');
        }
      } catch (error) {
        if (!(error instanceof DeclarationError)) throw error;
        add({ code: 'declaration_invalid', file: 'index.html', message: `The // artifact.json declaration is not literal data: ${error.message}` }, 'error');
      }
    }
  }

  // The skill.
  if (manifest?.skill !== false) {
    const skillName = typeof manifest?.skill === 'string' ? manifest.skill : 'SKILL.md';
    const skillFile = resolve(dir, skillName);
    if (!skillFile.startsWith(resolve(dir) + sep) || !existsSync(skillFile)) {
      add({ code: 'skill_missing', file: skillName, message: `There is no ${skillName}: agents would not know how to make one.` }, 'error');
    } else {
      const fm = readFrontmatter(readFileSync(skillFile, 'utf8'));
      for (const field of ['name', 'description']) {
        if (!fm[field]?.trim()) add({ code: 'skill_frontmatter', file: skillName, message: `${skillName} has no "${field}" in its frontmatter.` }, 'error');
      }
    }
  }

  // Where it stands among the other types.
  const listed = o.registry.list(o.workspace ?? undefined, { includeShadowed: true });
  const self = listed.find((t) => resolve(t.dir) === resolve(dir));
  if (self) {
    if (self.shadowedBy) add({ code: 'shadowed', message: `A ${self.shadowedBy} type of the same id wins over this one.` }, 'warning');
    const hidden = listed.filter((t) => t.id === id && t !== self && t.shadowedBy);
    for (const t of hidden) add({ code: 'shadows', message: `This type hides the ${t.scope} type ${id} (${t.dir}).` }, 'warning');
    if (!self.enabled) add({ code: 'disabled', message: `${id} is turned off: open-artifact types enable ${id}.` }, 'warning');
    if (!self.trusted && self.ownCode) add({ code: 'untrusted', message: `The project is not trusted: its server ("entry.start") does not start until the person runs open-artifact types trust.` }, 'warning');
    else if (!self.trusted && self.scope === 'project' && (self.runtime === 'frame' || self.runtime === 'static')) {
      const network = self.network.length ? `and ${self.network.join(', ')} (openArtifact.network)` : 'and nothing else (it lists no openArtifact.network)';
      add(
        {
          code: 'untrusted_restricted',
          message: `The project is not trusted: until the person runs open-artifact types trust, this type's page reaches only its own origin ${network}, opens no popups and cannot leave its frame, and agents are told its instructions come from a folder the person has not trusted.`,
        },
        'warning',
      );
    }
  }

  if (forShare) for (const p of shareFileProblems(dir)) errors.push(p);
  return out();
}

/**
 * The file rules of a type to share, on a folder: its files as {@link packageFolderEntries} lists them, judged by
 * `packageEntryProblems` (the protocol's one definition, which `types install` applies to a package's entries).
 */
export function shareFileProblems(dir: string): TypeCheckProblem[] {
  return packageEntryProblems(packageFolderEntries(dir));
}

/**
 * Every entry under `dir`, paths relative to it with forward slashes: files with their size, folders, and anything
 * else (a link, a device) as `other`. Links are not followed; a dot folder is listed but not walked into.
 */
export function packageFolderEntries(dir: string): PackageEntry[] {
  const out: PackageEntry[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      const rel = relative(dir, full).split(sep).join('/');
      const st = lstatSync(full);
      if (st.isDirectory()) {
        out.push({ path: `${rel}/`, kind: 'dir', size: 0 });
        if (!name.startsWith('.')) walk(full);
      } else out.push({ path: rel, kind: st.isFile() ? 'file' : 'other', size: st.isFile() ? st.size : 0 });
    }
  };
  walk(dir);
  return out;
}

/** The folder of `target`: a folder path (it has a `/`, or is `.`), else the id of a visible type. */
export function typeDirOf(target: string, registry: TypeRegistry, workspace?: string | null, cwd = process.cwd()): string {
  if (target === '.' || target === '..' || target.includes('/') || target.includes(sep)) return resolve(cwd, target);
  const type = registry.list(workspace ?? undefined, { includeShadowed: false }).find((t) => t.id === target);
  if (type) return type.dir;
  if (existsSync(resolve(cwd, target, 'artifact-type.json')) || existsSync(resolve(cwd, target, 'index.html'))) return resolve(cwd, target);
  throw new OpenArtifactError('not_found', `No type ${target}.`, { fix: 'open-artifact types list shows the types; or give the folder (./my-type).' });
}

// ---- types from -----------------------------------------------------------------------------------------------------

/** Folders of an artifact that `types from` names once, not file by file. */
const COLLAPSED = new Set(['db', '_blobs', 'history', '_agent']);

/**
 * `types from`: a new type made from a `page` artifact: its `index.html` (with the artifact's capabilities as the
 * inline declaration) and its `artifact-type/` folder, a manifest and a draft `SKILL.md`. The other files are listed,
 * not copied.
 */
export function typeFromPage(record: ArtifactRecord, type: ListedType | null, args: { id: unknown; scope?: unknown; name?: unknown; project?: unknown }, o: Options): TypesFromResponse {
  if (record.type !== 'page' && !isPageType(type)) {
    throw new OpenArtifactError('unsupported', `${record.title} is a ${record.type} artifact: a type is made from a page artifact.`);
  }
  const html = (() => {
    try {
      return readFileSync(join(record.root, 'index.html'), 'utf8');
    } catch {
      throw new OpenArtifactError('not_found', `${record.title} has no index.html yet.`);
    }
  })();
  const id = checkNewTypeId(args.id);
  const scope = scopeOf(args.scope);
  const name = nameOf(args.name ?? record.title, id);
  const project = typeof args.project === 'string' && args.project ? resolve(args.project) : (o.workspace ?? null);
  const capabilities = record.capabilities && typeof record.capabilities === 'object' ? record.capabilities : {};
  const dir = makeFolder(authoringRoot(o.settings, scope, project), id);
  const uid = randomUUID();
  try {
    const page = withDeclaration(html, renderDeclaration({ key: id, capabilities, monitoring: {} }));
    const description = `Made from the page "${record.title}". Say here what an artifact of this type is for.`;
    const manifest: ArtifactTypeManifest & Record<string, unknown> = {
      slug: id,
      uid,
      name,
      title: name,
      description,
      artifactTitle: `Untitled ${name.toLowerCase()}`,
      version: '0.1.0',
      skill: 'SKILL.md',
      intents: [id],
      when: `The person asks for a ${name.toLowerCase()}.`,
      engines: { openArtifact: '>=1' },
    };
    const written: Record<string, string> = {
      'artifact-type.json': `${JSON.stringify(manifest, null, 2)}\n`,
      'index.html': page,
      'SKILL.md': `${frontmatter(id, `Make a ${name.toLowerCase()}: ${description}`)}
# ${name}

This type was made from the page "${record.title}". Its page is the type's own \`index.html\`; an artifact of this
type is a folder, \`<root>\`, whose files the page reads by relative URL (and \`artifact-type/…\` for the type's own
files).

## Make one

1. **Create it**: \`Artifact {"action": "publish", "type_url": "open-artifact://type/${id}", "title": "…"}\`.
2. **Write its content** into \`<root>\`. Say here which files the page reads, and their format.
`,
    };
    const filesOut = writeAll(dir, written);
    const own = join(record.root, 'artifact-type');
    if (existsSync(own) && statSync(own).isDirectory()) {
      cpSync(own, join(dir, 'artifact-type'), { recursive: true, dereference: false, filter: (src) => !basename(src).startsWith('.') && !lstatSync(src).isSymbolicLink() });
      for (const f of listFiles(join(dir, 'artifact-type'))) filesOut.push(`artifact-type/${f}`);
    }
    const skipped = skippedOf(record.root);
    const check = checkType(dir, { ...o, workspace: scope === 'project' ? project : o.workspace });
    const notes = [
      ...(skipped.length
        ? ['Each artifact of the new type has a folder of its own: a file the page reads by relative URL from the old folder is not there. Move what every artifact needs under artifact-type/ in the type, and point the page at it.']
        : []),
      ...(/\.publish\(\s*['"`<]|\.publish\(\s*html\b/.test(html) ? ["The page replaces its own index.html (publish(html)); in a type, index.html is the type's, so that call is refused: publish the content as files instead."] : []),
    ];
    return { id, uid, scope, dir, files: filesOut.sort(), check, prompt: buildOutPrompt(name, id, dir), skipped, ...(notes.length ? { notes } : {}) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

// ---- types from a saved page ----------------------------------------------------------------------------------------

const RUNTIME_START = '<!-- frame-runtime -->';
const RUNTIME_END = '<!-- /frame-runtime -->';

/**
 * The page without the frame runtime a host inlined into it (`<!-- frame-runtime -->` … `<!-- /frame-runtime -->`,
 * markers included, every such block): frame-host puts its own in. `invalid_argument` when a block is not closed.
 */
export function stripFrameRuntime(html: string): string {
  let out = html;
  for (let at = out.indexOf(RUNTIME_START); at >= 0; at = out.indexOf(RUNTIME_START, at)) {
    const end = out.indexOf(RUNTIME_END, at + RUNTIME_START.length);
    if (end < 0) throw new OpenArtifactError('invalid_argument', `The page has a ${RUNTIME_START} with no ${RUNTIME_END} after it: it cannot tell where the inlined runtime ends.`);
    out = out.slice(0, at) + out.slice(end + RUNTIME_END.length);
  }
  return out;
}

/** Names that are runtime parts, not capabilities: `use('hot')`. */
const NOT_CAPABILITIES = new Set(['hot']);

/** Literal imports in inline module scripts, in page order. Ignore prose, comments and quoted examples. */
function importedCapabilities(html: string): { name: string; offset: number }[] {
  const found: { name: string; offset: number }[] = [];
  const scripts = /<!--[\s\S]*?-->|<script\b((?:[^'">]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;
  for (const tag of html.matchAll(scripts)) {
    const [, attributes, code] = tag;
    if (!code) continue;
    const attrs = new Map<string, string>();
    for (const attribute of attributes!.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs.set(attribute[1]!.toLowerCase(), (attribute[2] ?? attribute[3] ?? attribute[4] ?? '').toLowerCase());
    }
    if (attrs.get('type') !== 'module' || attrs.has('src')) continue;
    const start = tag.index + '<script>'.length + attributes!.length;
    // Quoted strings and comments are tokens of their own; only a module specifier can contribute a name.
    const tokens = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[\w$]+|[^\s]/g;
    let declaration = false;
    let previous = '';
    for (const token of code.matchAll(tokens)) {
      const value = token[0];
      if (value.startsWith('//') || value.startsWith('/*')) continue;
      if (declaration && (previous === 'from' || previous === 'import')) {
        const path = /^["']\/_\/openartifact:([a-z][a-z0-9]{0,23})(?:@\d+\.\d+\.\d+)?["']$/.exec(value);
        if (path && path[1] !== 'use') found.push({ name: path[1]!, offset: start + token.index });
      }
      if (value === 'import' || value === 'export') declaration = previous !== '.' && previous !== '/';
      else if (!/^(?:[\w$]+|[*,{}])$/.test(value)) declaration = false;
      previous = value;
    }
  }
  return found;
}

/**
 * The capabilities a page uses, read from its literal calls: `claude.use('x')`, `openArtifact.use("x")`, `use('x')`,
 * `useCap('x')`, and local capability imports in inline module scripts. `inferred`: names Open Artifact knows (backed, or stubbed here), in order of first use; `unknown`:
 * the others. `self` is `artifact`.
 */
export function capabilitiesUsed(html: string): Omit<TypesFromCapabilities, 'declared'> {
  const known = new Set([...FRAME_BACKED_CAPABILITIES, ...Object.keys(FRAME_STUBBED_CAPABILITIES)]);
  const inferred: string[] = [];
  const unknown: string[] = [];
  const sites = importedCapabilities(html);
  for (const m of html.matchAll(/\b(?:use|useCap)\(\s*(['"])([A-Za-z_][A-Za-z0-9_-]{0,63})\1\s*\)/g)) sites.push({ name: m[2]!, offset: m.index });
  for (const site of sites.sort((a, b) => a.offset - b.offset)) {
    const name = site.name === 'self' ? 'artifact' : site.name;
    if (NOT_CAPABILITIES.has(name)) continue;
    const list = known.has(name) ? inferred : unknown;
    if (!list.includes(name)) list.push(name);
  }
  return { inferred, stubbed: inferred.filter((n) => Object.hasOwn(FRAME_STUBBED_CAPABILITIES, n)), unknown };
}

/** A JSON literal that never ends a `<script>`. */
const scriptLiteral = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * The page with a `capabilities` declaration: when its block declares none, `var capabilities = {…};` goes right
 * after its `var key` line (or the marker line, with no key); with no block, one is added (key `id`). A block that
 * declares capabilities is kept as it is. The page's key is left alone.
 */
export function withInferredCapabilities(html: string, id: string, capabilities: string[]): { html: string; declared: string[] | null } {
  const object = Object.fromEntries(capabilities.map((name) => [name, {}]));
  const found = declarationSource(html);
  if (!found) return { html: withDeclaration(html, renderDeclaration({ key: id, capabilities: object, monitoring: {} })), declared: null };
  let decl;
  try {
    decl = readStaticDeclaration(html);
  } catch {
    decl = null;
  }
  if (decl && decl.names.includes('capabilities')) return { html, declared: Object.keys(decl.capabilities) };
  const keyLine = /^[ \t]*var[ \t]+key[ \t]*=[^\n]*$/m.exec(found.source);
  const markerLineStart = html.lastIndexOf('\n', found.offset) + 1;
  const indent = keyLine ? /^[ \t]*/.exec(keyLine[0])![0] : /^[ \t]*/.exec(html.slice(markerLineStart))![0];
  const at = keyLine ? found.offset + keyLine.index + keyLine[0].length : found.offset;
  return { html: `${html.slice(0, at)}\n${indent}var capabilities = ${scriptLiteral(object)};${html.slice(at)}`, declared: null };
}

/** The text of the page's `<script type="text/plain" id="notes-for-claude">`, or null. */
export function pageNotes(html: string): string | null {
  const m = /<script\b(?=[^>]*\btype\s*=\s*["']text\/plain["'])(?=[^>]*\bid\s*=\s*["']notes-for-claude["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  const text = m?.[1]?.trim();
  return text ? text : null;
}

/** The page's `<title>`, as text. */
function pageTitle(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!m) return null;
  const text = m[1]!
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return oneLine(text, 80) || null;
}

/** Text from someone else's file, as one line of at most `max` characters, no control characters. */
function oneLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Icons `types from` copies: a plain file of the folder itself, of these kinds, at most this size. */
const ICON_TYPES = new Set(['.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.ico']);
const ICON_MAX_BYTES = 512 * 1024;

/** The icon `metadata.json` names (`icon.file`), when it keeps the rules: a file name in `folder`, a plain file. */
function iconOf(folder: string, meta: Record<string, unknown> | null): { file: string; problem?: undefined } | { file?: undefined; problem: string } | null {
  const icon = meta?.icon;
  const file = icon && typeof icon === 'object' && !Array.isArray(icon) ? (icon as Record<string, unknown>).file : undefined;
  if (file === undefined) return null;
  if (typeof file !== 'string' || !file || file !== basename(file) || file.startsWith('.') || file.includes('\\') || file.includes('\0')) {
    return { problem: `metadata.json names the icon ${JSON.stringify(file)}: an icon is a file name in the folder; not copied.` };
  }
  if (!ICON_TYPES.has(extname(file).toLowerCase())) return { problem: `The icon ${file} is not an image Open Artifact shows (${[...ICON_TYPES].join(', ')}); not copied.` };
  let st;
  try {
    st = lstatSync(join(folder, file));
  } catch {
    return { problem: `metadata.json names the icon ${file}, which is not in the folder; not copied.` };
  }
  if (!st.isFile()) return { problem: `The icon ${file} is a link or a folder, not a file; not copied.` };
  if (st.size > ICON_MAX_BYTES) return { problem: `The icon ${file} is over ${ICON_MAX_BYTES / 1024} KB; not copied.` };
  return { file };
}

/** What `types from <path>` says about where the page comes from: in its notes, and in its docs. */
export const SAVED_PAGE_NOTE =
  "The page and its notes for Claude were written by someone else, not by you or by Open Artifact: read index.html and SKILL.md before you use the type, as you would any code you did not write. The type is yours (a user or project type), so its page runs with what your own types may do.";

/**
 * `types from <path>`: a new type made from a page saved from elsewhere (a claude.ai artifact template, say): `path`
 * is a folder with `index.html` (and optionally `metadata.json` and the icon it names) or an `.html` file. The inlined
 * frame runtime is stripped, the capabilities the page uses are declared when it declares none, `artifact-type.json`
 * takes what `metadata.json` says (as untrusted text: one line each, capped), and `SKILL.md` is the page's
 * `notes-for-claude`, or a stub.
 */
export function typeFromSaved(path: string, args: { id: unknown; scope?: unknown; name?: unknown; project?: unknown }, o: Options): TypesFromResponse {
  const source = resolve(path);
  let st;
  try {
    st = statSync(source);
  } catch {
    throw new OpenArtifactError('not_found', `${source} is not there.`);
  }
  const folder = st.isDirectory() ? source : null;
  const indexFile = folder ? join(folder, 'index.html') : source;
  if (!folder && !/\.html?$/i.test(source)) throw new OpenArtifactError('invalid_argument', `${source} is neither a folder nor an .html file.`);
  let indexSt;
  try {
    indexSt = statSync(indexFile);
  } catch {
    throw new OpenArtifactError('not_found', `${folder} has no index.html.`);
  }
  if (!indexSt.isFile()) throw new OpenArtifactError('invalid_argument', `${indexFile} is not a file.`);
  if (indexSt.size > TYPE_PACKAGE_LIMITS.fileBytes) throw new OpenArtifactError('too_large', `${indexFile} is over ${TYPE_PACKAGE_LIMITS.fileBytes / 1024 / 1024} MB.`);
  const id = checkNewTypeId(args.id);
  const scope = scopeOf(args.scope);
  const project = typeof args.project === 'string' && args.project ? resolve(args.project) : (o.workspace ?? null);

  const original = readFileSync(indexFile, 'utf8');
  const stripped = stripFrameRuntime(original);
  const used = capabilitiesUsed(stripped);
  const { html, declared } = withInferredCapabilities(stripped, id, used.inferred);
  const capabilities: TypesFromCapabilities = declared ? { inferred: [], stubbed: [], unknown: used.unknown, declared } : used;

  const notes: string[] = [];
  let meta: Record<string, unknown> | null = null;
  if (folder && existsSync(join(folder, 'metadata.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(folder, 'metadata.json'), 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
      else notes.push('metadata.json is not a JSON object: it was not read.');
    } catch {
      notes.push('metadata.json does not parse: it was not read.');
    }
  }
  const title = pageTitle(stripped);
  const name = nameOf(oneLine(args.name, 80) || oneLine(meta?.name, 80) || title || '', id);
  const description = oneLine(meta?.description, 1000) || `Made from the page "${title ?? name}". Say here what an artifact of this type is for.`;
  const icon = folder ? iconOf(folder, meta) : null;
  if (icon?.problem) notes.push(icon.problem);
  const manifest: ArtifactTypeManifest & Record<string, unknown> = {
    slug: id,
    uid: randomUUID(),
    name,
    title: oneLine(meta?.title, 120) || name,
    description,
    ...(oneLine(meta?.summary, 1000) ? { summary: oneLine(meta?.summary, 1000) } : {}),
    artifactTitle: oneLine(meta?.artifactTitle, 120) || `Untitled ${name.toLowerCase()}`,
    ...(oneLine(meta?.category, 64) ? { category: oneLine(meta?.category, 64) } : {}),
    ...(icon?.file ? { icon: { file: icon.file } } : {}),
    version: '1.0.0',
    skill: 'SKILL.md',
    intents: [id],
    when: `The person asks for a ${name.toLowerCase()}.`,
    engines: { openArtifact: '>=1' },
  };
  const pageNotesText = pageNotes(stripped);
  const skill = `${frontmatter(id, description)}
# ${name}

${
  pageNotesText
    ? `These are the page's own notes for Claude (its \`notes-for-claude\`), as whoever wrote the page wrote them. Read them before you rely on them.\n\n${pageNotesText}\n`
    : `This type was made from a page saved from elsewhere, which had no notes for Claude. Its page is the type's own \`index.html\`; an
artifact of this type is a folder, \`<root>\`, whose files and data the page reads.

## Make one

1. **Create it**: \`Artifact {"action": "publish", "type_url": "open-artifact://type/${id}", "title": "…"}\`.
2. **Write its content** into \`<root>\`. Say here which files (or ArtifactData collections) the page reads, and their format.
`
}`;

  const dir = makeFolder(authoringRoot(o.settings, scope, project), id);
  try {
    const written: Record<string, string> = { 'artifact-type.json': `${JSON.stringify(manifest, null, 2)}\n`, 'index.html': html, 'SKILL.md': skill };
    const filesOut = writeAll(dir, written);
    if (icon?.file) {
      cpSync(join(folder!, icon.file), join(dir, icon.file));
      filesOut.push(icon.file);
    }
    const skipped = folder
      ? readdirSync(folder, { withFileTypes: true })
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .filter((n) => n !== 'index.html' && n !== 'metadata.json' && n !== icon?.file && !n.startsWith('.'))
          .sort()
      : [];
    const check = checkType(dir, { ...o, workspace: scope === 'project' ? project : o.workspace });
    if (stripped !== original) notes.push('The frame runtime inlined in the page (<!-- frame-runtime --> … <!-- /frame-runtime -->) was taken out: frame-host serves its own.');
    if (!declared && capabilities.inferred.length) notes.push(`Declared the capabilities the page uses: ${capabilities.inferred.join(', ')}.`);
    if (capabilities.stubbed.length) notes.push(`On this computer ${capabilities.stubbed.join(', ')} answer${capabilities.stubbed.length === 1 ? 's' : ''} only an error (${capabilities.stubbed.map((n) => FRAME_STUBBED_CAPABILITIES[n]).join(', ')}): the page should still work without ${capabilities.stubbed.length === 1 ? 'it' : 'them'}.`);
    if (capabilities.unknown.length) notes.push(`The page also uses ${capabilities.unknown.join(', ')}, which Open Artifact does not know: not declared, so those calls get null.`);
    notes.push(SAVED_PAGE_NOTE);
    return { id, uid: String(manifest.uid), scope, dir, files: filesOut.sort(), check, prompt: buildOutPrompt(name, id, dir), skipped, notes, capabilities, source };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The page with `block` as its declaration: in place of the one it has, else in a script that never runs (the
 * declaration is read from the text), first in `<head>`, so its names cannot clash with the page's own.
 */
export function withDeclaration(html: string, block: string): string {
  const found = declarationSource(html);
  if (found && found.terminated) {
    const start = found.offset - '// artifact.json'.length;
    const lineStart = html.lastIndexOf('\n', start) + 1;
    const indent = /^[ \t]*/.exec(html.slice(lineStart, start))![0];
    const body = block.split('\n').map((line, i) => (i === 0 ? line : indent + line)).join('\n');
    // The old block's end line stays: it ends the new one too, and the closing line in `block` is dropped.
    return html.slice(0, start) + body.split('\n').slice(0, -1).join('\n') + html.slice(found.offset + found.source.length);
  }
  const tag = `<script type="text/plain" id="artifact-json">\n${block}\n</script>`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}\n${tag}${html.slice(head.index + head[0].length)}`;
  return `${tag}\n${html}`;
}

function listFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

/** The artifact's paths `types from` leaves behind: everything but index.html and artifact-type/. */
function skippedOf(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'index.html' || e.name === 'artifact-type') continue;
    if (e.isDirectory()) {
      if (COLLAPSED.has(e.name) || e.name.startsWith('.')) out.push(`${e.name}/`);
      else out.push(...listFiles(join(root, e.name), e.name));
    } else out.push(e.name);
  }
  return out;
}

// ---- settings -------------------------------------------------------------------------------------------------------

/** The saved file's own lists (not the merged settings): what `saveSettings` writes back. */
function savedLists(): { disabledTypes: string[]; trustedProjects: string[] } {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { disabledTypes: list(saved.disabledTypes), trustedProjects: list(saved.trustedProjects) };
}

/** `types enable` / `types disable`: `disabledTypes` in settings.json. */
export function setTypeEnabled(id: unknown, enabled: boolean): TypesSettingResponse {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!TYPE_ID.test(value)) throw new OpenArtifactError('invalid_argument', `${JSON.stringify(id ?? '')} is not a type id.`);
  const lists = savedLists();
  const next = lists.disabledTypes.filter((t) => t !== value);
  if (!enabled) next.push(value);
  saveSettings({ disabledTypes: next });
  return { ok: true, disabledTypes: next, trustedProjects: lists.trustedProjects };
}

/** `types trust` / `types untrust`: `trustedProjects` in settings.json (a project folder, absolute). */
export function setProjectTrusted(dir: unknown, trusted: boolean): TypesSettingResponse {
  const value = typeof dir === 'string' ? dir.trim() : '';
  if (!value || (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value))) throw new OpenArtifactError('invalid_argument', 'dir: the project folder, as an absolute path.');
  const full = resolve(value);
  const lists = savedLists();
  const next = lists.trustedProjects.filter((p) => resolve(p) !== full);
  if (trusted) next.push(full);
  saveSettings({ trustedProjects: next });
  return { ok: true, disabledTypes: lists.disabledTypes, trustedProjects: next };
}
