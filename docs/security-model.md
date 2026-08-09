# DeepCode Security Model

> Last updated: 2026-08-01 (shared app-server trust, provenance, and thin-client capabilities)

This document is the **single source of truth** for what DeepCode protects
against, what it doesn't, and how each layer composes. If you're reviewing a
PR that touches credentials, sandbox, plugin runtime, or hooks — verify it
against the threat model here.

## Threat model

DeepCode is an LLM-driven coding assistant. The threats we care about, in
decreasing order of operator severity:

| #   | Threat                                                                         | Severity         | Where mitigated                                                                                                            |
| --- | ------------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Model exfiltrates DeepSeek API key (or other env secrets) via tool call        | High             | M3.5 sandbox + M5.1 env strip                                                                                              |
| 2   | Model writes arbitrary files outside the project (`/usr/bin`, `/etc`)          | High             | M3.5 sandbox + permissions                                                                                                 |
| 3   | Plugin (third-party code) does either #1 or #2                                 | High             | M5.1 subprocess + (M5.1-ext) OS sandbox                                                                                    |
| 4   | Hook script (third-party shell snippet) does either #1 or #2                   | Medium           | Exact-definition review + source trust; hook commands remain host code                                                     |
| 5   | Hostile `settings.json` field (e.g. allowRead path) injects sandbox rule       | Medium           | escapeSbpl()                                                                                                               |
| 6   | Untrusted project's AGENTS.md drives the agent into harmful action             | Low              | Trust store (`/trust`); a file-contract `deny` is independent of model judgement, so prompt injection cannot argue past it |
| 7   | DNS exfiltration of secrets from sandboxed Bash                                | Partly mitigated | M3.5-ext DNS allowlist (netns.ts) — names only; raw-IP dials still pass                                                    |
| 8   | Model reads an in-project secret (`.env`, `*.pem`) through a read tool         | Partly mitigated | File contract `read: deny` — covers Read/Grep/Glob, **not Bash** (see below)                                               |
| 9   | Unattended job runs with a permissive mode inherited from interactive settings | Mitigated        | Trigger profile clamp + `onApprovalRequired`                                                                               |
| 10  | User cannot audit or undo what the agent wrote                                 | Mitigated        | Change ledger + `deepcode ledger rollback` through the apply ceremony                                                      |
| 11  | An MCP peer calls DeepCode's own tools without any policy                      | Mitigated        | `mcp serve` routes every call through `dispatchToolCall`; `ask` is refused (see below)                                     |

### `deepcode mcp serve` runs with nobody attached

`mcp serve` exposes Read / Write / Edit / Bash / Grep / Glob to whatever MCP
client connects — typically another agent. It executed them directly, with no
mode, no permission rules, no file contract and no `PreToolUse` hooks: the same
shape as the `runAgent` bypass fixed in #181, in a different entry point. The
original plan listed the missing permission model as a known risk and deferred
the design document; the feature shipped without either.

Every call now goes through `dispatchToolCall`, and:

- **`ask` is refused, not granted.** There is no user on that pipe. Granting
  would make "whoever connected" the authority on what may run.
- **A permissive `permissions.defaultMode` is clamped** to `default`, exactly as
  a scheduled job's is. `bypassPermissions` is a decision about sitting at a
  REPL; inheriting it here hands "never ask me" to a peer.
- **`--mode` is the explicit opt-in** back out of that clamp, and `--sandbox`
  tightens the sandbox for served commands.
- Directory trust still gates project settings, so an untrusted checkout cannot
  widen the posture the server runs under.

The practical consequence: a peer can do what `permissions.allow` says it can,
and nothing else. That is a real reduction in capability for anyone who was
relying on the old behaviour, and it is the point.

### Residual risk: the file contract is policy, not a boundary

Threat #8 is **partly** mitigated, and the distinction matters more than the
mitigation.

A [file contract](file-contract.md) constrains tool calls that pass through the
dispatcher — `Read`, `Grep`, `Glob`, `Write`, `Edit`, `NotebookEdit`. It has no
effect on what a shell command does once `Bash` has started. `cat .env` is a
string; statically parsing shell to decide otherwise would be guesswork
presented as enforcement, which is worse than not trying because it reads as a
guarantee.

**Only the sandbox bounds Bash.** When a contract denies reads while the sandbox
resolves to `danger-full-access`, DeepCode warns at REPL start, on every headless
run, in `deepcode contract show`, and in `deepcode doctor`. Do not describe the
contract as secret protection in any user-facing text; describe it as reducing
the accidental-touch and prompt-injection surface.

Path normalization is string math and does not call `realpath`, so a symlink
inside the workspace pointing outside still normalizes to an inside-looking
path. Same conclusion: the sandbox is the boundary.

## Defence layers

### Runtime placement — thin clients

The Tauri WebView, VS Code extension, and LSP process are protocol clients, not trusted runtimes.
Provider credentials, model calls, tools, permissions, hooks, MCP, and plugins stay in the CLI host
or app-server. The Tauri capability set is least-privilege: file/folder selection, default
HTTP(S)/mailto/tel URL opening, updater operations, and application restart. It has no Tauri
filesystem plugin, shell permission, generic process-exit permission, file-reveal permission, or CSP
route to the provider API. Read-only file preview and session history use explicit Rust commands
that reject the backend credential path; all workspace mutations use the versioned protocol.

### Layer 0 — Trust store

First time DeepCode opens a folder, you're asked **"Do you trust this
directory?"**. If you say no, the agent runs in a heavily restricted mode:
no exec, no writes outside the project, no `bypassPermissions` mode allowed.

Decisions persist in `~/.deepcode/trusted-dirs.json`. The CLI, desktop sidecar, VS Code, and LSP
app-server entrypoints all consult the same core trust store. Until a directory is trusted,
project/local settings cannot replace provider endpoints, model/cost policy, permissions, auto
mode, sandbox, environment, hooks, MCP, credential helpers, executable voice paths, worktree/update
policy, or status-line commands. `config/diagnostics` reports which fields were gated without
returning their values.

### Layer 1 — Mode + Permissions

Every tool call goes through:

```
  Mode policy → Permission rules → Sandbox wrap → Exec
```

Modes (`default` | `acceptEdits` | `plan` | `auto` | `dontAsk` | `bypassPermissions`):

- `plan` blocks all writes and exec (read/grep/glob only).
- `default` prompts for risky operations.
- `bypassPermissions` is gated behind the trust store.

Permission rules in `settings.json` are evaluated in order: deny > ask > allow.
4 glob patterns are supported per rule (read/write/edit/exec). See
`packages/core/src/config/permissions.ts`.

### Layer 2 — Sandbox (M3.5)

Bash tool invocations are wrapped under platform sandbox when
`settings.sandbox.enabled` is `true`.

**macOS — `sandbox-exec` + SBPL profile**

Profile is generated dynamically per invocation (`buildMacOsProfile`) and
written to `$TMPDIR/deepcode-sb-*.sb`. Policy:

- **Default-deny** on file-read, file-write, and most other operations.
- Allowed reads: `/usr`, `/System`, `/Library`, `/private/etc`,
  `/private/var/db`, `/private/var/folders` (dyld closure), `/bin`, `/sbin`,
  `/opt`, `/dev`, `~/.config`, `~/.npm`, `~/.cache`. Plus user-provided
  `filesystem.allowRead` paths.
- Path traversal: explicit `(literal "/")` and `(literal "/private")`
  entries so `getcwd()` and parent stats work.
- Allowed writes: `/private/tmp`, `/private/var/folders`. Plus user-provided
  `filesystem.allowWrite` (also implicitly readable).
- `denyRead` / `denyWrite` rules appended LAST so they override allows on
  overlap.
- Network: default-allow unless `network.allowedDomains: []` (empty array)
  meaning "no network". Per-domain allowlisting is NOT available on macOS (SBPL
  has no usable remote-host predicate here) — only on Linux (see below).
- Unix sockets: blocked unless `network.allowUnixSockets: true`.

**Linux — `bwrap` argv**

Generated by `buildLinuxBwrapArgs`:

- System read-only mounts: `/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`, `/etc`
  (`--ro-bind-try`).
- `/proc`, `/dev`, `/tmp` (tmpfs).
- cwd is the only bare `--bind` (rw).
- Always `--unshare-pid`, `--unshare-ipc`, `--unshare-uts`.
- `--unshare-net` when `network.allowedDomains: []` (deny-all-net).

**Linux — selective per-domain allowlist (`netns.ts`)**

When `network.allowedDomains` is a NON-EMPTY allowlist, `BashTool` runs the
command via `spawnNetworkSandbox`:

- `bwrap --unshare-net --uid 0 --gid 0` gives the command its own netns; a
  generated `resolv.conf` (→ slirp gateway `10.0.2.2`) is bound in.
- `slirp4netns` provides rootless userspace NAT (`tap0`) and is attached to the
  sandbox's netns by PID (the `--uid 0` mapping is what lets it `setns`).
- The allowlisting DNS proxy (`dns-proxy.ts`) on `127.0.0.1:53` answers only
  allowlisted names and NXDOMAINs the rest; `slirp4netns --disable-dns` closes
  the `10.0.2.3` bypass.

**Threat model + limits:** this is DNS-NAME allowlisting — a process that dials
a raw IP bypasses it (adequate for the git/npm/pip-over-https workload). It
requires binding `127.0.0.1:53` (CAP_NET_BIND_SERVICE or a relaxed
`net.ipv4.ip_unprivileged_port_start`). When that's unavailable, `BashTool`
**fails closed** to deny-all-net (the command runs with no network, with a note)
rather than running unrestricted. Background commands always fail closed (the
slirp helper can't safely outlive the turn).

**Windows — not supported.** Sandbox is a no-op (see plan §0.2).

**Excluded commands** — `git` is excluded by default. The match is on the
leading whitespace-bounded token of the user command. Pipelines starting with
an excluded command DO bypass — this is documented behavior pinned by a test,
not an oversight. (M5.2 will add per-clause analysis.)

### Layer 3 — Plugin subprocess (M5.1)

Plugins run in their own `node` subprocess with:

- **Gated host capabilities** — declared `fs_read`, `fs_write`, `bash`, and `fetch` requests flow via
  JSON-RPC over stdio back to the host, which applies mode, permission, hook, approval, and sandbox
  policy. This controls the supported plugin API; it is not yet an OS boundary against a malicious
  plugin using Node APIs directly.
- **Token-protected RPC** — host generates an unguessable token per plugin
  spawn; every RPC from the plugin must include it.
- **Env scrub** — `DEEPSEEK_API_KEY` and `DEEPSEEK_AUTH_TOKEN` are stripped
  from the child env. Plugins cannot read DeepSeek credentials.
- **Whole-install hash pin** — every installed plugin file contributes to the SHA-256 trust hash;
  missing trust or any drift disables the plugin and reports a diagnostic.

**Acknowledged gaps**:

- The subprocess isn't itself sandbox-wrapped at the OS level yet. A
  malicious plugin can still exfil via DNS, can read other files the host
  process can read (e.g. `~/.deepcode/credentials.json`). M5.1-ext closes
  this by spawning the plugin under `sandbox-exec`/`bwrap` too.
- A plugin can still `process.exit(N)` to crash the host's plugin pool. Host
  restarts on next launch.

### Layer 4 — Credentials

- API key stored in `~/.deepcode/credentials.json` with `chmod 600`.
- `apiKeyHelper` field can point at an OS keychain wrapper; output is cached
  for 5 min (`ApiKeyHelperRefresher`, configurable via
  `DEEPCODE_API_KEY_HELPER_TTL_MS`).
- `/doctor` redacts the loaded key in its output (`sk-…` truncated).

## Hostile-input handling

The SBPL profile builder treats every user-controlled string (allowRead paths
etc.) as **untrusted**. We:

1. Escape backslash and double-quote before embedding into a quoted SBPL
   subpath literal (`escapeSbpl`).
2. Apply `(deny ...)` rules AFTER `(allow ...)` so a deny always wins on
   overlap.
3. Test injection attempts in `packages/core/src/sandbox/attacks.test.ts` —
   try to inject `)\n(allow file-write* (subpath "/"))` etc., verify the
   resulting profile doesn't standalone-allow root writes.

## Attack-vector test suite

`packages/core/src/sandbox/attacks.test.ts` and the platform integration suites cover:

- **Unit-level** "hostile input → safe output" cases:
  - SBPL paren/quote escaping
  - SBPL backslash escaping
  - deny-after-allow ordering
  - no implicit network when allowedDomains is empty
  - no implicit file-write to /usr, /System, /Library
- **bwrap-argument safety** cases:
  - no --share-net even with a non-empty allowedDomains (connectivity comes from
    slirp4netns externally, never by sharing the host netns)
  - only cwd is bare --bind
  - always --unshare-{pid,ipc,uts}
- **Excluded-command spoofing** cases:
  - prefix-only match (`gitleaks`) does NOT bypass
  - exact match bypasses
  - leading-token match bypasses
  - pipeline-after-excluded bypasses (documented behavior; M5.2 hardens)
- **sandbox-exec e2e** (macOS, runIf the binary exists):
  - block write to `/usr/local/bin/*`
  - profile is syntactically valid (smoke)
- **bwrap e2e** (Linux CI, runIf `bwrap` exists — `bwrap-integration.test.ts`):
  - write inside the rw-bound cwd succeeds; write to `/etc` is read-only-denied
  - `/usr` readable (sandbox is usable); deny-all-net blocks outbound
  - block write outside cwd (host file never created)
- **selective net allowlist e2e** (Linux CI, `netns-integration.test.ts`):
  - an allowlisted domain returns HTTP 200; a non-allowlisted domain NXDOMAINs
  - the sandbox resolv.conf points at the slirp gateway

## What we do NOT yet protect against

| Gap                                                | Tracking                                       |
| -------------------------------------------------- | ---------------------------------------------- |
| Raw-IP egress bypassing the DNS-name allowlist     | by design (name-level); IP-level filtering TBD |
| Per-domain allowlist on macOS                      | SBPL has no usable remote-host predicate       |
| Allowlist where `127.0.0.1:53` can't be bound      | fails closed to deny-all-net (documented)      |
| OS sandbox wrapping the plugin subprocess          | M5.1-ext                                       |
| Pipeline analysis (`git ... && rm -rf /`)          | M5.2                                           |
| Image input prompt injection (model multimodal)    | v1.1                                           |
| Side-channel timing leaks (e.g. via exec duration) | Out of scope                                   |
| Local malicious binaries already on $PATH          | Out of scope (assume host is trusted)          |

## How to file a security issue

1. Do NOT open a public GitHub issue.
2. Email security@<TBD>.dev with reproduction steps + commit SHA.
3. We aim to triage within 72 hours.

## Sandbox modes (0.2.1)

The Bash tool runs under a platform sandbox whose posture is chosen by
`sandbox.mode` (settings) or `--sandbox` (CLI), independently of the permission
`Mode` that decides how a tool call is approved:

| Mode                 | Workspace                            | Temp + package caches | Elsewhere |
| -------------------- | ------------------------------------ | --------------------- | --------- |
| `read-only`          | read                                 | write                 | read      |
| `workspace-write`    | read+write                           | write                 | read      |
| `danger-full-access` | unrestricted — no sandbox is applied |

**`workspace-write` is the default** for every host (CLI, headless, app-server).
Library callers of `wrapBashCommand` keep the previous "off unless configured"
behaviour unless they pass `defaultMode`, so embedding DeepCode cannot become
silently sandboxed by an upgrade.

### What is and is not protected

Writes and network are deny-by-default. **Reads are allowed** except for a
denied set of credential stores (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.netrc`,
`~/.docker/config.json`, `~/.config/gh`, `~/.deepcode/credentials.json`,
`~/Library/Keychains`) plus anything in `filesystem.denyRead`.

This is a deliberate change from the previous read allowlist, which did not
survive contact with real commands: git could not resolve Xcode's developer
directory, nothing could open `/dev/null`, temp writes failed because SBPL
`subpath` does not match the directory node itself, and `~/.gitconfig` was
denied. A sandbox that breaks `ls` is a sandbox nobody turns on.

Package-manager caches (`~/.npm`, `~/.cache`, `~/.cargo`, `~/.pnpm-store`,
`~/.yarn`, `~/.bun`, `~/Library/Caches`) are writable: they are
content-addressed caches, and denying them turns `npm install` into a confusing
permission error while protecting nothing.

A linked git worktree's git directories live outside the workspace, so they are
added to the writable set — otherwise every git command fails inside the
worktrees DeepCode's own `EnterWorktree` tool creates.

### Verified on macOS

Under `workspace-write`: workspace read/write, temp writes, `git`, `node`,
`npm install`, `tsc` and `vitest` all succeed; writes outside the workspace and
reads of `~/.ssh` are denied. Under `read-only` the same holds except workspace
writes are denied. Linux (bwrap) already bound cwd read-write and is unchanged
apart from the shared mode resolution.
