# Behavior Parity — DeepCode vs Claude Code

> This document tracks where DeepCode's behavior **aligns with**, **deviates from**, or **deliberately enhances** Claude Code. It grows alongside the codebase. Last updated reflects what main contains.

Legend: `✅` matches · `🟡` matches with caveats · `🔄` deferred · `⚠️` deliberately differs · `🆕` DeepCode-only addition

---

## Slash commands (30+ in Claude Code, 14 shipped in DeepCode)

| Command               | Claude Code | DeepCode                   | Status                                                                                     |
| --------------------- | ----------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `/help`               | ✓           | ✓                          | ✅                                                                                         |
| `/clear`              | ✓           | ✓                          | ✅                                                                                         |
| `/exit` / `/quit`     | ✓           | ✓                          | ✅                                                                                         |
| `/status` / `/doctor` | ✓           | ✓                          | ✅                                                                                         |
| `/model`              | ✓           | ✓                          | ✅ DeepCode constrains to deepseek-\* (model picker doesn't show foreign providers)        |
| `/mode`               | ✓           | ✓                          | ✅                                                                                         |
| `/effort`             | ✓           | ✓                          | 🟡 — UI selector deferred to GUI (M6); CLI works                                           |
| `/cost` / `/usage`    | ✓           | ✓                          | ✅                                                                                         |
| `/context`            | ✓           | ✓                          | ✅                                                                                         |
| `/config`             | ✓           | ✓ (read-only)              | 🟡 — Claude Code's `/config` is interactive editor; ours is JSON dump (M3c-ext for editor) |
| `/resume`             | ✓           | ✓ (list only)              | 🟡 — Claude Code has fuzzy picker; ours lists; pick via `--resume <id>`                    |
| `/init`               | ✓           | ✓ (stub)                   | 🔄 — multi-phase interactive flow deferred to M3c-ext                                      |
| `/mcp`                | ✓           | ✓                          | ✅                                                                                         |
| `/add-dir`            | ✓           | ✓ (records intent)         | 🟡 — M3 will enforce                                                                       |
| `/todos`              | ✓           | ✓                          | ✅ — reads `<sessionDir>/todos.json` written by TodoWrite tool                             |
| `/plugins`            | ✓           | ✓                          | ✅ — lists wired plugins + contributed hook events + warnings (M5.2)                       |
| `/compact`            | ✓           | ✓ auto-trigger             | 🟡 — manual `/compact` slash command not exposed yet (auto works via agent loop)           |
| `/btw`                | ✓           | ✗                          | 🔄                                                                                         |
| `/recap`              | ✓           | ✗                          | 🔄                                                                                         |
| `/rewind`             | ✓           | ✓                          | ✅ — 5 ops (code/conversation/both/summarize-from/up-to); `Esc Esc` bound                  |
| `/voice`              | ✓           | ✗                          | 🔄 M8                                                                                      |
| `/teleport`           | ✓           | ✗                          | 🔄 M8                                                                                      |
| `/desktop`            | ✓           | ✗                          | 🔄 M6                                                                                      |
| `/background`         | ✓           | ✗                          | 🔄 (paired with TaskCreate M3.15.3)                                                        |
| `/batch`              | ✓           | ✗                          | 🔄                                                                                         |
| `/tasks`              | ✓           | ✗                          | 🔄                                                                                         |
| `/plan`               | ✓           | ✗                          | 🔄 — set via `/mode plan` in DeepCode                                                      |
| `/login` / `/logout`  | ✓           | ✗                          | 🔄 — DeepCode currently uses re-onboarding (clear creds + restart)                         |
| `/export`             | ✓           | ✗                          | 🔄                                                                                         |
| `/bug`                | ✓           | ✗                          | 🔄                                                                                         |
| `/upgrade`            | ✓           | ✓ (hint only)              | 🟡                                                                                         |
| `/pr_comments`        | ✓           | ✗                          | 🔄                                                                                         |
| `/review`             | ✓           | ✗ (skill avail)            | 🟡 — via Skill tool                                                                        |
| `/security-review`    | ✓           | ✗ (skill avail)            | 🟡 — via Skill tool                                                                        |
| `/schedule`           | ✓           | ✗ (skill avail)            | 🟡                                                                                         |
| `/loop`               | ✓           | ✗ (skill avail)            | 🟡                                                                                         |
| `/terminal-setup`     | ✓           | ✗                          | 🔄                                                                                         |
| `/vim`                | ✓           | ✗                          | 🔄 M8                                                                                      |
| `/agents`             | ✓           | ✗ (read .deepcode/agents/) | 🔄                                                                                         |
| `/hooks`              | ✓           | ✗                          | 🔄                                                                                         |
| `/skills`             | ✓           | ✗                          | 🔄                                                                                         |
| `/permissions`        | ✓           | ✗                          | 🔄                                                                                         |
| `/privacy-settings`   | ✓           | ✗                          | 🔄                                                                                         |
| `/migrate-installer`  | ✓           | ✗                          | 🔄                                                                                         |
| `/release-notes`      | ✓           | ✗                          | 🔄                                                                                         |

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
| SubagentStop     | ✓           | 🔄       | M4+ wiring                                   |
| PreCompact       | ✓           | ✓        | ✅ — fires through compaction event bus      |
| PostCompact      | ✓           | ✓        | ✅                                           |
| SessionStart     | ✓           | ✓        | ✅                                           |
| SessionEnd       | ✓           | ✓        | ✅                                           |
| UserPromptSubmit | ✓           | ✓        | ✅                                           |
| Notification     | ✓           | 🔄       | M8                                           |

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
- ✅ Elicitation (form mode) — server-initiated structured input → host prompt
- ✅ `deepcode mcp serve` — expose DeepCode's stateless tools as an MCP server (stdio)
- ✅ MCP resources — listed on connect; `@server:scheme://path` refs expanded in prompts
- ✅ MCP prompts as slash commands — `/mcp__<server>__<prompt> [args]`
- 🔄 OAuth (authorization-code browser flow) — static bearer / `headersHelper` cover token auth today

## Tools

| Tool                                                                           | Claude Code | DeepCode | Status                                      |
| ------------------------------------------------------------------------------ | ----------- | -------- | ------------------------------------------- |
| Read                                                                           | ✓           | ✓        | ✅                                          |
| Write                                                                          | ✓           | ✓        | ✅                                          |
| Edit                                                                           | ✓           | ✓        | ✅                                          |
| Bash                                                                           | ✓           | ✓        | ✅ + M3.5 sandbox wrap                      |
| Grep                                                                           | ✓           | ✓        | ✅ via ripgrep                              |
| Glob                                                                           | ✓           | ✓        | ✅ via fs.glob                              |
| Skill                                                                          | ✓           | ✓        | ✅ M5                                       |
| Task (subagents)                                                               | ✓           | 🔄       | M4 sub-agent files load; agent dispatch M4+ |
| NotebookEdit                                                                   | ✓           | 🔄       | M8                                          |
| AskUserQuestion                                                                | ✓           | 🔄       | M3c+                                        |
| ExitPlanMode                                                                   | ✓           | 🔄       | enforced via /mode                          |
| EnterWorktree / ExitWorktree                                                   | ✓           | 🔄       | M8                                          |
| ToolSearch (deferred load)                                                     | ✓           | 🔄       | M3c+                                        |
| TaskCreate / Monitor / TaskList / TaskGet / TaskOutput / TaskStop / TaskUpdate | ✓           | 🔄       | M8 (background tasks)                       |
| CronCreate / CronList / CronDelete                                             | ✓           | 🔄       | M8 (cron daemon)                            |
| ScheduleWakeup                                                                 | ✓           | 🔄       | M8                                          |
| WebFetch                                                                       | ✓           | ✅       | shipped M3c-rest — 5 MiB cap + abort        |
| WebSearch                                                                      | ✓           | ✅       | shipped M3c-rest — DDG default + SearXNG    |
| TodoWrite                                                                      | ✓           | ✅       | shipped M3c-rest — persists in sessionDir   |

## CLI flags

| Flag                                                                         | Status                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `--help` / `--version`                                                       | ✅                                                                      |
| `--mode` / `--permission-mode`                                               | ✅                                                                      |
| `--model` / `--effort`                                                       | ✅                                                                      |
| `--max-turns`                                                                | ✅                                                                      |
| `--system-prompt` / `--append-system-prompt[-file]`                          | ✅                                                                      |
| `--allowedTools` / `--disallowedTools`                                       | ✅                                                                      |
| `--bare`                                                                     | 🔄 (parsed, semantics deferred)                                         |
| `--settings` / `--agents` / `--mcp-config` / `--plugin-dir` / `--plugin-url` | 🔄 (parsed only)                                                        |
| `--no-plugins` / `--strict`                                                  | 🔄 (parsed only)                                                        |
| `-p` headless                                                                | ✅ text/json/stream-json, 5 exit codes                                  |
| `--output-format` / `--json-schema` / `--include-partial-messages`           | 🟡 output-format ✅; json-schema + include-partial-messages parsed only |
| `--resume <id>` / `--continue` / `--fork-session`                            | 🔄 M3c+                                                                 |

## What DeepCode adds that Claude Code doesn't have (yet)

| Feature           | Note                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `sandbox.*` field | macOS sandbox-exec + Linux bwrap wrapping for Bash tool, opt-in                                              |
| `update.*` field  | electron-updater integration with GitHub Releases for Mac client (Claude Code's update is upstream-specific) |
| Cat-shaped icon   | (...what)                                                                                                    |

---

_This document will be kept current as each PR lands. M9 release pipeline includes a check that fails CI if a new public behavior isn't documented here._
