# M1 validation report — real DeepSeek API

> Validated 2026-05-28. Used a real API key (since rotated by user) to verify the
> M1 provider/agent code paths actually work against api.deepseek.com.

## What was validated

1. **HTTP connectivity** — `/v1/models` and `/v1/chat/completions` both reachable with a Bearer token.
2. **Available models** — `/v1/models` returns `deepseek-v4-flash` and `deepseek-v4-pro`.
3. **Alias compatibility** — `model: "deepseek-chat"` and `model: "deepseek-reasoner"` are still accepted; they route to the V4 backing models. Stays stable for our use.
4. **Text streaming** — chunk shape `{choices:[{delta:{content:"..."}}]}` matches our `mockFetch` test fixtures exactly.
5. **Tool-call streaming** — increments arrive as `{choices:[{delta:{tool_calls:[{index:0, function:{arguments:"..."}}]}}]}` with `id`/`name` only in the first chunk for that index — exactly what our `assembles tool_use blocks` test fixture mocks.
6. **`deepseek-reasoner` reasoning_content** — flows in `delta.reasoning_content` and our provider correctly surfaces it as a `thinking` ContentBlock + counts `usage.completion_tokens_details.reasoning_tokens`.

## End-to-end runs

| Scenario | Result |
|---|---|
| Agent reads a file via Read tool | ✓ 2 turns, 2523 in / 137 out tokens, ended `end_turn`, correct answer |
| Reasoner solves a math word problem | ✓ 1 turn, 1188 in / 500 out / 427 reasoning, both `thinking` + `text` blocks streamed |
| `/v1/models` + alias mapping | ✓ documented in §3.1 update |

## Changes in this PR

- `packages/core/src/types.ts` — expand `DeepSeekModel` union to include `deepseek-v4-flash` / `deepseek-v4-pro` (alongside the legacy aliases). Added a comment block explaining the alias mapping observed.
- `packages/core/src/providers/deepseek.ts` — extend `DEEPSEEK_MODELS` table with the two V4 entries.
- `packages/core/src/providers/deepseek.live.test.ts` (new) — three live-API integration tests. Opt-in via `DEEPCODE_LIVE_TESTS=1` so default `pnpm test` doesn't burn tokens. All three pass.

## Effort levels — still not measured

The numbers in `docs/design/effort-levels.md` §3.2 remain design-only — I validated the API surface, not yet the perf-cost-quality curve per effort tier. That's still M1.5 work (a future `scripts/effort-bench.ts`).

## What this proves

The M1 unit tests (mocked) were faithful representations of real API behavior — no behavioral surprises. The provider, agent loop, sessions, snapshots, tool dispatch all work end-to-end against real DeepSeek. **The biggest "unknown" from MORNING_REPORT.md is now closed.**

## What this does NOT prove

- Large-context behavior (we tested with ~2.5k tokens)
- Multi-tool parallel calls in a single turn
- Long-running streams (timeout edge cases)
- Behavior under rate limits or transient 5xx
- DeepSeek's exact billing — for that we still need a real benchmark script
