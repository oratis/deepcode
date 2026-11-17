# DeepCode Quickstart

DeepCode is a coding agent with **DeepSeek** as the default provider. Kimi/GLM support and the optional Claude Agent SDK engine are described in the [multi-model guide](multi-model.md). The repository includes a **CLI**, a **macOS desktop app**, and VS Code/LSP integrations. Version 0.5.1 publishes a VSIX and source; npm, signed DMG and updater artifacts are unavailable in this release. See the [Harness implementation progress](HARNESS_IMPLEMENTATION_PROGRESS.md) for implemented and remaining work.

> Requirements: **Node 22 and pnpm 9** to build the CLI from source. A **DeepSeek API key** (get one at
> <https://platform.deepseek.com/>). macOS 12+ for the desktop app.

---

## CLI (macOS + Linux)

Build the tagged source and define a command for the current shell:

```bash
# Node 22 + pnpm 9
git clone --branch v0.5.1 https://github.com/oratis/deepcode.git
cd deepcode
pnpm install --frozen-lockfile
pnpm build
deepcode_checkout="$PWD"
deepcode() { node "$deepcode_checkout/apps/cli/dist/cli.js" "$@"; }
deepcode --help
# First run walks you through setting your DeepSeek key
deepcode
```

The `deepcode` function remains available in this shell after changing project directories. In another shell, define it again or invoke the built CLI by its absolute path.

On first launch DeepCode asks for your DeepSeek API key and stores it in the
macOS Keychain (or `~/.deepcode/credentials.json`, `chmod 600`, on Linux). You
can also set it via environment variable:

```bash
export DEEPSEEK_API_KEY="sk-..."     # X-Api-Key
# or, for a Bearer token / CI:
export DEEPSEEK_AUTH_TOKEN="..."
```

### Everyday use

```bash
deepcode                                   # interactive REPL in the current repo
deepcode -p "fix the bug in src/auth.ts"   # headless one-shot, prints the result
deepcode --mode plan                        # read-only "plan" mode (no writes)
deepcode --model deepseek-reasoner --effort high   # deeper reasoning
```

- **Models**: `deepseek-chat` (fast, default) · `deepseek-reasoner` (chain-of-thought).
- **Effort**: `low | medium | high | xhigh | max` — raises the per-turn output
  budget (DeepSeek caps output at 8192 tokens).
- **Modes**: `default` (ask before risky tools) · `acceptEdits` · `plan` ·
  `dontAsk` · `bypassPermissions`.

### Headless / CI

`-p`/`--print` runs a single prompt and exits. Combine with `--output-format json`
for machine-readable output. Exit codes: `0` ok · `1` generic · `2` bad-input ·
`3` api/auth · `4` output/turn budget exhausted · `5` aborted · `6` blocked (see below).

```bash
deepcode -p "summarize the architecture" --output-format json
```

For long-lived CI tokens, run `deepcode setup-token` once and store the printed
token as `DEEPSEEK_AUTH_TOKEN` in your CI secrets.

### Scheduled jobs

`CronCreate` (or `deepcode cron`) schedules a prompt to run headlessly on a cron
expression. Nobody is watching when it fires, so approval-requiring tool calls
cannot be answered. Each job chooses what happens then:

| `onApprovalRequired` | Behaviour                                                              |
| -------------------- | ---------------------------------------------------------------------- |
| `deny` (default)     | Refuse that one call, let the run continue                             |
| `abort`              | Stop the run, exit `6`, and log the reason to `~/.deepcode/cron-logs/` |

Pick `abort` when a partially-executed job is worse than no job — a run whose
first write was refused usually produces a confidently wrong summary otherwise.

### The permission posture of a scheduled job

A job reads the same `settings.json` you use interactively. A permissive
`permissions.defaultMode` — `bypassPermissions` or `acceptEdits` — chosen for
REPL convenience is **not** inherited by unattended runs: DeepCode clamps it to
`default` and says so in the job log.

Those are different decisions. Choosing "never ask me" while you're sitting
there watching is not the same as choosing it for a run at 3am that nobody sees.

To opt back in, say so per job:

| Field     | Effect                                                                         |
| --------- | ------------------------------------------------------------------------------ |
| `mode`    | Permission mode for this job, honoured as written — including a permissive one |
| `sandbox` | Sandbox for this job; applied only when **stricter** than ambient              |

Any extra permission rules on a job can only tighten: denies and asks are added,
allows are intersected. A job profile can narrow what runs without approval, and
can never widen it.

---

## VS Code and macOS desktop

Download `deepcode-0.5.1.vsix` from the [v0.5.1 release](https://github.com/oratis/deepcode/releases/tag/v0.5.1), run **Extensions: Install from VSIX…**, then open the DeepCode panel.

No signed DMG or updater feed is published for v0.5.1. Desktop development builds require the local Tauri/Rust toolchain; see [Releasing DeepCode](RELEASING.md) for build and signing requirements. A future release must explicitly include those artifacts before DMG installation or in-app updates can be used.

---

## Configure it

Settings live in `~/.deepcode/settings.json` (user) and `<project>/.deepcode/
settings.json` (project). The desktop app's **Settings** screen edits the same
files (GUI or raw JSON). Common knobs: `model`, `effortLevel`, `permissions`
(allow/ask/deny matchers), `mcpServers`, `hooks`.

- **Project memory**: write a `DEEPCODE.md` in your repo — DeepCode reads it as
  durable context (supports `@import` of other files; interops with `AGENTS.md`).
- **Permissions**: `Bash(git diff:*)` matches a subcommand; `Bash(git diff *)`
  matches a prefix. Manage them in Settings → Permissions or in `settings.json`.

---

## Next steps

- `docs/MIGRATION_FROM_CLAUDE_CODE.md` — what maps 1:1 from Claude Code.
- `docs/cli-flags.md` — the full flag reference.
- `docs/security-model.md` — sandbox, permissions, and credential storage.
