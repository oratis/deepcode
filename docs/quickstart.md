# DeepCode Quickstart

DeepCode is a Claude-Code-parity coding agent driven by **DeepSeek**. It ships
two ways: a **CLI** (`deepcode`) and a **macOS desktop app**. Both share the same
`@deepcode/core` kernel, so behavior is identical.

> Requirements: **Node ≥ 22** for the CLI. A **DeepSeek API key** (get one at
> <https://platform.deepseek.com/>). macOS 12+ for the desktop app.

---

## CLI (macOS + Linux)

```bash
# 1. Install
npm i -g deepcode-cli

# 2. Start the REPL — the first run walks you through setting your DeepSeek key
deepcode
```

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
`3` api/auth · `4` max-turns · `5` aborted.

```bash
deepcode -p "summarize the architecture" --output-format json
```

For long-lived CI tokens, run `deepcode setup-token` once and store the printed
token as `DEEPSEEK_AUTH_TOKEN` in your CI secrets.

---

## macOS desktop app

1. Download the latest `DeepCode-<version>-arm64.dmg` from
   [Releases](https://github.com/oratis/deepcode/releases).
2. Open the DMG and drag **DeepCode** into Applications.
3. Launch it. On first run it asks for your DeepSeek key, then prompts you to
   **pick a project folder** — everything DeepCode reads, writes, or runs stays
   inside that folder.
4. Type a request in the composer and press ⏎. Approve tool calls inline as they
   appear; switch model / effort / mode from the toolbar. Press **⌘\\** to expand
   the right-hand inspector (plan · context usage · recent files · session info).

The desktop app auto-updates from GitHub Releases ("Relaunch to update").

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
