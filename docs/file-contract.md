# File contract

A file contract states, per path, what DeepCode may read, write, or execute. It
is optional: with no contract file, nothing changes.

It exists because `settings.json` permission rules match on the **tool**, not the
path. `Bash(git diff:*)` and `WebFetch(domain:github.com)` work well, but there
is no way to write "never read `.env`" — the only path-aware match is a prefix
compare against the tool's primary argument, and a real `file_path` is usually
absolute, so `Read(.env*)` matches nothing at all.

> **This is policy, not a security boundary.** A contract constrains tool calls
> that go through DeepCode's dispatcher. It does not constrain what a shell
> command does after Bash starts — `cat .env` is a string, and statically
> analysing shell to decide otherwise would be guesswork that reads as a
> guarantee. Only the **sandbox** bounds Bash. See
> [security-model.md](security-model.md).

## Getting started

```bash
deepcode contract init            # write the recommended contract
deepcode contract show            # what is active, and what it governs
deepcode contract check .env      # the verdict for one path, all three axes
```

## Where it lives

The first file found wins; there is no merging.

1. `<project>/.deepcode/file-contract.yaml`
2. `<project>/.deepcode/file-contract.yml`
3. `~/.deepcode/file-contract.yaml`
4. `~/.deepcode/file-contract.yml`

Project beats user rather than merging, so "which file denied this?" is always
answerable by opening one file.

## Format

```yaml
version: 1

defaults:
  read: allow
  write: allow
  execute: allow

rules:
  - glob: '**/.env*'
    owner: human
    read: deny
    write: deny
    reason: 'Secrets are human-only.'

  - glob: '{AGENTS.md,CLAUDE.md,DEEPCODE.md}'
    owner: shared
    write: ask
    reason: 'Agent instructions shape every future run — review before writing.'
```

| Field                    | Values                         | Meaning                                                      |
| ------------------------ | ------------------------------ | ------------------------------------------------------------ |
| `glob`                   | pattern                        | Which paths this rule covers (workspace-relative)            |
| `read` `write` `execute` | `allow` \| `ask` \| `deny`     | Decision for that axis; omit an axis to say nothing about it |
| `owner`                  | `human` \| `agent` \| `shared` | Responsibility, not access control — it shapes wording       |
| `reason`                 | free text                      | Shown verbatim when the rule produces `ask` or `deny`        |

`ask` is the useful middle state: the change is legitimate but wants eyes on it
before it lands. Without it, everything high-impact has to be either waved
through or forbidden.

### Glob syntax

| Pattern  | Matches                                |
| -------- | -------------------------------------- |
| `*`      | Any characters within one path segment |
| `**`     | Any characters across segments         |
| `a/**/b` | Also matches `a/b` — zero directories  |
| `?`      | Exactly one non-separator character    |
| `{a,b}`  | Either alternative                     |

Everything else is literal, including `.`, so `**/.env*` cannot accidentally
match `axenv`.

### Precedence

1. The **more specific** glob wins — fewer `**`, then more path segments, then
   more literal characters.
2. On an exact tie, the **later** rule wins.

So a broad rule can be narrowed further down the file without reordering.

### Paths outside the workspace

A contract has no authority over `/etc`, so paths resolving outside the project
get no verdict at all and fall through to the tool rules and the sandbox.

Note that path resolution is string math — it does not call `realpath`. A
symlink inside the workspace pointing outside still looks inside. This is the
same reason the box at the top matters: the sandbox is the boundary.

## Self-protection

Writes to `.deepcode/file-contract.yaml` (and `.yml`) are always denied,
regardless of what the file says. A contract that can grant itself
`write: allow` is not a contract. Reading it stays allowed — auditing it is the
whole point.

## When it is malformed

An unparseable contract is reported as **invalid**, not treated as absent.
Falling back to "no contract" would silently drop every `deny` the author wrote,
which is the worst possible failure for this particular file. DeepCode keeps
running under the tool rules alone and says so, naming the file and line.

The parser is strict on purpose: unknown keys, unknown decision values, a rule
with no `glob`, or a rule that decides nothing are all errors. A silently-ignored
line here is a permission quietly granted.

## Which tools it governs

`Read`, `Grep`, `Glob`, `Write`, `Edit`, `NotebookEdit`.

**`Bash` is deliberately absent.** Everything else is ungoverned too — a tool
whose effect cannot be pinned to a single path gets no verdict rather than a
guessed one.

A contract `deny` cannot be waived, including by `bypassPermissions`. It is a
standing statement about a path, not a per-call prompt, so the mode that exists
to skip prompts has no business clearing it — otherwise the contract's strongest
sentence would also be its easiest to disable. A contract `ask` is an ordinary
approval and follows the mode and hook chain like any other.

## Interaction with `settings.json`

The two rule sets compose by **most-restrictive-wins**:

```
final = mostRestrictive(toolVerdict, pathVerdict)      deny > ask > allow
```

A contract can only tighten. It never overrides a `deny` in `settings.json` into
an allow, and an absent contract yields no verdict at all — which is what makes
"no contract file, no behaviour change" exactly true rather than approximately
true.
