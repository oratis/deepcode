# Changelog

All notable changes to DeepCode are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] — 2026-05-28

### 🐛 Critical fix — Bash tool calls were always reporting "error"
The Rust output structs (`ReadOk`, `EditOk`, `BashOk`) returned fields
in snake_case (`exit_code`, `lines_total`, `diff_preview`) while the
TS wrappers read them in camelCase. Result: `r.exitCode` was always
`undefined`, so `undefined !== 0` made every Bash tool result render
with a red `✕ error` badge — even when the underlying command had
exit code 0. Read + Edit silently dropped diff previews + line totals
for the same reason.

Fixed by adding `#[serde(rename_all = "camelCase")]` on the three
output structs. Glob and Grep were already single-word fields, no
change needed.

### Polish carry-over
- **Keyboard shortcuts**: ⌘N starts a new session, ⌘, opens Settings,
  ⌘/ opens About. New `src/lib/keyboard.ts` helper.
- **Switching project now clears chat history** so the next message
  runs against the fresh cwd (was: old conversation lingered with
  new project context).

## [0.1.5] — 2026-05-28

### Polish + dead-code removal
- **Composer `+` menu wired**. Click `+` → popover with three actions:
  Attach file (opens native file picker, inserts `@<absolute-path>`
  into the textarea), Slash command (prepends `/`), Memory note
  (prepends `#`). Replaces the previously-disabled `+` button.
- **Plugins toggle works.** Click the switch on any plugin → writes
  to `settings.disabledPlugins[]` so the change survives restart
  and the agent picks it up on the next turn. Optimistic UI with
  rollback on failure.
- **Dead code removed.** Deleted unused screens (FilePanel.tsx —
  Monaco file panel not surfaced in new shell; legacy Chat.tsx stub;
  Nav.tsx — only the type was needed, moved to `src/types/screens.ts`;
  Terminal.tsx — xterm side-pane wasn't wired in). Trimmed deps:
  removed `@monaco-editor/react`, `monaco-editor`, `@xterm/*`,
  `tailwindcss`, `postcss`, `autoprefixer` — none referenced any
  more.
- ScreenName type moved to `src/types/screens.ts` (single source of
  truth for App.tsx + InspectorRail).

## [0.1.4] — 2026-05-28

### Robustness + polish
- **React error boundary** wraps the entire app. Uncaught render errors
  now show a recoverable error panel ("DeepCode crashed") with the
  stack trace + reload button, instead of leaving the user with a
  blank dark window.
- **Unhandled promise rejection** logger added at app entry so devtools
  surfaces async errors that would otherwise vanish.
- **System messages** redesigned — thin centered hint instead of a row
  with avatar + author label. Looks much less like an interruption.
- Bundles `release.yml` Tauri rewrite + `docs/RELEASING.md` from 0.1.3.

## [0.1.3] — 2026-05-28

### Visual redesign — phase 2
- **All 7 utility screens** (Sessions / Plugins / Skills / Permissions /
  MCP / Settings / About) redesigned to match `docs/VISUAL_DESIGN.html`.
  New shared `Screen` + `Card` + `Row` primitives.
- **About** is now a proper hero card with brand mark + gradient text
  + status diagnostics + docs links (replacing the boxed table layout
  the user shared as visually off-spec).
- **Settings** has a GUI/JSON segmented toggle: GUI shows a quick
  reference + filterable flat table; JSON shows a live-validated
  textarea. Save persists to ~/.deepcode/settings.json (was
  view-only).
- **Permissions** Save now actually persists rules (was stubbed).
- **Sessions** has search + click-to-resume with relative time.
- **Plugins** surfaces trust badges + custom Toggle switches.
- **Skills** has 2-column filter-list + SKILL.md preview.
- **MCP** uses status badges + tool count + inline error tail.

### Release pipeline (M9)
- `release.yml` rewritten for Tauri (was Electron-era). Tag → CI
  → npm publish + signed/notarized DMG + GitHub Release with notes.
- `docs/RELEASING.md` explains the 6 secrets needed and step-by-step.

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
