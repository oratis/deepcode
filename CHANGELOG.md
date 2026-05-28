# Changelog

All notable changes to DeepCode are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-05-28

### Fixes — caught from user playtest of 0.1.1
- **Tool input field-name fix.** `tool_write` (and read / edit / bash /
  glob / grep) were failing with `missing required key filePath` when
  DeepSeek emitted snake_case keys but the wrapper expected camelCase.
  All 6 Mac tool wrappers now accept either case via a tolerant
  `pickStr / pickNum / pickBool` helper.
- **Project folder picker.** First launch now shows a "Pick a project
  folder" overlay before chat. The chosen path is persisted to
  `~/.deepcode/settings.json#projectPath` and threaded into every
  agent turn as `cwd`. Sidebar shows the active project + a `⇄`
  switch button.
- **Session persistence.** Each turn now writes a JSONL session under
  `~/.deepcode/sessions/<id>.jsonl`. Sidebar refreshes after every
  turn so newly-started sessions appear in the Today bucket.
- **Mid-turn controls locked.** Mode / model / effort dropdowns disable
  while the agent is responding or awaiting approval (was previously
  freely switchable mid-turn).
- **Inspector rail buttons work.** All 6 rail icons now route to
  their respective screens (Plan → Permissions, Sessions, Plugins,
  Skills, MCP, About, Settings). Expand-chevron ‹ still deferred.

### UX improvements
- **Proper dropdowns** for mode / model / effort — click-popover with
  inline descriptions and meta annotations, replacing the brittle
  click-to-cycle pattern.
- 5 official mode options surfaced (default / acceptEdits / plan /
  dontAsk / bypassPermissions) instead of 3.
- ReplScreen carries projectPath through to the system prompt so the
  LLM knows where it's working.

## [0.1.1] — 2026-05-28

### Visual redesign — phase 1
Major UI overhaul aligning the desktop client to `docs/VISUAL_DESIGN.html`.
Phase 1 covers the three highest-traffic surfaces: Onboarding, Sessions
sidebar, and the main Chat / REPL view. Other six screens land in 0.1.2.

- **Design tokens.** DeepSeek brand blue (`#4D6BFE`) + soft (`#E8EDFF`) +
  mint accent (`#14E4A2`) + dark-mode neutral palette baked into CSS vars
- **Brand mark.** Elephant SVG logo (matches the design spec's gradient
  brand badge) replaces the previous emoji-free placeholder
- **3-column desktop shell.** 240 px sessions sidebar | 1 fr chat main |
  48 px inspector rail (collapsed by default). Inspector rail shows Plan
  badge, context-usage dot, recent files, session info, settings.
- **Chat redesign.** Tool calls are now bordered cards with action ·
  target · status-badge head + tc-body for output/diff. Inline diff
  uses `diff-add` / `diff-del` colors. Approval buttons (Approve /
  Reject / Always allow) appear immediately under the relevant tool
  card — never at screen bottom.
- **Composer redesign.** New rounded box with toolbar (+ menu / mic /
  mode badge / model picker / send) and a context-usage bar showing
  tokens used + estimated cost.
- **Onboarding redesign.** Hero gradient + big brand mark + gradient
  text headline matching the design spec.

### Conversation flow
- Carries over the `dangerouslyAllowBrowser: true` fix from 0.1.0 so the
  OpenAI SDK's browser-environment guard doesn't trip in the Tauri webview
- Surfaces full error stack traces in the chat stream when the agent
  loop throws — easier to diagnose API key / network issues from inside
  the app

## [0.1.0] — 2026-05-28

### Mac client + CLI baseline
- **CLI:** agent loop, 30+ slash commands, MCP support, plugin system,
  sandbox, hooks, modes, skills, sub-agents, output styles, effort
  levels, headless `-p` mode
- **Desktop (Tauri):** 9 screens (Onboarding / REPL / Sessions /
  Plugins / Skills / Permissions / MCP / Settings / About), real
  `runAgent` in renderer, Tauri auto-updater wired to GitHub
  Releases, xterm.js terminal, Monaco file panel with Source / Diff
  / History
- **M7/M8 polish:** inline approval UI with Always-allow persistence,
  `/rewind` 5-op snapshot rollback, `DEEPCODE_EFFORT_LEVEL` env var,
  desktop effort selector, Vim-mode wiring in composer, cron daemon
  install/uninstall scripts
- **Apple notarization:** signed + notarized + stapled DMG (4.2 MB
  Apple Silicon)
- **VS Code extension + LSP server** calling the real `runAgent`
