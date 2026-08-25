# Changelog

All notable changes to DeepCode are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### ⚠️ Breaking

- **`deepcode mcp serve` now applies your permission settings.** It executed
  Read/Write/Edit/Bash for any connected MCP peer with no mode, no permission
  rules, no file contract and no `PreToolUse` hooks — the same shape as the
  `runAgent` bypass fixed in #181, in a different entry point. Every call now
  goes through the central gate, a call that would need approval is **refused**
  (nobody is attached to that pipe to approve it), and a permissive
  `permissions.defaultMode` is clamped to `default` exactly as a scheduled job's
  is. A peer can now do what `permissions.allow` says it can and nothing else,
  so anyone relying on the old behaviour must add rules — or start the server
  with an explicit `--mode`. `--sandbox` also applies now; it did not before.

### ✨ Added

- **Persistent shells now last a whole CLI session, and `/shells` shows them.**
  The registry landed in #273 owned by a single `runAgent` call, which meant a
  shell opened in one turn was gone by the next — a slower `Bash` with extra
  steps. The REPL now owns one registry for the session and threads it through
  every turn, so `cd`, `export`, and an activated virtualenv survive from one
  message to the next.

  `/shells` lists what is open and where each started; `/shells close <id>`
  closes one and whatever is still running in it. Worth having because the
  change is what makes these processes outlive a turn: without a view of them,
  the user has no way to see or stop something the agent left running.

  Everything closes when the session ends, including when it ends by throwing —
  these are real processes in their own process group, so they do not die with
  the CLI. Background tasks and sub-agents deliberately do **not** share the
  session's shells: two agents interleaving commands in one shell would each be
  wrong about its state.

- **A shell that survives between tool calls** (#273) — `ShellOpen` / `ShellRun` /
  `ShellClose` / `ShellList`. Every `Bash` call is a fresh process, so `cd`,
  `export`, and `source venv/bin/activate` were forgotten the moment they
  returned; the workaround was re-pasting the whole prefix into every command,
  which still could not hold a running dev server.

  Not a PTY. That would mean `node-pty`, a native dependency needing a build for
  every platform the desktop ships to, bought for full-screen programs that are a
  small share of the value. This runs over pipes with a per-session random
  sentinel, and says plainly in its description that `vim` and `top` do not work.
  Commands run with stdin closed so `cat` cannot swallow the sentinel, and stderr
  is merged at the shell so the streams interleave in true order.

  Interrupting an overrunning command signals the shell's **children**, not its
  process group — signalling the group kills a non-interactive bash, which would
  lose the session every time. Lifetime is guaranteed rather than remembered: a
  run that opens its own registry closes every shell before returning, including
  when the loop throws. Idle shells close themselves and there is a cap on how
  many can be open.

- **The agent can search its own past sessions** (#272) — `SessionSearch` finds
  text across previous sessions and `SessionRead` follows a hit into the
  surrounding conversation. Every session was already on disk as JSONL and
  nothing could read it back, so "how did we fix this last month" was
  unanswerable while the answer sat in a file the agent wrote.

  Scoped to the current workspace by default, matched on a resolved path boundary
  so `/a/project` cannot capture `/a/project-two`. **Neither tool takes a scope
  argument**: widening the search is a privacy decision, and a parameter would let
  the model consent to reading another project's history on the user's behalf.
  `SessionRead` enforces the same rule, so knowing an id is not authorisation. No
  index — a scan is fast at this volume, and an index is a second copy of the
  truth that can disagree with it.

- **Tools declare how they should be drawn** (#271). Every tool call rendered as
  the same grey blob: an `Edit` showed its result sentence but never the change,
  a `Bash` showed output with no sign of which command produced it. A tool now
  declares a render intent beside its schema — `Bash` is `terminal`,
  `Edit`/`Write`/`NotebookEdit` are `diff` — and the desktop draws real coloured
  `+`/`-` lines and a shell transcript. The mapping lives in core so the CLI and
  the extension read one answer instead of each hardcoding tool names.

  Presentation is a pure function of the call's **arguments**, never the result or
  the filesystem, so a replayed session renders as it did live. That is why
  `Write` renders as wholly added: its arguments genuinely do not say what the
  file held before.

- **A backstop deadline on every tool call** (#270). Only `Bash` bounded itself;
  a `Grep` against a stalled mount could hang the turn forever with nothing on
  screen but a blinking cursor. Deliberately generous (10 min default) so each
  tool's own limit fires first and produces the more specific error — this only
  covers the case where the inner limit never fires. A caller-requested `timeout`
  always wins when longer. On a side-effecting tool the message says the effect is
  **unknown** rather than implying nothing happened.

- **The loop notices when the model is repeating itself** (#269). The most
  expensive agent failure is the loop that neither errors nor terminates: same
  tool, same arguments, same answer, quietly spending the budget. At 3, 5, and 8
  consecutive identical calls an escalating reminder is injected. It has no veto,
  which is what makes false positives affordable. Excluded tools are transparent
  to the chain rather than resets, so a bookkeeping call interleaved into a loop
  cannot launder it, and calls the gate refused still count.

- **`thread/delete`** — the protocol could list, fork and archive threads but not
  delete one, so the desktop deleted session files through Tauri instead. The
  app-server is the single owner of thread storage; a client removing files
  behind it can pull the ground out from under an open writer. Served under the
  existing `threadManagement` capability, with the local writer kept as the
  fallback for a sidecar too old to know the method.

- **Change ledger records provenance.** Each entry now carries `derivedFrom` —
  the files the turn read before making that change — answering the question
  after "what changed" and "how do I undo it": _what was it derived from_. That
  is what you ask when a generated file is wrong and you need to know which
  input to fix. Shown by `deepcode ledger show`. Built on the existing ledger
  rather than a second store.

  It is observed, not declared: only `Read` counts (`Grep`/`Glob` take a search
  root and return many paths — calling the root an input claims a derivation the
  turn did not make), a failed read is not an input, and the file being written
  is excluded so an `Edit` does not look self-derived. Absent rather than empty
  when there is nothing to say.

- **Trigger sources for scheduled jobs** — a job can now fire from a calendar
  file or a file change, not only a clock. `{ "kind": "ics", "path": "team.ics",
"match": "release" }` fires when a matching event starts;
  `{ "kind": "file", "paths": ["schema.json"] }` fires when a watched path
  changes. `schedule` still means cron and existing jobs need no migration.
  Everything is **polled** by the existing `scheduler run`, so there is no
  daemon and no way for a trigger to fire while nothing is listening. See
  [`docs/triggers.md`](docs/triggers.md).

  Standard iCalendar text is the only calendar input — no vendor SDK, no OAuth
  to a calendar service. The reader handles `DTSTART`, folded `SUMMARY` lines and
  `RRULE FREQ=DAILY`/`WEEKLY` with `INTERVAL`/`BYDAY`/`UNTIL`/`COUNT`, and
  **reports** anything it cannot express rather than dropping it: a silently
  ignored `RRULE` is a job that never fires, and that failure is
  indistinguishable from "nothing was scheduled". All-day entries never fire —
  they name a day, not a moment. A trigger decides when, never what may happen:
  every scheduled run still goes through the unattended clamp.

- **The in-app updater has a feed.** `tauri.conf.json` has had
  `updater.active: true` and a committed public key since the desktop app
  shipped, pointing at a `latest.json` that nothing ever produced — so the app
  polled, 404ed, and silently never updated. The release pipeline now enables
  updater artifacts, signs them, writes the manifest and attaches it, all gated
  on a signing key being present so a credential-less release still builds. When
  the key is absent the release body says the feed is missing, because an
  updater polling a 404 forever looks identical to one that has found no update.
  Generating the key pair remains yours — see `docs/RELEASING.md`.

### 🔒 Security

- **A sub-agent did not inherit the file contract.** The `Task` delegation
  forwarded mode, permission rules, hooks, sandbox config and auto-mode — every
  gate except the contract. So "never read `secrets/**`" bound the main agent
  and said nothing to the sub-agent it spawned to do the reading, and since a
  contract `deny` is deliberately not waivable, this was the one gate that was
  supposed to hold no matter what. A regression test asserts the secret never
  reaches the provider.
- **`Grep` and `Glob` returned results the contract denies reading.** Both take
  a search _root_, so the pre-call verdict only ever covered where the search
  started; a search rooted at the workspace was allowed and then handed back
  matches from denied paths, with the matched line attached. Results are now
  filtered through the same `evaluatePath` the gate uses — no second glob
  dialect to drift — and the output ends with a count of what was withheld,
  never with the paths. `ask` is not filtered: mid-search there is nobody to
  ask, and a hit is not yet a read.
- The plugin capability bridge passed no contract into the tools it executed, so
  a plugin's `Grep` skipped the same filter.
- **`--sandbox read-only` was not read-only on Linux.** `buildLinuxBwrapArgs`
  ended with an unconditional `--bind <cwd> <cwd>`, and bwrap applies binds in
  order with the last one winning — so the read-only bind that the mode had
  correctly asked for was overwritten a few arguments later, and a command could
  write to the workspace. macOS never had this: its profile grants writes only
  from `allowWrite`, which read-only leaves empty. #226 introduced the mode axis
  and verified it on macOS; this is the half nobody looked at. Callers using the
  legacy `enabled: true` shape are unaffected.

### 🐛 Fixed

- **A rethrown error keeps the one that caused it.** Five places wrapped a
  caught error in a new `Error` carrying only its `.message` — settings and
  trust-store loading, the hook trust file, and the MCP `headersHelper` — so a
  parse failure or a spawn error arrived with the original stack, `errno` and
  `path` discarded. They now pass `{ cause }`, and ESLint's `preserve-caught-error`
  keeps the next one from being written.

- **Tool output could flood the model's context, or vanish** (#268). Two defects,
  one cause: nothing central bounded what a tool result put in front of the
  model, so each tool improvised.

  `WebFetch` improvised by not bounding at all — it returned the whole response
  body, capped only at 5 MiB of _bytes_. A 5 MiB page is roughly 1.5M tokens; one
  call ended the session. `Bash` improvised by destroying evidence: it sliced at
  30 KB and wrote the remainder nowhere, and the tail of a failing test run is
  exactly the part worth reading.

  A spill policy now runs on every tool result. Anything at or under the
  threshold passes through untouched; anything over becomes a head-and-tail
  preview naming the file holding the full text, saved beside that session's
  snapshots and retrievable with `Read`. Both ends, weighted toward the tail,
  because stack traces and exit codes live at the end. A host with no filesystem
  still gets the bound and is told the output was not saved rather than shown a
  path that does not exist.

- **Release notes come from the CHANGELOG.** `gen-release-notes.ts` walked the
  commit range, and with no preceding tag it fell back to the root commit — which
  is how v0.3.0's release page came to say "0 commits." after #250 fixed the
  shallow clone. It now takes the tagged version's CHANGELOG entry, which is
  written for humans and groups changes by what they mean rather than by the verb
  the commit happened to start with. Repo-relative links are rewritten to
  absolute URLs pinned at the tag, since a release body does not render inside
  the repository. Falling back to commits still works and says so in the body.
- **The desktop sidebar was a second reader of the session directory.** Archive
  and delete went through Tauri while the protocol served the same threads, and
  the list did too — `window.deepcode.sessions.list()` had preferred the
  protocol since #231, but `Sidebar.tsx` bypassed the shim and called
  `listSessions()` directly. All three now go through the owner, and deleting a
  thread removes both its protocol snapshot and its canonical session
  projection: `list` reads both, so removing one left the row reappearing on the
  next refresh as an empty session that could not be opened.
- `deleteSession` refuses a session id that is not a single path segment, before
  removing anything. It ends in a recursive delete of `<root>/<id>`, and `..` —
  the id that resolves to the directory _above_ the sessions root — is spelled
  entirely in characters an id may legitimately contain, so the character-class
  check both it and the thread store relied on admitted it. Every in-tree caller
  validates first; a delete this destructive should not depend on that.
- **`Grep` over a single file no longer prefixes every line with a colon.**
  ripgrep omits the filename when the search path is one _file_ — there is
  nothing to disambiguate — so its `--null` output carries no NUL, and rejoining
  the record as `path:text` with an absent path emitted `:1:hit`. Parsing now
  distinguishes "rg printed no path" from "rg printed an empty field", and the
  separator is written back only where rg wrote one. Such a row is attributed to
  the search root for contract filtering, so the result filter does not depend on
  the pre-call gate having adjudicated that call correctly.
- CI installs ripgrep and sets `DC_REQUIRE_RIPGREP=1`. The `Grep` suite
  self-skips when `rg` is absent, so it may never have run in CI — and it now
  covers ripgrep's `--null` output format, which the tool parses byte for byte.
- **The test suite could re-initialise your own repository.** `git` reads
  `GIT_DIR` from the environment and a git hook sets it, so a fixture calling
  `git init` on a temp directory from inside the pre-commit gate did not
  initialise the temp directory — it re-initialised the developer's checkout as
  bare and wrote the test identity into its config, after which every git
  command there failed with "this operation must be run in a work tree".
  `apps/server/src/workspace-diff.test.ts` was the fixture; the code it tests
  scrubs the environment, the fixture did not. Three other fixtures had each
  grown their own copy of the scrub, two carrying a comment describing this
  precise failure — a convention passed by word of mouth that had stopped being
  enforced. They now share `gitSpawnEnv`, and a check fails the build if a test
  spawns `git` without it.
- **The CLI is published as `@oratis/deepcode`.** 0.3.0 renamed it away from
  `deepcode-cli` because that name belongs to an unrelated project — but
  `@deepcode/cli` was not ours either. The leaf name is unpublished, which is
  what made it look free; the `@deepcode` **scope** holds `@deepcode/tsc` and
  `@deepcode/dcignore`, and npm rejects a publish into a scope you do not own. A
  scope is not claimable by publishing into it, so `pnpm publish` would have
  returned the same 403 the rename was meant to fix. The new name is the
  repository owner's personal scope, which needs no organisation to exist first.
  Nothing was ever published under either old name, so no installed package
  changes. The binary is still `deepcode`.
- A test now asserts that every `npm i -g …` in a current document or in CLI
  source names the package `apps/cli/package.json` publishes. Both renames so far
  moved some install strings and left others behind. It scans the whole
  repository minus an explicit list of historical snapshots, rather than an
  allowlist of the documents somebody thought of — an allowlist has to be
  extended by whoever adds the next document, and stays silent when they forget,
  which is the same shape as the bug it is there to catch.
- `apps/cli/README.md` — the npm landing page — still described the CLI as an
  "M0 骨架，命令入口存在但不能用" and pointed at milestone numbers for when
  features would arrive. It shipped in the package `files` list.

### 📄 Documentation

- **DeepSeek Harness research and adoption plan** (#267) —
  [`docs/research/deepseek-harness.md`](docs/research/deepseek-harness.md) grades
  every claim A/B/C (source read / their docs say so / hearsay, inadmissible),
  and [`docs/DSH_ADOPTION_PLAN.md`](docs/DSH_ADOPTION_PLAN.md) argues each
  candidate proponent / opponent / verdict so the implementation PRs execute a
  decision rather than reopen one. dsh is the closest comparison DeepCode has:
  another DeepSeek-powered coding agent under the same constraints.

### 🚫 Deliberately not adopted

A Cordis-style "everything is a plugin" rewrite: dsh spends **219 packages**
expressing what DeepCode expresses in **4**, and that ratio is what shipping a
third-party plugin ecosystem costs — we do not ship one, so we would pay the cost
and collect none of the benefit. It also self-describes as a developer preview
that _will_ break compatibility, while 0.3.0 is out with npm, VSIX, DMG and an
update feed downstream. Take the discipline, not the framework.

Also rejected: its workflow engine, which introduces model-written code executed
behind a boundary its own docs say is not a security boundary, with no use case
our sub-agents fail to cover. Deferred pending a product decision: the goal
domain and the Ralph loop, which change _when an agent stops_ rather than what it
can do. Reasoning in the adoption plan §2.

## [0.3.0] — 2026-08-08

A workspace-governance layer: what the agent may touch, what it changed, and how
to undo it. Derived from a first-hand study of Floatboat's open **Selfware
protocol** — see [`docs/research/floatboat.md`](docs/research/floatboat.md) for
the research (with evidence grading) and
[`docs/FLOATBOAT_ADOPTION_PLAN.md`](docs/FLOATBOAT_ADOPTION_PLAN.md) for what was
adopted, what was rejected, and where the implementation diverged from the plan.

### ⚠️ Breaking

- **The CLI is published as `@deepcode/cli`, not `deepcode-cli`.** Install with
  `npm i -g @deepcode/cli`. The unscoped name on npm belongs to an unrelated
  project, so it was never ours to publish to. The binary is still `deepcode`
  and nothing about the tool's behaviour changes. (#249)
- **Unattended runs no longer inherit a permissive permission mode.** A
  `permissions.defaultMode` of `bypassPermissions` or `acceptEdits` — chosen for
  interactive convenience — is clamped to `default` for scheduled jobs, which
  run with nobody present to approve anything. Set a job's `profile.mode`
  explicitly to opt back in. The clamp names itself and the fix in the job log
  on the first run after upgrading. (#244)

### 🔒 Security

- **`.env` could be read, and there was no way to say otherwise.** Permission
  rules match on the _tool_; their only path-aware match is a prefix compare
  against an argument that is usually an absolute path, so `Read(.env*)` matched
  nothing. The new [file contract](docs/file-contract.md) adds the missing axis —
  glob × read/write/execute × allow/ask/deny — composed with the existing rules
  by most-restrictive-wins. It can only tighten. (#238, #239)
- A contract `deny` **cannot be waived by `bypassPermissions`**. It states
  something standing about a path rather than prompting about one call, so the
  mode that exists to skip prompts has no business clearing it. (#239)
- Plugin subprocesses are gated by the same path rules; the capability bridge
  previously called the dispatcher without a contract. (#239)
- `/combo` drafts exclude paths the contract denies reading and redact
  credential-shaped values. A rule that stops at the tool call but not at the
  export is not much of a rule. (#243)

### ✨ Added

- **File contract** — `deepcode contract <show|init|check>`. Optional; with no
  contract file, behaviour is unchanged. (#238, #239)
- **Change ledger** — `deepcode ledger <list|show|export|rollback>`. An
  append-only record pairing each mutation with the request that motivated it
  and the checkpoint that reverses it, on two timelines (`changes`,
  `governance`). Stored outside the repository so `git status` stays clean.
  (#240, #241)
- **No Silent Apply** — explain, preview, accept/reject/defer, rollback point
  first. `confirm` is a required argument, so a caller that cannot ask a human
  cannot apply. (#241)
- **`runtime/capabilities`** — a protocol method answering what the runtime may
  write and which actions always stop for a human, distinct from `initialize`'s
  protocol-feature flags. The CLI and app-server build it through one function,
  with a test asserting they agree field-for-field. (#242)
- **`/combo`** — distil a finished thread into a `SKILL.md` draft, with
  `allowed-tools` derived from the tools actually called. (#243)
- **Trigger profiles** — per-job `mode`, `permissions`, and `sandbox` for
  scheduled work. Permissions and sandbox can only tighten. (#244)
- `onApprovalRequired: 'abort'` for scheduled jobs, plus exit code `6`. A job
  whose first write is refused otherwise grinds on and reports a confidently
  wrong result. (#237)
- `deepcode doctor` prints the runtime capability declaration and the
  file-contract warnings. (#242)

### 🐛 Fixed

- Aborting mid-batch left `tool_use` blocks unanswered, which a provider rejects
  on resume. Remaining calls now get an explicit "never ran" result. (#237)
- `docs/cli-flags.md`'s exit-code table contradicted the implementation (it
  listed `3` as "tool denied" and `5` as "API key invalid"). Corrected against
  `apps/cli/src/headless.ts`, which owns the contract. (#237)

### 📄 Documentation

- New: [`docs/file-contract.md`](docs/file-contract.md),
  [`docs/change-ledger.md`](docs/change-ledger.md),
  [`docs/combo.md`](docs/combo.md),
  [`docs/research/floatboat.md`](docs/research/floatboat.md),
  [`docs/FLOATBOAT_ADOPTION_PLAN.md`](docs/FLOATBOAT_ADOPTION_PLAN.md).
- `docs/security-model.md` gains threats #8–#10 and a **residual-risk** section
  stating plainly that the file contract is policy, not a boundary: it does not
  constrain Bash, and only the sandbox does.

### 🚫 Deliberately not adopted

`.self` self-executing distribution (a supply-chain surface for a coding agent),
Floatboat's passive habit observation across files and browser tabs (a privacy
line, and unnecessary — `/combo` gets the value from an explicit invocation),
cross-organisation agent networks, and a second loopback HTTP runtime alongside
the app-server. Reasoning in the adoption plan §3.

## [0.2.0] — 2026-08-02

Largest release so far: the desktop app, VS Code extension, and LSP server stop
being independent runtimes and become thin clients of a single supervised
app-server. Landed as a reviewed 31-PR stack (#180–#210) plus dependency work.

### 🔒 Security

- **The central tool gate could be skipped entirely.** `runAgent` gated dispatch
  behind `if (opts.mode)`, and `mode` was optional — so any caller that omitted
  it bypassed mode policy, permission rules, and the PreToolUse hook chain, and
  every tool call was allowed. Both VS Code entry points and the LSP handler were
  such callers. `mode` is now required, with a fail-safe fallback for untyped
  callers. (#181)
- **Provider credentials left the desktop renderer.** The Tauri WebView no longer
  holds API keys or runs the agent loop; `read_credentials` is replaced by a
  presence-only `credential_status`, and the renderer's read-only file preview
  refuses to resolve the backend credentials path. (#192, #207)
- **Untrusted project settings can no longer widen policy** — provider/base-URL,
  model cost, permissions, sandbox, environment, hooks, MCP, worktree, update,
  and executable config are all gated by directory trust, with leaf-level
  provenance tracking and prototype-pollution rejection. (#197)
- **Project hook commands now require exact-definition review** on top of
  directory trust, with automatic invalidation when a definition changes.
  New `deepcode hooks list|trust|revoke`. (#201)
- **Tauri capabilities cut to least privilege** — the filesystem plugin is
  removed entirely, `dialog`/`opener`/`process` narrowed to single permissions,
  and the provider API dropped from the renderer CSP. (#209)
- **`/add-dir` is enforced.** `permissions.additionalDirectories` was declared in
  the schema but consumed nowhere; it now folds into the sandbox's writable roots
  across every host — CLI, headless, and app-server (desktop/VS Code/LSP). (#214)
- Real cancellation: LSP `abort` previously deleted a bookkeeping entry and
  reported success while the turn kept running. Aborts now propagate through
  providers, pending approvals, and POSIX process groups. (#181, #184)

### ✨ Added

- **App-server** (`deepcode app-server`) — single-owner, line-delimited JSON
  protocol with atomic thread snapshots, orphaned-turn recovery on resume, and
  backpressure that may drop only transient deltas, never completed items.
  (#186, #188, #190)
- **Desktop runtime as a supervised Node 22 sidecar**, checksum-pinned and signed
  before the app bundle. (#187, #189)
- **Canonical session v1** format shared by core and desktop, with a
  cross-process writer lock, legacy dual-read, and exact-line corruption
  diagnostics. Legacy files are never rewritten. (#182, #185, #191)
- **Workspace diff review** (`workspace/diff`) — shell-free Git invocation with
  inherited `GIT_*` stripped, external diff/textconv disabled, and refusal to
  read untracked symlink targets or binary content. (#203)
- **Review findings lifecycle** — `SubmitReviewFinding`, `review/apply` (single
  and batch), and conflict-safe `review/revert` with all-files compare-and-swap
  against exact post-images. Apply and revert run as ordinary turns, so they keep
  normal permissions, approvals, hooks, sandboxing, cancellation, and snapshots.
  (#204, #205, #206)
- **Trust-aware config diagnostics** surfaced through `deepcode doctor`, Desktop
  About, VS Code, and the LSP bridge — value-free, from one shared DTO. (#197, #198)
- **Redacted structured tracing** with a strict metadata allowlist, mode-0600
  bounded NDJSON, and `deepcode diagnostics export`. Best-effort: a broken trace
  sink cannot affect protocol or execution. (#202)
- **Release gates** over real packaged artifacts — bundle budgets, protocol
  journeys, and a thin-client scan asserting clients never import the provider,
  credentials, agent loop, or `RuntimeHost`. npm publication now waits until the
  VSIX and signed DMG succeed. (#208)
- Desktop Playwright protocol journey in CI, driving the production renderer
  bridge. (#193)

### ♻️ Changed

- `RunAgentOptions.mode` is now **required** (breaking for library consumers).
- Host services are assembled once behind `RuntimeHost` instead of per-client. (#184)
- MCP servers and plugins are composed inside a turn-scoped lease with
  deterministic teardown on success, interruption, preprocessing failure, and
  shutdown. Plugin trees are hashed whole and symlinks rejected. (#199, #200)
- `react` 18 → 19, `react-dom` 18 → 19 (React 19 removed the global `JSX`
  namespace; 38 annotations across 25 files now import it explicitly). (#211)
- `vite` 5 → 8 and `@vitejs/plugin-react` 4 → 6. Previously blocked by rolldown
  failing to resolve `openai` from the renderer graph — removing provider code
  from renderer bundles in #192 cleared it. (#212)
- `typescript-eslint` 8.18 → 8.65; root lint is now `--max-warnings=0`. (#213, #210)
- GitHub Actions: `checkout` 6→7, `setup-node` 6→7, `cache` 4→6,
  `download-artifact` 4→8 (v8 fails on digest mismatch instead of warning).
  (#177, #178, #179, #155)

### ⚠️ Upgrade notes

- **The macOS desktop app grows from ~6.7 MB to ~115 MB.** That is the cost of
  bundling a Node 22 sidecar so provider credentials and the agent loop leave the
  WebView. Deliberate trade, measured in #187.
- **Plugins are not OS-sandboxed.** The capability RPC gates the supported plugin
  API; it is not a boundary against a plugin calling Node APIs directly. Earlier
  docs overstated this. Treat third-party plugins as trusted code. (#200, #209)
- `@types/vscode` stays pinned at `^1.85.0` to match `engines.vscode`; raising it
  would drop support for VS Code 1.85–1.124.

## [0.1.6] — 2026-05-28

### 🐛 Critical fix — Bash tool calls were always reporting "error"

The Rust output structs (`ReadOk`, `EditOk`, `BashOk`) returned fields
in snake_case (`exit_code`, `lines_total`, `diff_preview`) while the
TS wrappers read them in camelCase. Result: `r.exitCode` was always
`undefined`, so `undefined !== 0` made every Bash tool result render
with a red `✕ error` badge — even when the underlying command had
exit code 0. Read + Edit silently dropped diff previews + line totals
for the same reason.

Fixed by adding `#[serde(rename_all = "camelCase")]` on the three
output structs. Glob and Grep were already single-word fields, no
change needed.

### Polish carry-over

- **Keyboard shortcuts**: ⌘N starts a new session, ⌘, opens Settings,
  ⌘/ opens About. New `src/lib/keyboard.ts` helper.
- **Switching project now clears chat history** so the next message
  runs against the fresh cwd (was: old conversation lingered with
  new project context).

## [0.1.5] — 2026-05-28

### Polish + dead-code removal

- **Composer `+` menu wired**. Click `+` → popover with three actions:
  Attach file (opens native file picker, inserts `@<absolute-path>`
  into the textarea), Slash command (prepends `/`), Memory note
  (prepends `#`). Replaces the previously-disabled `+` button.
- **Plugins toggle works.** Click the switch on any plugin → writes
  to `settings.disabledPlugins[]` so the change survives restart
  and the agent picks it up on the next turn. Optimistic UI with
  rollback on failure.
- **Dead code removed.** Deleted unused screens (FilePanel.tsx —
  Monaco file panel not surfaced in new shell; legacy Chat.tsx stub;
  Nav.tsx — only the type was needed, moved to `src/types/screens.ts`;
  Terminal.tsx — xterm side-pane wasn't wired in). Trimmed deps:
  removed `@monaco-editor/react`, `monaco-editor`, `@xterm/*`,
  `tailwindcss`, `postcss`, `autoprefixer` — none referenced any
  more.
- ScreenName type moved to `src/types/screens.ts` (single source of
  truth for App.tsx + InspectorRail).

## [0.1.4] — 2026-05-28

### Robustness + polish

- **React error boundary** wraps the entire app. Uncaught render errors
  now show a recoverable error panel ("DeepCode crashed") with the
  stack trace + reload button, instead of leaving the user with a
  blank dark window.
- **Unhandled promise rejection** logger added at app entry so devtools
  surfaces async errors that would otherwise vanish.
- **System messages** redesigned — thin centered hint instead of a row
  with avatar + author label. Looks much less like an interruption.
- Bundles `release.yml` Tauri rewrite + `docs/RELEASING.md` from 0.1.3.

## [0.1.3] — 2026-05-28

### Visual redesign — phase 2

- **All 7 utility screens** (Sessions / Plugins / Skills / Permissions /
  MCP / Settings / About) redesigned to match `docs/VISUAL_DESIGN.html`.
  New shared `Screen` + `Card` + `Row` primitives.
- **About** is now a proper hero card with brand mark + gradient text
  - status diagnostics + docs links (replacing the boxed table layout
    the user shared as visually off-spec).
- **Settings** has a GUI/JSON segmented toggle: GUI shows a quick
  reference + filterable flat table; JSON shows a live-validated
  textarea. Save persists to ~/.deepcode/settings.json (was
  view-only).
- **Permissions** Save now actually persists rules (was stubbed).
- **Sessions** has search + click-to-resume with relative time.
- **Plugins** surfaces trust badges + custom Toggle switches.
- **Skills** has 2-column filter-list + SKILL.md preview.
- **MCP** uses status badges + tool count + inline error tail.

### Release pipeline (M9)

- `release.yml` rewritten for Tauri (was Electron-era). Tag → CI
  → npm publish + signed/notarized DMG + GitHub Release with notes.
- `docs/RELEASING.md` explains the 6 secrets needed and step-by-step.

## [0.1.2] — 2026-05-28

### Fixes — caught from user playtest of 0.1.1

- **Tool input field-name fix.** `tool_write` (and read / edit / bash /
  glob / grep) were failing with `missing required key filePath` when
  DeepSeek emitted snake_case keys but the wrapper expected camelCase.
  All 6 Mac tool wrappers now accept either case via a tolerant
  `pickStr / pickNum / pickBool` helper.
- **Project folder picker.** First launch now shows a "Pick a project
  folder" overlay before chat. The chosen path is persisted to
  `~/.deepcode/settings.json#projectPath` and threaded into every
  agent turn as `cwd`. Sidebar shows the active project + a `⇄`
  switch button.
- **Session persistence.** Each turn now writes a JSONL session under
  `~/.deepcode/sessions/<id>.jsonl`. Sidebar refreshes after every
  turn so newly-started sessions appear in the Today bucket.
- **Mid-turn controls locked.** Mode / model / effort dropdowns disable
  while the agent is responding or awaiting approval (was previously
  freely switchable mid-turn).
- **Inspector rail buttons work.** All 6 rail icons now route to
  their respective screens (Plan → Permissions, Sessions, Plugins,
  Skills, MCP, About, Settings). Expand-chevron ‹ still deferred.

### UX improvements

- **Proper dropdowns** for mode / model / effort — click-popover with
  inline descriptions and meta annotations, replacing the brittle
  click-to-cycle pattern.
- 5 official mode options surfaced (default / acceptEdits / plan /
  dontAsk / bypassPermissions) instead of 3.
- ReplScreen carries projectPath through to the system prompt so the
  LLM knows where it's working.

## [0.1.1] — 2026-05-28

### Visual redesign — phase 1

Major UI overhaul aligning the desktop client to `docs/VISUAL_DESIGN.html`.
Phase 1 covers the three highest-traffic surfaces: Onboarding, Sessions
sidebar, and the main Chat / REPL view. Other six screens land in 0.1.2.

- **Design tokens.** DeepSeek brand blue (`#4D6BFE`) + soft (`#E8EDFF`) +
  mint accent (`#14E4A2`) + dark-mode neutral palette baked into CSS vars
- **Brand mark.** Elephant SVG logo (matches the design spec's gradient
  brand badge) replaces the previous emoji-free placeholder
- **3-column desktop shell.** 240 px sessions sidebar | 1 fr chat main |
  48 px inspector rail (collapsed by default). Inspector rail shows Plan
  badge, context-usage dot, recent files, session info, settings.
- **Chat redesign.** Tool calls are now bordered cards with action ·
  target · status-badge head + tc-body for output/diff. Inline diff
  uses `diff-add` / `diff-del` colors. Approval buttons (Approve /
  Reject / Always allow) appear immediately under the relevant tool
  card — never at screen bottom.
- **Composer redesign.** New rounded box with toolbar (+ menu / mic /
  mode badge / model picker / send) and a context-usage bar showing
  tokens used + estimated cost.
- **Onboarding redesign.** Hero gradient + big brand mark + gradient
  text headline matching the design spec.

### Conversation flow

- Carries over the `dangerouslyAllowBrowser: true` fix from 0.1.0 so the
  OpenAI SDK's browser-environment guard doesn't trip in the Tauri webview
- Surfaces full error stack traces in the chat stream when the agent
  loop throws — easier to diagnose API key / network issues from inside
  the app

## [0.1.0] — 2026-05-28

### Mac client + CLI baseline

- **CLI:** agent loop, 30+ slash commands, MCP support, plugin system,
  sandbox, hooks, modes, skills, sub-agents, output styles, effort
  levels, headless `-p` mode
- **Desktop (Tauri):** 9 screens (Onboarding / REPL / Sessions /
  Plugins / Skills / Permissions / MCP / Settings / About), real
  `runAgent` in renderer, Tauri auto-updater wired to GitHub
  Releases, xterm.js terminal, Monaco file panel with Source / Diff
  / History
- **M7/M8 polish:** inline approval UI with Always-allow persistence,
  `/rewind` 5-op snapshot rollback, `DEEPCODE_EFFORT_LEVEL` env var,
  desktop effort selector, Vim-mode wiring in composer, cron daemon
  install/uninstall scripts
- **Apple notarization:** signed + notarized + stapled DMG (4.2 MB
  Apple Silicon)
- **VS Code extension + LSP server** calling the real `runAgent`
