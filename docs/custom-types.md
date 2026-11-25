# Making your own artifact types

[中文](custom-types.zh-CN.md)

Besides the built-in types, Open Artifact runs types you make yourself. A type is a folder: a page (`index.html`),
a manifest (`artifact-type.json`) and a `SKILL.md` that tells agents how to fill an artifact of it. Every artifact of
the type opens that page in the Shell, with comments, history and Send to agent, and keeps its own content in its own
folder.

Make a type when you want the same kind of page again and again: a trip planner, a reading log, a weekly scorecard.
For a one-off page, ask for a `page` artifact instead.

## Where types live

| Where | Folder | Used |
| --- | --- | --- |
| Yours | `~/.agents/artifact-types/` (`typeRoots.user` in settings, or `OPEN_ARTIFACT_USER_TYPES`) | In every project. |
| A project's | `<project>/.agents/artifact-types/` | In that project. Until you trust the project, with the limits of an installed type (see [Trust a project](#trust-a-project)). |
| Extra | `typeRoots.extra` in settings, or `OPEN_ARTIFACT_EXTRA_TYPES` (colon separated) | In every project. |
| Installed | `<OPEN_ARTIFACT_HOME>/types/` (or `OPEN_ARTIFACT_INSTALLED_TYPES`), written by `types install` | In every project, with the limits in [Install someone else's type](#install-someone-elses-type). |
| Built in | Shipped with Open Artifact | Always, unless you turn them off. |

A type of the same id in a nearer folder overrides the others: a project's over yours, yours over an extra one, an
extra one over an installed one. An installed type never takes a built-in id.
`open-artifact types list` shows every type with its `scope`, `source` (`builtin`, `local` or `installed`, with
`installedFrom` for an installed one), `version`, `uid`, folder and problems. The home page's **Types** tab shows the
same, with what each type's page may use (its capabilities) and the sites it may reach.

## Make one

From your terminal or your agent:

```bash
open-artifact types new trip-planner --template page        # the content is files beside the page
open-artifact types new reading-log --template data          # the content is records in a database
open-artifact types new board --scope project                # in this project's .agents/artifact-types/
```

Or press **New type** in the home page's Types tab: give an id, a name, a template and where it goes. The dialog
then shows the type's folder and a prompt to give your agent, which builds the type out from there.

- The id is lower case letters, digits and dashes. It cannot be a built-in id or `new-type`, and the folder must not
  exist yet.
- `--template page` (the default) keeps an artifact's content in `content.json`, which the agent writes and you edit
  and save on the page. `--template data` keeps it in the artifact's database, which the page and the agent change
  together.
- The scaffold works as written: you can make an artifact of it straight away.

Your agent has a guide to building a type out: `/open-artifact new-type` (it is in the skill, at
`reference/new-type.md`). It covers the folder, the declaration block at the top of the page, the capabilities a page
can use, the two ways to keep content, and how to write the type's `SKILL.md`. It also says how to design the type's
page (every state designed, nothing loaded from another site, both themes, narrow screens), and points to the design,
diagram and chart guides that ship with the [Page](types/page.md#design-guidance) type.

## Turn a page into a type

A `page` artifact that already does the job can become a type:

```bash
open-artifact types from art_… --id trip-planner
```

It copies the page and its `artifact-type/` folder, writes the artifact's capabilities into the page, and drafts the
manifest and `SKILL.md`. The answer lists the files it did not copy (the artifact's content, its database and
uploads) and what to change so each new artifact reads its own content.

### From a page saved from claude.ai

A page saved from a claude.ai artifact template (a folder with `index.html`, and perhaps `metadata.json` and an icon,
or a single `.html` file) becomes a type the same way:

```bash
open-artifact types from ./saved-page --id cite-check
open-artifact types from ./saved-page/index.html --id cite-check --scope project --name "Citation check"
```

- The page's own copy of the frame runtime is removed; Open Artifact serves its own.
- When the page declares no capabilities, the ones its code calls are declared for it. The answer lists them as
  `capabilities.inferred`, with `stubbed` (`mcp`, `sample`, `tts` and `paste` answer only with an error here) and
  `unknown` (names Open Artifact does not have, such as a network permission; list the sites in
  `openArtifact.network` instead).
- `artifact-type.json` takes its name, description and icon from `metadata.json`, one line each and cut to length;
  `--name` wins. The icon is copied only when it is a plain image file beside the page (`.svg`, `.png`, `.webp`,
  `.jpg`, `.gif` or `.ico`, at most 512 KB). The version is `1.0.0`.
- `SKILL.md` is the page's notes for Claude (the `notes-for-claude` block), marked as written by whoever wrote the
  page, or a stub to fill in when there are none.
- Nothing else in the folder is copied; the answer lists what was skipped. Fonts or files the page loaded from
  claude.ai are not there, so the page falls back to what the browser has.

The page and its notes were written by someone else. Read `index.html` and `SKILL.md` before you use the type: a type
made this way is yours (a user type, or a project type that is limited until you trust the project), so its page
runs with what your own types may do. `--scope` defaults to `user`. The command needs the daemon's token, so it runs
from your terminal or your agent, not from a web page.

## Check it

```bash
open-artifact types check trip-planner
open-artifact types check ./path/to/folder --for-share
```

It lists errors (the type will not work) and warnings (it may not do what was meant), and exits with 1 on errors:
an invalid id, a manifest that does not parse, a declaration that is not plain data (or uses `let`/`const`), an
unknown capability name, a `SKILL.md` without its front matter, an id that clashes with a built-in type. Stubbed
capabilities (`mcp`, `sample`, `tts`, `paste`) are warnings: they only answer with an error on this computer.
`--for-share` adds the rules for a type you mean to give to others: `slug`, `uid`, `name`, `version` and
`description` set; no `entry` that starts a program or points at a URL; no symbolic links or dotfiles; at most 2000
files, 16 MiB a file and 64 MiB in all.

## Try it

1. `open-artifact types list` shows it with `"runnable": true`.
2. Make an artifact of it: ask your agent, or press **New <type>** on its card in the Types tab.
3. Use the page, then ask your agent to fill it the way the type's `SKILL.md` says.

Your agent can look at an artifact of the type too: every page-kind type has the `snapshot` action, a PNG of the page at a width, height and colour scheme it chooses (see [Page](types/page.md#a-picture-of-the-page-snapshot)). The snapshot only reads, so it is safe on any artifact.

## Turn types off and on

```bash
open-artifact types disable trip-planner
open-artifact types enable trip-planner
```

Or use the switch on the type's card in the Types tab. While a type is off, no agent can make an artifact of it. This
is yours to decide: the command refuses to run from inside an agent's session, and the daemon refuses it from other
web pages and from a call that says it comes from an agent's session. These are guard rails, not a boundary: a program
on your computer that does not say where it runs from can still make the call.

## Trust a project

A project's types come from that project's folder, which anyone who wrote to the project may have changed. Until you
trust the project its types still work (one that starts a program of its own, `entry.start`, does not start), but
with the limits of an installed type (see
[Install someone else's type](#install-someone-elses-type)): no program of their own (`entry.start` or `entry.url`),
a page that reaches only its own address and the sites it lists, in a sandboxed frame, and agents are told the type's
words are not yours. `types check` says so (`untrusted_restricted`). Trusting the project lifts the limits, and a
running page restarts without them:

```bash
cd ~/code/my-app && open-artifact types trust
open-artifact types untrust ~/code/my-app
```

Or press **Trust this project** under the project in the Types tab. Like turning a type on or off, trusting is
yours to do, and refused from inside an agent's session in the same way. `OPEN_ARTIFACT_TRUST_PROJECTS=1` trusts every project (for tests and CI).

## Share a type

```bash
open-artifact types pack trip-planner                 # writes trip-planner-<version>.oatype here
open-artifact types pack ./path/to/folder --out ~/Desktop
```

`types pack` runs `types check --for-share` first and refuses on any error, then zips the folder into one file,
`<id>-<version>.oatype`, and prints its sha256. Give that file to the other person, or put it on an `https://`
address they can download.

The `uid` in `artifact-type.json` is what makes it the same type everywhere: keep it when you change the type, so
artifacts made with it keep opening. A type whose page reaches other sites lists them in `openArtifact.network`
(`["https://api.example.com"]`, `https://` origins only); an installed type's page, or one in a project you have not
trusted, reaches nothing else.

## Install someone else's type

```bash
open-artifact types install ./trip-planner-1.2.0.oatype
open-artifact types install https://example.com/trip-planner-1.2.0.oatype
open-artifact types install ./trip-planner-1.2.0.oatype --as trips      # under another id
open-artifact types update trip-planner                                  # read its source again
open-artifact types uninstall trip-planner
```

Or press **Install type** in the Types tab and choose the file or give its address. Before anything is installed you
see what the package is: its id, version, where it came from, its sha256, the capabilities its page asks for, the
sites it may reach, and its `SKILL.md` in full (what agents will be told when they make one). The command line asks
`[y/N]`; `--yes` skips the question once you have read it. Installing, updating and uninstalling are yours to do:
refused from inside an agent's session and from other web pages, like turning a type off.

What an installed type may do is less than a type of your own:

- It never starts a program on your computer (`entry.start`) and never points at another address (`entry.url`), even
  if its folder is changed after the install: its page is served as files, by Open Artifact.
- Its page runs in the browser with a Content-Security-Policy, in a sandboxed frame: its requests, images, embedded
  pages and forms reach its own address and the `https://` sites its manifest lists, nothing else. It cannot open
  popups or new tabs, move the Shell page, or send its own frame to another address (a link, a meta refresh or a
  script that changes the location), and a download link to another site fetches nothing. This was measured in Chrome,
  where its own files, data, uploads and downloads still work. The page's address opened on its own in a tab has the policy but not the frame's sandbox, and
  the page can still put text in front of your agent (a comment sent to it, or a title it suggests), which agents
  are told to read as data.
- Agents are told that its `SKILL.md`, title and description are the publisher's, not yours: they use them to build
  the artifact, not to widen the task or ask for permissions.
- You cannot publish it to a site: that is its author's to do. Once a site has it (the same `uid`), artifacts of it
  publish there as they are.
- A link inside its folder, or inside an artifact's, that leads out of that folder is neither served nor written
  through.

An install unpacks into a temporary folder and moves into place only after every check passed: a package with a path
that leaves its folder, a link, a name given twice, more files or bytes than it may hold, or an `entry.start` is
refused, and a refused install leaves nothing behind. Nothing from a package is run on your computer, and it is
installed as plain files (`0644`: nothing is made executable, whatever the package says). An address is
fetched over `https://` only, without your cookies or credentials, and the sha256 of the bytes is recorded in
`<OPEN_ARTIFACT_HOME>/types.json` with where they came from.

The same id with another `uid` is another type: `types install` refuses it and asks for `--as <id>`. `types update`
reads the recorded source again and installs it only when it is still the same `uid`. Uninstalling leaves the
artifacts made with the type where they are; they open again once it is installed again.

## Publish to a site

A Node site you publish to (see [Hosting](hosting.md)) can keep your types too, so the artifacts you make with them
open there for the people you share them with.

```bash
open-artifact types publish trip-planner                       # to the default site; private
open-artifact types publish trip-planner --remote work --visibility site
open-artifact publish art_x9k2 --with-type                     # the type first (if the site lacks it), then the artifact
open-artifact types unpublish trip-planner --remote work
```

- **What goes.** A type of your own: a user type, one of an extra root, or one of a project you trust. Not a built-in
  type (every site has those) and not one you installed (its author publishes it). Only a type whose page the site
  serves as it is: an `index.html` with a `// artifact.json` declaration, no `entry` of its own, not a page type
  (`openArtifact.style: "page"`). It must have a `uid`.
- **How it goes.** `types publish` packs it as `types pack` does (`types check --for-share` first; any error refuses
  it) and sends the package. The site checks it exactly as `types install` does before it keeps anything, and nothing
  from it ever runs there: its page runs on the artifact's own page host, in the same restricted frame as an installed
  type, under a Content-Security-Policy made from its `openArtifact.network` list.
- **The id is the site's.** One id names one type on a site. A package with another `uid` under an id someone took is
  refused, naming the uid that has it; give your type another slug. Publishing the same `uid` again is a new version,
  which only you (or a site admin) may publish; the same version with other contents is refused (raise `version`),
  and the same bytes again change nothing.
- **Who sees it.** `--visibility private` (the default for a new type: you and the site admins), `site` (everyone with
  an account there) or `link` (anyone who names it). Visibility decides who lists and downloads the package; it never
  decides who runs it: anyone who may open an artifact of the type runs it. A new version keeps the visibility unless
  you give another.
- **Artifacts of it.** `open-artifact publish <id>` of an artifact whose type the site does not have is refused with
  the type's id and both commands to run. `--with-type` publishes the type first, with `link` visibility, then the
  artifact. The site takes the artifact only with a type of the `uid` it was made with (`type_mismatch` otherwise).
  Automatic publishing leaves these artifacts alone: their type goes to a site by your hand.
- **New versions.** An artifact open on the site picks up a new version at once: its page reloads with the new files
  and the new network list.
- **Unpublish.** While artifacts still use the type it is only delisted: no longer listed or downloaded, no new
  artifacts of it, and the ones there keep opening. With none left, the site deletes it. Publishing it again lists it
  again.
- **Yours to do.** Publishing and unpublishing a type, and `--with-type`, are refused from inside an agent's session,
  whatever the site lets agents publish. An agent on the site is told that a published type's text is its
  publisher's, as with an installed one.

Who may publish types at all is the site's choice (`OA_TYPES_PUBLISH`: site admins by default).

## Move an artifact to another computer

Download the artifact as **Whole folder (.zip)** from its Export panel (the `artifact.archive` route), then on the
other computer:

```bash
open-artifact import ./trip-to-porto.zip                 # into the home workspace
open-artifact import ./trip-to-porto.zip --folder ~/trips/porto
```

An artifact records the `uid` of the type it was made with (`typeUid` in `.artifact.json`, and `typeSource`: the
package's address or file name). It opens only with a type of that uid, so a different type that happens to have the
same id never opens it. When this computer has no such type, `import` answers `type_missing` with the type's id, uid
and where it came from: install that type, then import again. The zip is checked like a package before anything is
written, and nothing in it is run.

## Not yet

Installing a type from a site by its link, and a page that lists a site's types, are not available yet.
