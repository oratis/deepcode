# `deepcode` CLI Flags Reference

> **Status**: M2 — parser implemented + most surfaces wired. Some flags are placeholders that will land in later milestones (each marked below).

## Synopsis

```bash
deepcode                                # interactive REPL
deepcode -p "<prompt>"                  # headless one-shot          [M8]
deepcode --resume [<id>]                # resume session             [M3]
deepcode --continue                     # most-recent session        [M3]
deepcode doctor                         # diagnostic checks
deepcode upgrade                        # CLI self-update
```

## Action triggers

| Flag                     | Effect                                    | Milestone |
| ------------------------ | ----------------------------------------- | --------- |
| `-h`, `--help`           | Print usage                               | M2 ✅     |
| `-v`, `--version`        | Print version                             | M2 ✅     |
| `doctor`                 | Health check (node / paths / API key)     | M2 ✅     |
| `upgrade`                | Print `npm i -g deepcode-cli@latest` hint | M2 ✅     |
| `-p`, `--print <prompt>` | Headless one-shot                         | M8        |

## Session shaping

| Flag              | Effect                                      | Milestone |
| ----------------- | ------------------------------------------- | --------- |
| `--resume [<id>]` | Resume session by ID, or pick interactively | M3        |
| `--continue`      | Continue most-recent session                | M3        |
| `--fork-session`  | Branch from current session, leave original | M3        |

## Mode

| Flag                       | Effect                                                                        | Milestone                               |
| -------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| `--mode <name>`            | `default` / `acceptEdits` / `plan` / `auto` / `dontAsk` / `bypassPermissions` | M2 ✅ (REPL respects), M3 (enforcement) |
| `--permission-mode <name>` | Alias for `--mode` (Claude Code parity)                                       | M2 ✅                                   |
| `--bare`                   | No plugins / MCP / skills — just kernel + tools                               | M5                                      |

## Model & effort

| Flag              | Effect                                          | Milestone |
| ----------------- | ----------------------------------------------- | --------- |
| `--model <id>`    | `deepseek-chat` \| `deepseek-reasoner`          | M2 ✅     |
| `--effort <tier>` | `low` \| `medium` \| `high` \| `xhigh` \| `max` | M2 ✅     |
| `--max-turns <n>` | Cap agent loop turns                            | M2 ✅     |

## System prompt

| Flag                                 | Effect                        | Milestone                          |
| ------------------------------------ | ----------------------------- | ---------------------------------- |
| `--system-prompt "<text>"`           | Replace default system prompt | M2 parser ✅; agent integration M3 |
| `--append-system-prompt "<text>"`    | Append to default             | M3                                 |
| `--append-system-prompt-file <path>` | Append from a file            | M3                                 |

## Tool whitelisting

| Flag                      | Effect                  | Milestone                    |
| ------------------------- | ----------------------- | ---------------------------- |
| `--allowedTools "A,B,C"`  | Only these tools loaded | M2 parser ✅; enforcement M3 |
| `--disallowedTools "A,B"` | Block these tools       | M2 parser ✅; enforcement M3 |

## Headless / CI (`-p` only)

| Flag                                      | Effect                               | Milestone |
| ----------------------------------------- | ------------------------------------ | --------- |
| `--output-format text\|json\|stream-json` | Output shape                         | M8        |
| `--json-schema <path>`                    | Enforce final-output JSON schema     | M8        |
| `--include-partial-messages`              | Stream partial deltas as JSON events | M8        |
| `--verbose`                               | Print LLM / tool call traces         | M3        |

## Overrides

| Flag                          | Effect                                            | Milestone                           |
| ----------------------------- | ------------------------------------------------- | ----------------------------------- |
| `--settings <path>`           | Override settings.json discovery                  | M2 parser ✅; loader integration M3 |
| `--agents <dir>`              | Override sub-agents dir                           | M4                                  |
| `--mcp-config <path>`         | Override MCP server config                        | M3                                  |
| `--plugin-dir <dir>`          | Mount a local plugin dir                          | M5                                  |
| `--plugin-url <gh:user/repo>` | Mount a remote plugin                             | M5                                  |
| `--no-plugins`                | Disable all plugins for this run                  | M5                                  |
| `--strict`                    | Strict mode (official marketplace only, no hooks) | M5                                  |

## Configuration discovery order

1. `~/.deepcode/settings.json` — user-level
2. `<project>/.deepcode/settings.json` — project-level (commits to git)
3. `<project>/.deepcode/settings.local.json` — local override (gitignore'd)

Later layers override earlier ones (deep-merge for objects, arrays replace).

## Credentials discovery order

1. `apiKeyHelper` from settings.json (executed each call, refresh on 401)
2. macOS Keychain (service=`deepcode`, account=`deepseek-api-key`)
3. `~/.deepcode/credentials.json` (chmod 600)
4. `DEEPSEEK_API_KEY` / `DEEPSEEK_AUTH_TOKEN` environment variables

`DEEPSEEK_AUTH_TOKEN` (Bearer) takes precedence over `DEEPSEEK_API_KEY` (X-Api-Key) when both are set.

## Exit codes

| Code | Meaning                             |
| ---- | ----------------------------------- |
| `0`  | Success                             |
| `1`  | General error (e.g. no credentials) |
| `2`  | Unknown flag / bad argument         |
| `3`  | Tool denied by permissions          |
| `4`  | `--max-turns` reached               |
| `5`  | API key invalid                     |

(Codes 3-5 are reserved for M3+ enforcement.)

## Environment variables

| Variable                           | Effect                                                  |
| ---------------------------------- | ------------------------------------------------------- |
| `DEEPSEEK_API_KEY`                 | API key fallback (used if Keychain/file empty)          |
| `DEEPSEEK_AUTH_TOKEN`              | Bearer token (takes precedence over API key)            |
| `DEEPCODE_SESSIONS_DIR`            | Override `~/.deepcode/sessions/`                        |
| `DEEPCODE_EFFORT_LEVEL`            | Default effort (overrides settings, beneath `--effort`) |
| `DEEPCODE_STATUS_LINE_DEBOUNCE_MS` | Statusline refresh frequency (default 5000)             |
| `DEEPCODE_API_KEY_HELPER_TTL_MS`   | apiKeyHelper refresh period (default 300_000)           |
