# Changelog

All notable changes to DeepCode are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-08-02

Largest release so far: the desktop app, VS Code extension, and LSP server stop
being independent runtimes and become thin clients of a single supervised
app-server. Landed as a reviewed 31-PR stack (#180–#210) plus dependency work.

### 🔒 Security

- **The central tool gate could be skipped entirely.** `runAgent` gated dispatch
  behind `if (opts.mode)`, and `mode` was optional — so any caller that omitted
  it bypassed mode policy, permission rules, and the PreToolUse hook chain, and
  every tool call was allowed. Both VS Code entry points and the LSP handler were
  such callers. `mode` is now required, with a fail-safe fallback for untyped
  callers. (#181)
- **Provider credentials left the desktop renderer.** The Tauri WebView no longer
  holds API keys or runs the agent loop; `read_credentials` is replaced by a
  presence-only `credential_status`, and the renderer's read-only file preview
  refuses to resolve the backend credentials path. (#192, #207)
- **Untrusted project settings can no longer widen policy** — provider/base-URL,
  model cost, permissions, sandbox, environment, hooks, MCP, worktree, update,
  and executable config are all gated by directory trust, with leaf-level
  provenance tracking and prototype-pollution rejection. (#197)
- **Project hook commands now require exact-definition review** on top of
  directory trust, with automatic invalidation when a definition changes.
  New `deepcode hooks list|trust|revoke`. (#201)
- **Tauri capabilities cut to least privilege** — the filesystem plugin is
  removed entirely, `dialog`/`opener`/`process` narrowed to single permissions,
  and the provider API dropped from the renderer CSP. (#209)
- **`/add-dir` is enforced.** `permissions.additionalDirectories` was declared in
  the schema but consumed nowhere; it now folds into the sandbox's writable roots
  across every host — CLI, headless, and app-server (desktop/VS Code/LSP). (#214)
- Real cancellation: LSP `abort` previously deleted a bookkeeping entry and
  reported success while the turn kept running. Aborts now propagate through
  providers, pending approvals, and POSIX process groups. (#181, #184)

### ✨ Added

- **App-server** (`deepcode app-server`) — single-owner, line-delimited JSON
  protocol with atomic thread snapshots, orphaned-turn recovery on resume, and
  backpressure that may drop only transient deltas, never completed items.
  (#186, #188, #190)
- **Desktop runtime as a supervised Node 22 sidecar**, checksum-pinned and signed
  before the app bundle. (#187, #189)
- **Canonical session v1** format shared by core and desktop, with a
  cross-process writer lock, legacy dual-read, and exact-line corruption
  diagnostics. Legacy files are never rewritten. (#182, #185, #191)
- **Workspace diff review** (`workspace/diff`) — shell-free Git invocation with
  inherited `GIT_*` stripped, external diff/textconv disabled, and refusal to
  read untracked symlink targets or binary content. (#203)
- **Review findings lifecycle** — `SubmitReviewFinding`, `review/apply` (single
  and batch), and conflict-safe `review/revert` with all-files compare-and-swap
  against exact post-images. Apply and revert run as ordinary turns, so they keep
  normal permissions, approvals, hooks, sandboxing, cancellation, and snapshots.
  (#204, #205, #206)
- **Trust-aware config diagnostics** surfaced through `deepcode doctor`, Desktop
  About, VS Code, and the LSP bridge — value-free, from one shared DTO. (#197, #198)
- **Redacted structured tracing** with a strict metadata allowlist, mode-0600
  bounded NDJSON, and `deepcode diagnostics export`. Best-effort: a broken trace
  sink cannot affect protocol or execution. (#202)
- **Release gates** over real packaged artifacts — bundle budgets, protocol
  journeys, and a thin-client scan asserting clients never import the provider,
  credentials, agent loop, or `RuntimeHost`. npm publication now waits until the
  VSIX and signed DMG succeed. (#208)
- Desktop Playwright protocol journey in CI, driving the production renderer
  bridge. (#193)

### ♻️ Changed

- `RunAgentOptions.mode` is now **required** (breaking for library consumers).
- Host services are assembled once behind `RuntimeHost` instead of per-client. (#184)
- MCP servers and plugins are composed inside a turn-scoped lease with
  deterministic teardown on success, interruption, preprocessing failure, and
  shutdown. Plugin trees are hashed whole and symlinks rejected. (#199, #200)
- `react` 18 → 19, `react-dom` 18 → 19 (React 19 removed the global `JSX`
  namespace; 38 annotations across 25 files now import it explicitly). (#211)
- `vite` 5 → 8 and `@vitejs/plugin-react` 4 → 6. Previously blocked by rolldown
  failing to resolve `openai` from the renderer graph — removing provider code
  from renderer bundles in #192 cleared it. (#212)
- `typescript-eslint` 8.18 → 8.65; root lint is now `--max-warnings=0`. (#213, #210)
- GitHub Actions: `checkout` 6→7, `setup-node` 6→7, `cache` 4→6,
  `download-artifact` 4→8 (v8 fails on digest mismatch instead of warning).
  (#177, #178, #179, #155)

### ⚠️ Upgrade notes

- **The macOS desktop app grows from ~6.7 MB to ~115 MB.** That is the cost of
  bundling a Node 22 sidecar so provider credentials and the agent loop leave the
  WebView. Deliberate trade, measured in #187.
- **Plugins are not OS-sandboxed.** The capability RPC gates the supported plugin
  API; it is not a boundary against a plugin calling Node APIs directly. Earlier
  docs overstated this. Treat third-party plugins as trusted code. (#200, #209)
- `@types/vscode` stays pinned at `^1.85.0` to match `engines.vscode`; raising it
  would drop support for VS Code 1.85–1.124.

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
  - status diagnostics + docs links (replacing the boxed table layout
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
