# `npx skills` CLI contract

Status: research snapshot taken 2026-08-20. This document pins the observed
release to `skills@1.5.23` and separates public documentation, versioned source
behavior, and read-only runtime evidence. It is intended for an adapter around
the CLI, not as a promise that future releases preserve implementation details.

## Scope and evidence

The npm package is named `skills`, exposes the `skills` and legacy `add-skill`
bins, and declares Node `>=22.20.0` in this release's package metadata
([package.json](https://github.com/vercel-labs/skills/blob/v1.5.23/package.json#L1-L30)).
The npm release page is [skills 1.5.23](https://www.npmjs.com/package/skills/v/1.5.23).
The source was inspected at tag `v1.5.23`, which resolves to commit
[`435076e78988e1e6ec40d00b0b1d76bdbbc5419a`](https://github.com/vercel-labs/skills/commit/435076e78988e1e6ec40d00b0b1d76bdbbc5419a).

Labels used below:

- **Documented** means the release README or the release help text describes
  the behavior. The README documents source forms and the add, list, remove,
  and update workflows ([source forms](https://github.com/vercel-labs/skills/blob/v1.5.23/README.md#L28-L48),
  [add options](https://github.com/vercel-labs/skills/blob/v1.5.23/README.md#L72-L82),
  [other commands](https://github.com/vercel-labs/skills/blob/v1.5.23/README.md#L133-L157),
  [update](https://github.com/vercel-labs/skills/blob/v1.5.23/README.md#L174-L199),
  [remove](https://github.com/vercel-labs/skills/blob/v1.5.23/README.md#L211-L250)).
- **Release behavior** means the tagged source and its tests implement it, but
  the README does not necessarily promise it as a long-term API.
- **Observed** means the command was run read-only in this worktree. No `add`,
  `remove`, `update`, or `experimental_install` command was run, so all
  mutation behavior below comes from official source and tests.

## Short contract

Use an argument vector for the command and parse only the stdout of
`skills list --json` as structured data. Human output and errors have no
documented machine-readable schema. `list --json` is the only identified
structured boundary: it emits a JSON array with seven fields per installed
skill and no ANSI escape sequences ([implementation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/list.ts#L113-L128),
[tests](https://github.com/vercel-labs/skills/blob/v1.5.23/src/list.test.ts#L92-L155)).

The list object does not contain a resolved Git commit, branch/tag revision,
or content hash. Those values are retained in lockfiles and are used by
update/restore, but are not exposed by the list JSON projection
([global lock schema](https://github.com/vercel-labs/skills/blob/v1.5.23/src/skill-lock.ts#L6-L60),
[local lock schema](https://github.com/vercel-labs/skills/blob/v1.5.23/src/local-lock.ts#L5-L60)).

## Commands and argument grammar

The top-level grammar is `skills <command> [options]`. The release source
dispatches the following aliases: `add`/`a`/`i`/`install`, `remove`/`rm`/`r`,
`list`/`ls`, and `update`/`upgrade`/`check`; `experimental_install` is a
separate restore command ([help text](https://github.com/vercel-labs/skills/blob/v1.5.23/src/cli.ts#L105-L199),
[dispatch](https://github.com/vercel-labs/skills/blob/v1.5.23/src/cli.ts#L299-L412)).

| Command | Accepted form in `1.5.23` | Scope and status |
| --- | --- | --- |
| `list` | `skills list [--global] [--agent <agent>...] [--json]` (`ls` alias) | Project scope is the default. `--global` selects the global inventory. `--json` is release behavior, not documented in the README ([parser and scope](https://github.com/vercel-labs/skills/blob/v1.5.23/src/list.ts#L55-L111)). |
| `add` | `skills add <source> [options]` (`a`, `i`, `install`) | One source is consumed. Default install is project scope; `-g` selects global. `--list` enumerates a source without installing it ([runner](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L1037-L1069), [parser](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L2156-L2228)). |
| `remove` | `skills remove [<skill>...] [options]` (`rm`, `r`) | Project scope is default; `-g` selects global. `--all` or `--skill '*'` targets all selected skills ([runner](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.ts#L61-L90), [parser](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.ts#L383-L429)). |
| `update` | `skills update [<skill>...] [-g\|--global] [-p\|--project] [-y\|--yes]` (`upgrade`, `check`) | Named skills choose the indicated scope; without names the scope is selected from flags, non-interactive mode, or a prompt ([parser and scope resolution](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L60-L165)). |
| `experimental_install` | `skills experimental_install` | Reads the project's `skills-lock.json` and replays its sources. It is in release help/source but absent from the README command list, so treat it as experimental ([dispatch/help](https://github.com/vercel-labs/skills/blob/v1.5.23/src/cli.ts#L105-L199), [implementation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/install.ts#L9-L97)). |

### Source grammar for `add`

The documented sources are GitHub shorthand (`owner/repo`), full GitHub URLs,
GitHub tree paths, GitLab URLs, arbitrary git or SSH URLs, and local paths
([README](https://github.com/vercel-labs/skills/blob/v1.5.23/README.md#L28-L48)).
The tagged parser additionally accepts a `#ref` or `#ref@skill` fragment,
GitHub/GitLab tree paths, well-known HTTP(S) sources, and direct download
URLs ([parser](https://github.com/vercel-labs/skills/blob/v1.5.23/src/source-parser.ts#L204-L234),
[parser](https://github.com/vercel-labs/skills/blob/v1.5.23/src/source-parser.ts#L272-L480)).
The parser collects positional source tokens, but the runner uses `args[0]`; an
adapter should pass exactly one source.

The supported option grammar in this release is:

```
add:
  -g, --global
  -a, --agent <agent>...       repeatable; values continue until the next flag
  -s, --skill <skill>...       repeatable; values continue until the next flag
  -l, --list
  -y, --yes
      --copy
      --metadata <json>        required valid JSON value
      --subagent <name>...      repeatable values
      --all
      --full-depth

remove:
  -g, --global
  -a, --agent <agent>...
  -s, --skill <skill>...
  -y, --yes
      --all

update:
  -g, --global
  -p, --project
  -y, --yes
  <skill>...                    positional names
```

The option names and wildcard behavior are in the tagged parsers and the
release help ([add parser](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L2156-L2228),
[remove parser](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.ts#L383-L429),
[update parser](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L60-L78),
[help](https://github.com/vercel-labs/skills/blob/v1.5.23/src/cli.ts#L105-L199)). Unknown flags are ignored by these current parsers; this is
release behavior and should not be relied upon for validation. Invalid
`--metadata` JSON is a parse error.

## `list --json` schema

The JSON output is pretty-printed to stdout. An empty inventory is exactly an
empty JSON array (`[]`). Each non-empty object is constructed with these keys
in the tagged source ([implementation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/list.ts#L113-L128)):

| Field | Current value | Compatibility meaning |
| --- | --- | --- |
| `name` | Skill name string | Required identity used by remove/update. |
| `path` | Canonical installed path string | Local-sensitive; do not display or compare across machines as an identifier. |
| `scope` | `project` or `global` | Reflects the selected inventory. |
| `agents` | Array of agent **display names** | These are presentation names, not stable agent IDs. |
| `source` | Lock entry source string, or `null` | Missing lock entry/provenance is represented as `null`. |
| `sourceUrl` | Lock entry source URL string, or `null` | May retain a git/GitLab URL needed for replay. |
| `sourceType` | Lock entry type string, or `null` | Current parser types include `github`, `gitlab`, `git`, `local`, `well-known`, and `download` ([types](https://github.com/vercel-labs/skills/blob/v1.5.23/src/types.ts#L104-L112)). |

The release tests assert valid JSON, no ANSI, the seven provenance fields, and
`null` values when no matching lock entry exists
([list tests](https://github.com/vercel-labs/skills/blob/v1.5.23/src/list.test.ts#L92-L155)).
The output does not include `ref`, resolved commit, `skillFolderHash`,
`computedHash`, install timestamps, plugin metadata, or an `origin` field.
That omission is source behavior, not a documented promise about future JSON.

## Source, revision, and lock evidence

There are two lockfile formats and they are not interchangeable:

| Lockfile | Current schema | Fields relevant to source/revision |
| --- | --- | --- |
| Project `skills-lock.json` | Version `1`, intended for VCS | `source`, optional `sourceUrl`, `ref`, `sourceType`, optional `skillPath`, required `computedHash`, optional `subagents` and `wellKnownDigest` ([schema and write path](https://github.com/vercel-labs/skills/blob/v1.5.23/src/local-lock.ts#L5-L123)). |
| Global `.skill-lock.json` | Version `3`, stored under `$XDG_STATE_HOME/skills` or `~/.agents` | `source`, `sourceType`, `sourceUrl`, optional `ref`/`skillPath`, required `skillFolderHash`, `installedAt`, `updatedAt`, and optional plugin/source metadata ([schema and path](https://github.com/vercel-labs/skills/blob/v1.5.23/src/skill-lock.ts#L6-L73)). |

`ref` is an optional source reference supplied by the source grammar. It is
not a guarantee that the CLI records or exposes a resolved commit. Project
`computedHash` is a SHA-256 over sorted skill-folder files (excluding `.git`
and `node_modules`); global `skillFolderHash` is normally a GitHub tree hash or
a local content hash fallback ([project hashing](https://github.com/vercel-labs/skills/blob/v1.5.23/src/local-lock.ts#L140-L181),
[global hash/write](https://github.com/vercel-labs/skills/blob/v1.5.23/src/skill-lock.ts#L120-L125),
[add lock writes](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L1812-L1938)).
These hashes are change detectors, not package versions or a resolved source
revision.

Source normalization preserves enough information for replay. In particular,
generic git/GitLab entries retain `sourceUrl`; GitHub shorthand is normalized
for lock storage ([source handling](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L80-L102)).
Update reconstructs a source from `source`, `sourceUrl`, `ref`, and `skillPath`
when possible ([update source builder](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update-source.ts#L17-L149)).

Compatibility implications:

- Do not infer source revision from `list --json`; read the applicable lockfile
  only when the integration explicitly needs `ref` or hash evidence.
- A branch or tag reference without a resolved commit is not reproducible if
  its upstream content changes.
- The global reader treats a lock version older than the current version as
  empty, while the project reader similarly rejects unsupported versions; a
  lockfile upgrade can therefore lose discoverable provenance unless the
  original file is preserved ([global reader](https://github.com/vercel-labs/skills/blob/v1.5.23/src/skill-lock.ts#L75-L103),
  [project reader](https://github.com/vercel-labs/skills/blob/v1.5.23/src/local-lock.ts#L62-L100)).

## Command behavior

### Add

`add` resolves a source, discovers skills, selects agents, prompts for choices
and confirmation unless `--yes` applies, installs into project or global scope,
and writes the corresponding lock entry. `--all` implies wildcard skill/agent
selection and confirmation bypass in this release ([runner](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L1037-L1082),
[lock writes](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L1812-L1938)).
`--list` prints discovered skills and exits without installation
([implementation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L1246-L1293)).

There is no structured success or per-skill result output. Failed targets are
logged after the install loop; the current implementation does not set a
nonzero exit code for every partial failure, while fatal/catch paths use
`process.exit(1)` ([result handling](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L2036-L2067)).
Treat this as release behavior, not an atomicity or per-item status contract.

### Remove

`remove` scans the selected scope, optionally filters by agents, confirms the
target set, removes selected skills, and reports completion. Empty inventories
and named no-match cases return from the runner without setting a nonzero exit
code; `--all` combined with named skills is rejected with exit status 1
([selection and confirmation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.ts#L92-L223),
[tests](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.test.ts#L67-L132)).
Prompt cancellation calls `process.exit(0)`; individual removal failures are
logged and collected rather than exposed as a structured result
([removal loop](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.ts#L225-L380)).

### Update

`update` reads lock entries, compares the recorded folder hash with upstream,
and invokes the add path for changed skills. It skips entries that cannot be
reconstructed or tracked, including local sources and entries without the
required path/hash. Global and project updates use separate lockfiles and
source reconstruction paths ([global update](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L478-L725),
[project update](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L727-L935)).
When one or more updates fail, the runner sets `process.exitCode = 1`; a run
with no failures completes with the normal success status
([runner](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L959-L1019)).

The selected scope is deterministic in non-interactive mode: named skills plus
no scope update both inventories; `--global` or `--project` selects one; with
no names, `--yes` or a non-TTY chooses project when project skills exist and
otherwise global. Interactive scope selection is a prompt and can cancel
([scope resolution](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L117-L165)).

### Lockfile restore (`experimental_install`)

The command reads only the project's `skills-lock.json`, groups entries by
replayable source, and calls the add path with the recorded skill names,
universal agents, and `yes: true`. Generic git/GitLab entries need
`sourceUrl`; entries without enough source information are logged and skipped
([restore implementation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/install.ts#L18-L82)).
Node-module entries are delegated to the experimental sync path
([restore implementation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/install.ts#L84-L97)).

This is source replay, not verified restoration: the implementation does not
compare the recorded `computedHash` before or after install, does not restore
the global `.skill-lock.json`, and does not pin an absent `ref` to a commit.
The README does not list this command, so these are current release semantics,
not documented compatibility guarantees.

## Exit status, streams, and cancellation

The main entrypoint leaves successful runs at exit status 0 and finalizes with
the current `process.exitCode`; unknown commands set exit status 1
([main dispatch/finalization](https://github.com/vercel-labs/skills/blob/v1.5.23/src/cli.ts#L299-L412)).
The following table is the narrowest useful integration contract supported by
the source/tests:

| Situation | Status in `1.5.23` | Output contract |
| --- | --- | --- |
| `list --json`, including empty list | 0 | JSON array on stdout; no ANSI. |
| Invalid list agent | 1 | Human diagnostic; source uses `console.log`, not an error JSON object ([list](https://github.com/vercel-labs/skills/blob/v1.5.23/src/list.ts#L76-L111)). |
| Add/remove/update fatal or parse error | Usually 1 | Human text; no structured error schema. CLI parse errors use `console.error` ([dispatch parse errors](https://github.com/vercel-labs/skills/blob/v1.5.23/src/cli.ts#L350-L365)). |
| Prompt cancellation | 0 | Cancellation text, then process exit; add/remove/update prompt branches call `process.exit(0)` ([add](https://github.com/vercel-labs/skills/blob/v1.5.23/src/add.ts#L1360-L1372), [remove](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.ts#L183-L223), [update](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L138-L162)). |
| Remove empty/no-match | 0 | Human `none found`/no-match output; no structured result ([remove](https://github.com/vercel-labs/skills/blob/v1.5.23/src/remove.ts#L92-L138)). |
| Update partial failure | 1 when failure count is recorded | Human summary; child add stdout/stderr is piped and not forwarded as a structured result ([global child invocation](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L698-L712), [final status](https://github.com/vercel-labs/skills/blob/v1.5.23/src/update.ts#L959-L1019)). |
| `experimental_install` per-source error | No aggregate status is established by `install.ts` itself | Error is logged and processing continues; nested add/sync behavior can affect process termination ([install](https://github.com/vercel-labs/skills/blob/v1.5.23/src/install.ts#L31-L97)). |

The CLI primarily writes human output with `console.log`; parse errors use
`console.error` ([add parser error path](https://github.com/vercel-labs/skills/blob/v1.5.23/src/cli.ts#L350-L365)).
The `npx` wrapper itself can write notices to stderr, so an integration must
parse stdout rather than require stderr to be empty. There is no documented
JSON error envelope or stable mapping of every failure to stderr.

Prompt cancellation is the only application-level cancellation behavior
verified in source: it is a successful process exit. `experimental_install`
passes `yes: true`, so it does not prompt. The CLI does not expose an
`AbortSignal` or a resumable cancellation result; an external SIGINT or killed
process remains process-level termination, not a supported structured API.

## Read-only runtime receipt

Commands run against the pinned package on 2026-08-20:

```text
npx -y skills@1.5.23 --version
  exit 0
  stdout: 1.5.23\n
npx -y skills@1.5.23 --help
  exit 0
  stdout: release help text, including list --json and experimental_install
  stderr: npx wrapper notices only

npx -y skills@1.5.23 list --json
  exit 0
  stdout: []\n       (this project had no project-scoped skills)
  stderr: npx wrapper notices only

npx -y skills@1.5.23 list --global --json
  exit 0
  stdout: valid JSON array; object keys exactly:
          agents, name, path, scope, source, sourceType, sourceUrl
  stderr: npx wrapper notices only
```

The global command's installed names and paths were intentionally redacted from
this receipt. The commands were read-only; no add, remove, update, or restore
operation was invoked.

## Adapter recommendations

For a compatibility layer around this release:

1. Pin the package version and invoke `skills` with an argument array.
2. Use `list --json` for inventory and accept the seven known fields, preserving
   unknown future fields. Treat `path`, agent display names, and normalized
   source strings as presentation/provenance data, not stable IDs.
3. Treat null provenance as valid and do not expect a revision or hash in list
   output. Read lockfiles separately for hash/ref evidence.
4. Treat mutation output as human-only. Use exit status plus bounded heuristics;
   do not assume atomicity, per-skill JSON results, or a universal stderr rule.
5. Treat prompt cancellation (exit 0) as cancellation, not successful mutation,
   when a prompt-capable command is used. Use `--yes` only when the caller has
   already authorized the mutation.
6. Treat `experimental_install` as source replay with no hash verification and
   no global-lock restore. It should not be presented as reproducible lockfile
   restore without an additional verification layer.
