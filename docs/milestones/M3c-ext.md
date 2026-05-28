# M3c-ext · Hook handlers + auto-compact + apiKeyHelper refresh

> **Status**: ✅ Shipped · **Branch**: `feat/m3c-ext-hooks-autocompact`

## Shipped

- **HookDispatcher**: 3 new handler types beyond `command`:
  - `http` — POST JSON payload to URL, response = handler stdout (+ `allowedHttpHookUrls` whitelist enforcement)
  - `prompt` — synthesizes `additionalContext` JSON output (zero exec)
  - `mcp_tool` / `agent` — stubs that emit "stub" stderr (paired implementations in M5+)
- **`if` field on hook handlers** — permission-rule syntax filters at handler level (e.g. `if: "Bash(git push:*)"`)
- **`ApiKeyHelperRefresher`**: 5-min TTL cache + `.invalidate()` for 401 recovery + `DEEPCODE_API_KEY_HELPER_TTL_MS` env override
- **Auto-compact in agent loop**: `runAgent({ autoCompact: { contextWindow, threshold } })` triggers summarizer when usage crosses threshold; tokens counted toward total usage; failure non-fatal (continues with full history)
- REPL wires `autoCompact` (128k @ 80%) + `allowedHttpHookUrls` automatically

## Tests (9 new)

- hook handlers: http POST roundtrip + allowedHttpHookUrls reject + prompt-handler additionalContext + mcp_tool/agent stubs + if-field permission filter
- credentials: ApiKeyHelperRefresher cache hit / refresh / invalidate / env-var TTL override

Total: 256 core + 41 CLI = 297 passing / 7 skipped / 0 failed (was 281).
