# Behavior Parity — DeepCode vs Claude Code

> This document tracks where DeepCode's behavior **aligns with**, **deviates from**, or **deliberately enhances** Claude Code. It grows alongside the codebase. Last updated reflects what main contains.

Legend: `✅` matches · `🟡` matches with caveats · `🔄` deferred · `⚠️` deliberately differs · `🆕` DeepCode-only addition

> **2026-06 accuracy pass (audited against code).** Several per-row tags below
> had drifted behind the code. This pass reconciles the **Slash-command**,
> **CLI-flag**, and **Tools** tables with the actual source. Treat the milestone
> tags (`M3c`, `M8`, …) as historical notes, not current status. Highlights now
> landed on `main`: CLI `-C` / `--cd` (Codex parity, PR #148); the `/diff`,
> `/release-notes`, and `/bug` (alias `/feedback`) slash commands (PR #150);
> `--resume` / `--continue` / `--fork-session` wired to real session resume
> (PR #153); the `/init` 3-phase REPL flow; and the CLI `/effort` table reading
> its numbers from `EFFORT_PARAMS` (PR #147); `--permission-mode` wired as a
> true `--mode` alias (PR #159); and `--bare` / `--no-plugins` wired. The Tools
> table (de-staled in PR #151) was re-verified row-by-row this pass — all
> markers hold.

---

## Slash commands (30+ in Claude Code, ~32 shipped in DeepCode)

| Command                    | Claude Code | DeepCode           | Status                                                                                                                                                                    |
| -------------------------- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/help`                    | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/clear`                   | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/exit` / `/quit`          | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/status` / `/doctor`      | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/model`                   | ✓           | ✓                  | ✅ DeepCode constrains to deepseek-\* (model picker doesn't show foreign providers)                                                                                       |
| `/mode`                    | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/effort`                  | ✓           | ✓                  | 🟡 — CLI prints the tier table (numbers from `EFFORT_PARAMS` SSOT); switch via `/effort <tier>`; arrow-key selector is GUI-only (M6)                                      |
| `/cost` / `/usage`         | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/context`                 | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/config`                  | ✓           | ✓                  | 🟡 — dumps merged settings + `/config set <key> <value>` (dotted keys, JSON values) writes user settings; no full arrow-key editor                                        |
| `/resume`                  | ✓           | ✓                  | ✅ — lists recent sessions; `/resume <id\|number>` switches the live session in-REPL; `--resume <id>` / `-r` at launch                                                    |
| `/init`                    | ✓           | ✓                  | ✅ — interactive 3-phase REPL flow (scan → draft → approve-write `AGENTS.md`)                                                                                             |
| `/mcp`                     | ✓           | ✓                  | ✅                                                                                                                                                                        |
| `/add-dir`                 | ✓           | ✓ (records intent) | 🟡 — M3 will enforce                                                                                                                                                      |
| `/todos`                   | ✓           | ✓                  | ✅ — reads `<sessionDir>/todos.json` written by TodoWrite tool                                                                                                            |
| `/plugins`                 | ✓           | ✓                  | ✅ — lists wired plugins + contributed hook events + warnings (M5.2)                                                                                                      |
| `/compact`                 | ✓           | ✓                  | ✅ — manual `/compact` + automatic threshold trigger in the agent loop                                                                                                    |
| `/diff`                    | ✓           | ✓                  | ✅ — git diff + untracked files in the working tree (PR #150)                                                                                                             |
| `/btw`                     | ✓           | ✓                  | 🟡 — queues a "by the way" context note the agent sees with your next message (no turn fired); exact Claude Code behavior may differ                                      |
| `/recap`                   | ✓           | ✓                  | ✅ — provider-summarized recap of the session so far                                                                                                                      |
| `/rewind`                  | ✓           | ✓                  | ✅ — 5 ops (code/conversation/both/summarize-from/up-to); `Esc Esc` bound                                                                                                 |
| `/voice`                   | ✓           | ✓                  | 🟡 — `/voice` detects whisper.cpp + a model and prints setup steps (docs/VOICE_INPUT.md); core `WhisperCppProvider` is wired; live mic capture lands in a follow-up slice |
| `/teleport`                | ✓           | ✗                  | 🔄 M8                                                                                                                                                                     |
| `/desktop`                 | ✓           | ✗                  | 🔄 M6                                                                                                                                                                     |
| `/background`              | ✓           | ✓                  | ✅ — runs a prompt as a background sub-agent via the session TaskManager (alias `/bg`); agent-started TaskCreate tasks appear too                                         |
| `/batch`                   | ✓           | ✗                  | 🔄 — batch-of-prompts not yet wired (use `/background` per prompt)                                                                                                        |
| `/tasks`                   | ✓           | ✓                  | ✅ — lists this session's background tasks; `/tasks <id>` shows one's status + output                                                                                     |
| `/plan`                    | ✓           | ✗                  | 🔄 — set via `/mode plan` in DeepCode                                                                                                                                     |
| `/login` / `/logout`       | ✓           | ✓                  | ✅ — /logout clears creds + exits; /login <key> stores a new key (next launch)                                                                                            |
| `/export`                  | ✓           | ✓                  | ✅ — writes the conversation to a markdown file                                                                                                                           |
| `/bug` (alias `/feedback`) | ✓           | ✓                  | ✅ — prints a prefilled GitHub issue link (model/mode/effort in the body)                                                                                                 |
| `/upgrade`                 | ✓           | ✓                  | ✅ — prints version + `npm i -g deepcode-cli@latest` (also the `deepcode upgrade` subcommand)                                                                             |
| `/pr_comments`             | ✓           | ✓                  | ✅ — `gh pr view` comments for the current branch's PR                                                                                                                    |
| `/review`                  | ✓           | ✗ (skill avail)    | 🟡 — via Skill tool                                                                                                                                                       |
| `/security-review`         | ✓           | ✗ (skill avail)    | 🟡 — via Skill tool                                                                                                                                                       |
| `/schedule`                | ✓           | ✗ (skill avail)    | 🟡                                                                                                                                                                        |
| `/loop`                    | ✓           | ✗ (skill avail)    | 🟡                                                                                                                                                                        |
| `/terminal-setup`          | ✓           | ✗                  | 🔄                                                                                                                                                                        |
| `/vim`                     | ✓           | ✓                  | ✅ — toggles Vim mode (persists to `~/.deepcode/keybindings.json`)                                                                                                        |
| `/keybindings`             | ✓           | ✓ (read-only)      | 🟡 — Claude Code opens/creates the keybindings config; ours lists bindings (edit `~/.deepcode/keybindings.json` manually)                                                 |
| `/agents`                  | ✓           | ✓                  | ✅ — lists sub-agents from `.deepcode/agents/`                                                                                                                            |
| `/hooks`                   | ✓           | ✓                  | ✅ — lists hooks configured in settings.json                                                                                                                              |
| `/skills`                  | ✓           | ✓                  | ✅ — lists built-in + user + project skills                                                                                                                               |
| `/permissions`             | ✓           | ✓ (read-only)      | 🟡 — shows rules + default mode (interactive editor deferred)                                                                                                             |
| `/privacy-settings`        | ✓           | ✓                  | ✅ — summarizes local data locations + what's sent to the DeepSeek API (read-only)                                                                                        |
| `/migrate-installer`       | ✓           | ✗                  | 🔄                                                                                                                                                                        |
| `/release-notes`           | ✓           | ✓                  | ✅ — prints the latest `CHANGELOG.md` entry                                                                                                                               |

---

## Settings.json fields

Tracked in `packages/core/src/config/types.ts`. Roughly 50 fields total; most are stubbed (schema-known but not actively consumed). M2 loads + merges all of them. Subsystems consume as they ship.

Specific deviations:

- ⚠️ `model` enum: only `deepseek-chat` / `deepseek-reasoner` / `deepseek-v4-flash` / `deepseek-v4-pro` (DeepSeek constraint). Aliases align.
- 🆕 `update.*` for Mac client auto-update via electron-updater (Claude Code has its own equivalent).
- 🟡 `managed/MDM policy` layer: explicit non-goal v1 per §0.2 — schema reserved.

## Hook events

| Event            | Claude Code | DeepCode | Status                                       |
| ---------------- | ----------- | -------- | -------------------------------------------- |
| PreToolUse       | ✓           | ✓        | ✅                                           |
| PostToolUse      | ✓           | ✓        | ✅                                           |
| Stop             | ✓           | ✓        | ✅ — fires when agent loop ends (any reason) |
| SubagentStop     | ✓           | ✓        | ✅ — fires when a Task sub-agent finishes    |
| PreCompact       | ✓           | ✓        | ✅ — fires through compaction event bus      |
| PostCompact      | ✓           | ✓        | ✅                                           |
| SessionStart     | ✓           | ✓        | ✅                                           |
| SessionEnd       | ✓           | ✓        | ✅                                           |
| UserPromptSubmit | ✓           | ✓        | ✅                                           |
| Notification     | ✓           | ✓        | ✅ — REPL fires on turn-end (awaiting input) |

## Hook handler types

| Type       | Claude Code | DeepCode | Status                                                                  |
| ---------- | ----------- | -------- | ----------------------------------------------------------------------- |
| `command`  | ✓           | ✓        | ✅ — JSON-on-stdin contract, JSON-on-stdout decoded                     |
| `http`     | ✓           | ✓        | ✅ — fetch POST, response.text → stdout; `allowedHttpHookUrls` enforced |
| `prompt`   | ✓           | ✓        | ✅ — synthesizes additionalContext (no exec)                            |
| `mcp_tool` | ✓           | ✓        | ✅ — agent loop resolves `mcp__<server>__<tool>` from the live registry |
| `agent`    | ✓           | ✓        | ✅ — runs a named sub-agent (re-entrancy-guarded)                       |
| `if` field | ✓           | ✓        | ✅ permission-rule syntax filter                                        |

## Modes

| Mode                  | Claude Code | DeepCode | Status                                               |
| --------------------- | ----------- | -------- | ---------------------------------------------------- |
| default               | ✓           | ✓        | ✅                                                   |
| acceptEdits           | ✓           | ✓        | ✅                                                   |
| plan                  | ✓           | ✓        | ✅                                                   |
| auto (LLM classifier) | ✓           | ✓        | ✅ — `classifyAutoMode` wired in the tool dispatcher |
| dontAsk               | ✓           | ✓        | ✅                                                   |
| bypassPermissions     | ✓           | ✓        | ✅ sandbox still enforces                            |

## Memory system

- ✅ `CLAUDE.md` ↔ `DEEPCODE.md` (different filename, same semantics)
- ✅ `~/.claude/CLAUDE.md` ↔ `~/.deepcode/DEEPCODE.md`
- ✅ Hierarchical walk cwd → root
- ✅ `@-import` recursion (≤ 4 hops, cycle detection)
- ✅ `AGENTS.md` auto-import (cross-tool interop)
- ✅ `.deepcode/rules/*.md` (path-scoped frontmatter deferred to M4)
- 🔄 Auto-memory (`~/.deepcode/projects/<repo>/memory/`) — schema defined, agent-side writes M4+

## MCP

- ✅ stdio transport
- ✅ http (Streamable HTTP) / sse transports
- ✅ list_tools + call_tool with `mcp__<server>__<tool>` qualification
- ✅ `/mcp` slash + auto-connect from settings + per-server enabled/disabled
- ✅ `alwaysLoad: false` opt-out defers a server's tools behind ToolSearch
- ✅ static `headers` + dynamic `headersHelper` auth
- ✅ OAuth 2.0 (authorization-code + PKCE, dynamic client registration) via `oauth: true`; tokens persist under `~/.deepcode/mcp-auth/` + auto-refresh
- ✅ Elicitation (form mode) — server-initiated structured input → host prompt
- ✅ `deepcode mcp serve` — expose DeepCode's stateless tools as an MCP server (stdio)
- ✅ MCP resources — listed on connect; `@server:scheme://path` refs expanded in prompts
- ✅ MCP prompts as slash commands — `/mcp__<server>__<prompt> [args]`

## Tools

| Tool                                                                           | Claude Code | DeepCode | Status                                                      |
| ------------------------------------------------------------------------------ | ----------- | -------- | ----------------------------------------------------------- |
| Read                                                                           | ✓           | ✓        | ✅                                                          |
| Write                                                                          | ✓           | ✓        | ✅                                                          |
| Edit                                                                           | ✓           | ✓        | ✅                                                          |
| Bash                                                                           | ✓           | ✓        | ✅ + M3.5 sandbox wrap                                      |
| Grep                                                                           | ✓           | ✓        | ✅ via ripgrep                                              |
| Glob                                                                           | ✓           | ✓        | ✅ via fs.glob                                              |
| Skill                                                                          | ✓           | ✓        | ✅ M5                                                       |
| Task (subagents)                                                               | ✓           | ✅       | `TaskTool` in `BUILTIN_TOOLS` — spawns a sub-agent          |
| NotebookEdit                                                                   | ✓           | ✅       | shipped (`tools/notebook.ts`)                               |
| AskUserQuestion                                                                | ✓           | ✅       | shipped; returns null in headless                           |
| EnterPlanMode / ExitPlanMode                                                   | ✓           | ✅       | shipped; also drivable via `/mode plan`                     |
| EnterWorktree / ExitWorktree                                                   | ✓           | ✅       | shipped (`tools/worktree-tools.ts`)                         |
| ToolSearch (deferred load)                                                     | ✓           | ✅       | installed when MCP tools opt out of eager load              |
| TaskCreate / Monitor / TaskList / TaskGet / TaskOutput / TaskStop / TaskUpdate | ✓           | ✅       | shipped — background tasks (`TASK_TOOLS`)                   |
| CronCreate / CronList / CronDelete                                             | ✓           | ✅       | shipped — launchd-backed scheduler                          |
| ScheduleWakeup                                                                 | ✓           | ⚠️       | not a tool in DeepCode — use `CronCreate` / `deepcode cron` |
| WebFetch                                                                       | ✓           | ✅       | shipped M3c-rest — 5 MiB cap + abort                        |
| WebSearch                                                                      | ✓           | ✅       | shipped M3c-rest — DDG default + SearXNG                    |
| TodoWrite                                                                      | ✓           | ✅       | shipped M3c-rest — persists in sessionDir                   |

## CLI flags

| Flag                                                                         | Status                                                                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--help` / `--version`                                                       | ✅                                                                                                                                                 |
| `--mode`                                                                     | ✅                                                                                                                                                 |
| `--permission-mode`                                                          | ✅ — true `--mode` alias (sets `mode`; last of `--mode`/`--permission-mode` wins), wired in PR #159                                                |
| `--model` / `--effort`                                                       | ✅                                                                                                                                                 |
| `--max-turns`                                                                | ✅                                                                                                                                                 |
| `-C` / `--cd <dir>`                                                          | ✅ — chdir before running (Codex parity); validated eagerly, bad path exits 2                                                                      |
| `--system-prompt` / `--append-system-prompt[-file]`                          | ✅                                                                                                                                                 |
| `--allowedTools` / `--disallowedTools`                                       | ✅                                                                                                                                                 |
| `--bare`                                                                     | ✅ — suppresses the REPL startup banner (scripting / minimal output)                                                                               |
| `--settings` / `--agents` / `--mcp-config` / `--plugin-dir` / `--plugin-url` | 🟡 — `--settings <file>` is a trusted highest-precedence override layer; `--agents`/`--mcp-config`/`--plugin-dir`/`--plugin-url` still parsed-only |
| `--no-plugins` / `--strict`                                                  | 🟡 — `--no-plugins` skips plugin discovery + wiring; `--strict` still parsed-only                                                                  |
| `-p` headless                                                                | ✅ text/json/stream-json, 5 exit codes                                                                                                             |
| `--output-format` / `--json-schema` / `--include-partial-messages`           | ✅ output-format + json-schema (lightweight top-level validation) + include-partial-messages all implemented (`headless.ts`)                       |
| `--resume <id>` / `--continue` / `--fork-session`                            | ✅ resume by id (picker if no id, `-r`), most-recent-in-cwd (`-c`), fork-into-new                                                                  |

## What DeepCode adds that Claude Code doesn't have (yet)

| Feature           | Note                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `sandbox.*` field | macOS sandbox-exec + Linux bwrap wrapping for Bash tool, opt-in                                              |
| `update.*` field  | electron-updater integration with GitHub Releases for Mac client (Claude Code's update is upstream-specific) |
| Cat-shaped icon   | (...what)                                                                                                    |

---

_This document will be kept current as each PR lands. M9 release pipeline includes a check that fails CI if a new public behavior isn't documented here._
