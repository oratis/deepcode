# `@deepcode/core` API Reference

> **Status**: M1 — kernel MVP shipped. Surface area will grow per milestone.
> **Spec**: `DEVELOPMENT_PLAN.md` §3.1 (provider), §3.2 (tools), §3.5 (sessions).

## At a glance

```ts
import {
  runAgent,
  DeepSeekProvider,
  ToolRegistry,
  SessionManager,
  BUILTIN_TOOLS,
} from '@deepcode/core';

const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! });
const tools = new ToolRegistry(); // 6 P0 tools auto-registered
const sessions = new SessionManager(); // ~/.deepcode/sessions/ by default
const session = await sessions.create(process.cwd());

const result = await runAgent({
  provider,
  tools,
  systemPrompt: 'You are DeepCode. Help with code.',
  userMessage: 'List the TypeScript files in src/.',
  model: 'deepseek-chat',
  cwd: process.cwd(),
  session: { manager: sessions, id: session.id },
  enableSnapshots: true,
  onEvent: (e) => {
    if (e.type === 'text_delta') process.stdout.write(e.text);
  },
});

console.log(`\n— ${result.turnsUsed} turns, ${result.usage.outputTokens} output tokens`);
```

## Exports

### Providers

| Symbol                               | Purpose                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `DeepSeekProvider`                   | OpenAI-compatible streaming provider for DeepSeek (`api.deepseek.com/v1`).                |
| `DEEPSEEK_MODELS`                    | Per-model metadata: `ctx` (128k) + `maxOutput` (8192 hard limit).                         |
| `EFFORT_PARAMS`                      | 5-tier effort → `{ maxTokens, temperature }` mapping. See `docs/design/effort-levels.md`. |
| `Provider`                           | Interface — extend to add new LLM backends.                                               |
| `ProviderResult` / `ProviderRunOpts` | Provider contract types.                                                                  |

`DeepSeekProvider` options:

```ts
new DeepSeekProvider({
  apiKey: 'sk-...', // OR
  authToken: 'bearer-...', // Bearer alternative (§3.4 dual-header)
  baseURL: 'https://api.deepseek.com/v1', // default
  fetch: customFetch, // for tests
});
```

Streaming events flow through `ProviderStreamHandlers.onTextDelta` and `.onThinkingDelta`. The provider returns assembled `ContentBlock[]` (text / thinking / tool_use).

### Tools

Six P0 tools registered by default via `BUILTIN_TOOLS` and `ToolRegistry`:

| Tool        | Input schema highlights                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ReadTool`  | `file_path` (abs or cwd-relative) + optional `offset` / `limit`. Returns line-numbered content.                                  |
| `WriteTool` | `file_path` + `content`. Creates parent dirs.                                                                                    |
| `EditTool`  | `file_path` + `old_string` + `new_string` (+ `replace_all`). Fails on missing or non-unique `old_string` (unless `replace_all`). |
| `BashTool`  | `command` (+ `timeout`, `description`, `run_in_background` [M3.15.3 only]). Captures stdout/stderr/exitCode.                     |
| `GrepTool`  | `pattern` + optional `path` / `glob` / `type` / `output_mode` / `-i` / `-n` / `head_limit`. Uses ripgrep.                        |
| `GlobTool`  | `pattern` + optional `path` / `limit`. Built-in `fs.glob`. Sorts by mtime desc.                                                  |

Extend the registry:

```ts
const tools = new ToolRegistry();
tools.register(myCustomTool);
```

### Sessions

```ts
const sessions = new SessionManager({ root: '~/.deepcode/sessions' });

const meta = await sessions.create(cwd, { model: 'deepseek-chat', title: 'fix bug' });
await sessions.append(meta.id, message);
const loaded = await sessions.load(meta.id); // { meta, messages }
const list = await sessions.list(); // sorted by updatedAt desc

// Snapshots (pre/post Edit-Write, drives §3.15.9 rewind)
await sessions.snapshot({ sessionId: meta.id, cwd, filePath: 'a.ts', reason: 'pre-Edit', seq: 1 });
const snaps = await sessions.snapshots(meta.id);
await restoreSnapshot(snaps[0]!);
```

Storage layout:

```
<root>/<sessionId>.meta.json   # meta JSON
<root>/<sessionId>.jsonl       # one StoredMessage per line
<root>/<sessionId>/snapshots/  # blob files + manifest.jsonl
```

### Agent loop

```ts
const result = await runAgent({
  provider, tools, systemPrompt, userMessage,
  history: [],         // resume from previous turns
  model: 'deepseek-chat',
  maxTokens: 4096,
  temperature: 0.4,
  maxTurns: 16,        // safety cap
  cwd: process.cwd(),
  signal,              // AbortSignal
  session: { manager, id },
  enableSnapshots: true,
  onEvent: (e) => { ... },
});
// result.stopReason: 'end_turn' | 'max_turns' | 'aborted' | 'error'
// result.history:    accumulated messages
// result.turnsUsed:  provider round-trips
// result.usage:      aggregate tokens
```

`AgentEvent` discriminants: `text_delta` / `thinking_delta` / `tool_use` / `tool_result` / `turn_complete` / `usage` / `error`.

## Type re-exports

All of `types.ts` is re-exported. Highlights:

- `ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock`
- `StoredMessage = { role, content, timestamp? }`
- `ToolDefinition` / `ToolContext` / `ToolResult` / `ToolHandler`
- `Mode` / `Effort` / `DeepSeekModel` / `HookEvent` / `HookHandlerType`

## What M1 does NOT include

Coming in later milestones (see `DEVELOPMENT_PLAN.md` §6):

| Feature                                                        | Milestone |
| -------------------------------------------------------------- | --------- |
| `--mode`, permissions matcher, trust dialog                    | M2        |
| 30+ slash commands wiring                                      | M2        |
| settings.json three-layer config                               | M2        |
| Hooks (9 events × 5 handlers), MCP, memory, compaction         | M3        |
| Sandbox subsystem (bwrap / sandbox-exec)                       | M3.5      |
| Skills, sub-agents, output styles, effort levels full plumbing | M4        |
| Plugin system + marketplace                                    | M5        |
| Mac desktop client + auto-update                               | M6        |
| Right-side file panel + rewind UX                              | M7        |
| Vim mode, voice input, headless `-p`                           | M8        |

## Tests

`pnpm --filter @deepcode/core test` — 62 tests pass, 4 skipped (ripgrep-dependent if not installed). Coverage:

- 6 tool handlers (read/write/edit/bash/grep/glob)
- Sessions storage + snapshots roundtrip
- DeepSeekProvider mocked-fetch streaming + tool calls + reasoning_content + message-shape conversion
- Agent loop: end_turn / tool dispatch / unknown tool / maxTurns cap / abort signal / session persistence + snapshots / multi-turn history feeding

Run a single test file:

```bash
pnpm --filter @deepcode/core test -- src/agent.test.ts
```
