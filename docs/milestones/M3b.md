# M3b — Agent loop integration (mode × permission × hooks)

> **Status**: ✅ Complete · **Branch**: `feat/m3b-agent-integration-mcp`

## Shipped

- `harness/tool-dispatcher.ts` — the central gate that combines mode + permission + PreToolUse hook into a single verdict. Implements the decision flow from `docs/design/sandbox-plan-worktree.md` §5.1.
- Agent loop now consults `dispatchToolCall()` for every tool invocation when `mode` is provided. Plan-blocks short-circuit before hooks; deny short-circuits before tool execution; ask invokes `approval` callback.
- PostToolUse hook fires after every tool execution with the result.
- 9 new tests in `tool-dispatcher.test.ts` covering all decision paths.

## Verification

- `pnpm test` → 206 passed / 4 skipped / 0 failed (was 197).
- `pnpm typecheck` / `pnpm build` → green.

## Deferred to M3c

- MCP client (stdio transport, list/call tools)
- Compaction (LLM summarizer at threshold)
- statusLine runner (JSON-on-stdin)
- `/init` multi-phase
- `auto` classifier mode (LLM-judged)
- Hook handler types beyond `command`
- Hook `if` field

These are independent subsystems; each gets its own PR.

## CLI integration

The CLI REPL (M2) does **not** yet pass `mode` to `runAgent()`, so tool calls
still flow unmolested through the M1 path. Plumbing that is M3c (5-line change
in `repl.ts` once compaction + statusLine are in place to make a coherent demo).
