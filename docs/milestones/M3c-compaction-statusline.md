# M3c · Compaction + StatusLine + CLI flag wiring

> **Status**: ✅ Shipped · **Branch**: `feat/m3c-compaction-statusline-flags`

## Shipped

- `compaction/index.ts` — `compact(history, { provider, keepFirstPairs, keepLastMessages })` + `shouldCompact({ usage, contextWindow, threshold })`. Strategy: keep first anchor msgs + summarize middle via cheap chat call + keep recent tail.
- `harness/statusline.ts` — `StatusLineRunner` periodic exec + `runStatusLineCommand` JSON-on-stdin contract; respects `DEEPCODE_STATUS_LINE_DEBOUNCE_MS` env override; output cap 200 chars; 2s command timeout.
- CLI flag wiring:
  - `--system-prompt` replaces default
  - `--append-system-prompt` / `--append-system-prompt-file` append
  - `--allowedTools` / `--disallowedTools` filter ToolRegistry at construction
  - `--max-turns` plumbed into runAgent

## Tests (16 new, 281 total)

- compaction/index.test.ts (8): unchanged-when-short, compacts middle, preserves anchor + tail, custom summarizerModel, usage report, tool_use/tool_result in summary prompt + shouldCompact threshold logic
- harness/statusline.test.ts (8): trimmed stdout, stdin payload, 200-char cap, timeout → empty, exit-nonzero → empty, empty config → empty, Runner change-only updates, env-var debounce override

## NOT in this PR

- Auto compaction trigger inside agent loop (M3c-ext — wire `shouldCompact` check after each turn)
- StatusLine actual render in REPL (deferred to next PR or M6 GUI)
- `/init` multi-phase
- `auto` classifier mode
- Remaining 4 hook handler types
