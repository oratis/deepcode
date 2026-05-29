# DeepCode — Session Handoff

A new Claude Code session can pick up DeepCode from this document alone. It's
intentionally dense — read once top-to-bottom, then keep open as a map.

---

## 1. What DeepCode is

A Claude-Code-parity coding agent driven by **DeepSeek** (not Anthropic) as the
underlying model. Ships as:

- **CLI** — `deepcode` binary (Node 22), the primary surface for headless +
  power-user flows
- **Mac desktop client** — Tauri 2 (Rust backend + WebKit2 webview, React + raw
  CSS renderer)
- **VS Code extension** — wraps the LSP server (`apps/vscode`)
- **LSP server** — JSON-RPC over stdio (`apps/lsp`), exposed to any LSP client

DeepCode is **not** a Claude/Anthropic product. The brand color is DeepSeek blue
(`#4D6BFE`). The mascot is an elephant (the SVG mark in `BrandMark.tsx`).

---

## 2. Current state — May 28 (overnight session ended)

| Aspect | State |
| ------ | ----- |
| Main branch | `229afc3` — `fix(v0.1.6): Bash tool calls always reported "error"` (#75) |
| Shipped DMG | `release-artifacts/DeepCode-0.1.6-arm64.dmg` (4.0 MB, notarized + stapled, SHA `aed79038…7a84`) |
| CLI version | `0.1.6` (not yet npm-published) |
| Test status | 558 passing / 10 skipped — `pnpm -r test` |
| Typecheck | clean across all 7 workspaces |
| Release pipeline | `.github/workflows/release.yml` ready; 6 GitHub Secrets needed (see `docs/RELEASING.md`) |
| v1.0.0 tag | **not pushed** — user's call |

All 9 design-spec screens are aligned to `docs/VISUAL_DESIGN.html`:
Onboarding · Project picker · Chat (3-col shell) · Sessions · Plugins · Skills ·
Permissions · MCP · Settings · About.

---

## 3. Repo layout (pnpm workspaces)

```
DeepCode/
├── packages/
│   ├── core/          # @deepcode/core — the kernel (provider, agent loop, tools,
│   │                  #   MCP, sandbox, hooks, sessions, etc.). UI-agnostic. Pure
│   │                  #   TS, compiled to ./dist/. ALL other apps depend on this.
│   └── shared-ui/     # Types-only shared between desktop + future renderers.
├── apps/
│   ├── cli/           # `deepcode` binary. Owns the REPL + slash commands.
│   ├── desktop/       # Tauri 2 app. React renderer in src/. Rust in src-tauri/.
│   ├── lsp/           # LSP server (stdio JSON-RPC + custom deepcode/agentEvent).
│   └── vscode/        # VS Code extension. Wraps the LSP + provides webview chat.
├── scripts/           # sign-and-notarize.sh, make-dmg.sh, install-cron-daemon.sh,
│                      #   gen-release-notes.ts.
├── docs/              # Design spec, milestones, this file, RELEASING.md, etc.
├── release-artifacts/ # Final shipped DMGs + CLI tarballs.
└── .github/workflows/ # ci.yml + release.yml.
```

---

## 4. Tech stack quick reference

| Layer | Stack |
| --- | --- |
| Renderer (desktop) | React 18 + raw CSS in `src/index.css` (no Tailwind any more), Vite 5 |
| Bundler | Vite for desktop; tsc for everything else |
| Desktop backend | Rust + Tauri 2; plugin-dialog / fs / opener / process / shell / updater |
| Provider | OpenAI SDK against `https://api.deepseek.com/v1` — uses `dangerouslyAllowBrowser: true` for Tauri |
| CLI | Node 22, ESM, `readline` for REPL |
| MCP client | JSON-RPC over stdio + HTTP/SSE (in core) |
| Sandbox | macOS `sandbox-exec` profiles + Linux `bwrap` (in core, M3.5) |
| Tests | vitest everywhere (550+ tests) |

---

## 5. Build / dev / test commands

From repo root:

```bash
# Install
pnpm install

# Build everything (compiles packages/core first, then apps)
pnpm build

# Typecheck every workspace
pnpm typecheck

# Test every workspace (vitest run recursively + root scripts/)
pnpm -r test
# OR via the root chain that includes scripts:
pnpm test

# Desktop dev (Tauri hot-reload — opens a window)
pnpm --filter @deepcode/desktop tauri:dev

# Desktop production build (Tauri release + Vite bundle)
pnpm --filter @deepcode/desktop tauri:build

# Sign + notarize the desktop app into a notarized DMG
# Requires: Apple Developer ID cert in keychain + DEEPCODE_NOTARY keychain profile
bash scripts/sign-and-notarize.sh
# Output lands at apps/desktop/src-tauri/target/<TARGET>/release/bundle/dmg/

# CLI dev
pnpm --filter deepcode-cli build
node apps/cli/dist/index.js --help
```

**Pre-commit hook** runs `pnpm typecheck && pnpm test` via husky. It will block
the commit if anything fails. Don't `--no-verify` lightly.

---

## 6. Critical files (where to look for X)

### Agent + provider
- `packages/core/src/agent.ts` — the agent loop. `runAgent()` is the entry.
  `ApprovalCallback` returns `boolean | 'always'`.
- `packages/core/src/providers/deepseek.ts` — DeepSeek wrapper. **MUST** include
  `dangerouslyAllowBrowser: true` for Tauri renderer.

### Desktop renderer ↔ Tauri bridge
- `apps/desktop/src/lib/mac-agent.ts` — runs `runAgent` in the renderer using
  Mac-flavored tool wrappers. Owns the per-app conversation history. Creates
  session JSONL on first turn.
- `apps/desktop/src/lib/mac-tools.ts` — 6 tool wrappers that route through Tauri
  commands. **Uses `pickStr/pickNum/pickBool`** to tolerate snake_case OR
  camelCase keys from the LLM. Critical gotcha — see §8.
- `apps/desktop/src/lib/window-shim.ts` — installs `window.deepcode.*` so React
  screens have a stable API.
- `apps/desktop/src-tauri/src/commands.rs` — all Tauri commands except tools.
- `apps/desktop/src-tauri/src/tools.rs` — the 6 tool implementations. **All
  output structs must have `#[serde(rename_all = "camelCase")]`** — see §8.
- `apps/desktop/src-tauri/src/lib.rs` — Tauri plugin + handler registration.

### React screens
- `apps/desktop/src/App.tsx` — App shell + screen routing + project-pick gate +
  global keyboard shortcuts.
- `apps/desktop/src/screens/Repl.tsx` — the main chat surface. ~750 lines. Owns
  composer, message rendering, approval flow, effort/model/mode dropdowns,
  Vim mode wiring, system messages.
- `apps/desktop/src/screens/{Onboarding,Sessions,Plugins,Skills,Permissions,
  MCPManager,Settings,About}.tsx` — utility screens. All use the shared
  `Screen + Card + Row + SectionTitle` primitives in `components/Screen.tsx`.
- `apps/desktop/src/components/{BrandMark,Pill,Badge,ToolCard,Dropdown,
  PlusMenu,InspectorRail,Sidebar,ProjectPickerOverlay,UpdateBanner,
  ErrorBoundary}.tsx` — the design-system primitives.
- `apps/desktop/src/types/screens.ts` — canonical `ScreenName` union.

### CLI
- `apps/cli/src/repl.ts` — the readline-based REPL. Owns the agent's run loop
  on the CLI side.
- `apps/cli/src/commands.ts` — slash command registry. ~50 commands incl.
  `/effort`, `/vim`, `/rewind`, `/init`, `/mcp`, etc.
- `apps/cli/src/parse-args.ts` — flag parsing.

### Config / settings
- `packages/core/src/config/loader.ts` — three-layer settings load (user /
  project / local). `appendAllowMatcher()` lives here.
- `packages/core/src/config/types.ts` — the canonical `DeepCodeSettings` shape.
- `packages/core/src/config/permissions.ts` — rule matcher (bare / subcommand /
  prefix / domain).

### Release
- `.github/workflows/release.yml` — tag-driven CI. Builds CLI + Mac DMG +
  publishes both. Needs 6 secrets (`docs/RELEASING.md`).
- `scripts/sign-and-notarize.sh` — the local equivalent.
- `scripts/make-dmg.sh` — pretty DMG with AppleScript-driven Finder layout.

---

## 7. Recent commit timeline (Apr → May)

```
229afc3 fix(v0.1.6): Bash tool calls always reported "error" — Rust serde casing (#75)
19529e0 feat(v0.1.5): + menu wired, plugins toggle real, dead code purged (#74)
7287b34 test(desktop): pick helpers + drop jsdom requirement
4677161 feat(v0.1.4): error boundary + system-message polish (#73)
85667c1 feat(P3, v0.1.3): rewrite release.yml for Tauri + bump 0.1.3 (#72)
1419636 feat(P2): redesign all 7 utility screens per spec (#71)
ecc91f3 fix(v0.1.2): tool casing, project folder picker, sessions, control locking (#70)
0e8a499 feat(v0.1.1): P1 design system + 3 main screens redesigned per spec (#69)
1296aa6 feat(M7+M8): inline approval, /rewind, effort env+selector, vim mode, cron daemon scripts (#68)
9f4a5b9 fix(core): allow OpenAI SDK in Tauri webview (dangerouslyAllowBrowser: true) (#67)
9910b82 fix(scripts): skip Tauri's bundle_dmg.sh — always use make-dmg.sh (#66)
```

`docs/DEVELOPMENT_PLAN.md` is the master plan with milestones M0–M9. The
desktop client landed at M6 (originally Electron, pivoted to Tauri mid-flight).
Sandbox + skills + plugins + IDE bridge + Vim mode + cron daemon all landed
through M3.5 → M8.

---

## 8. Gotchas + patterns we've learned (READ THIS)

### a) Rust ↔ TS field-name casing

Tauri's serde does **not** auto-convert case between Rust and JS. If a Rust
`#[derive(Serialize)]` struct has `exit_code` and JS reads `r.exitCode`, you'll
get `undefined`. We've been bitten by this twice — once subtly in Read/Edit
(missing line counts + diff previews) and once visibly in Bash (every command
showed a red "error" badge because `undefined !== 0` was true).

**Rule:** Every Rust output struct with multi-word fields MUST have

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Foo { pub multi_word_field: ... }
```

Input structs (deserialized from JS) typically use `rename_all = "snake_case"`
because the JS side intentionally sends snake_case to match the tool schema.

Single-word fields are safe both directions — no `rename_all` needed.

### b) LLM emits inconsistent key casing

DeepSeek (and Claude, and most providers) sometimes emit tool-call arguments
with camelCase keys even when the schema says snake_case. The desktop tool
wrappers in `mac-tools.ts` use `pickStr / pickNum / pickBool` helpers that try
both forms. If you add a new tool, follow the pattern:

```ts
const filePath = pickStr(input, 'file_path', 'filePath', 'path');
if (!filePath) return { content: 'Error: missing file_path', isError: true };
```

### c) macOS LaunchServices caches by version

If you ship two builds of the same version (`0.1.0`), users may launch the
old cached binary. The version number is the cache key for LSReplacement.
**Bump the version on every shippable build**, even for tiny fixes.

To force-clear cache on the dev machine:
```bash
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user
```

### d) The vite alias prefers `dist` over `src`

`apps/desktop/vite.config.ts` has:
```ts
{ find: /^@deepcode\/core\/dist\/(.+)$/, replacement: '.../packages/core/dist/$1' }
```

So `import { runAgent } from '@deepcode/core/dist/agent.js'` reads the
**compiled** dist file. If you change `packages/core/src/agent.ts`, run
`pnpm --filter @deepcode/core build` before the next desktop dev/build,
otherwise the renderer uses stale code.

`tsc -b` (which `pnpm build` invokes) handles this automatically.

### e) Notarization keychain profile expires

`DEEPCODE_NOTARY` is a keychain profile created via `xcrun notarytool
store-credentials`. We've seen it disappear between two `notarytool submit`
calls in the same script run (likely keychain re-lock after sleep). Recovery:

```bash
xcrun notarytool store-credentials "DEEPCODE_NOTARY" \
  --apple-id "wangharp@gmail.com" \
  --team-id "9LH9NBX7P4" \
  --password "<app-specific-password>"  # in user's password manager
```

### f) System prompt must communicate cwd

`mac-agent.ts#buildSystemPrompt(cwd)` injects "Working directory: <cwd>" so
the LLM knows where it's operating. If you bypass it, the LLM guesses (badly).

### g) Pre-commit hook can hang on tests

If a test imports `node:fs` and waits on input, the pre-commit hook stalls.
Vitest will time out after 10s by default. If you see "no output" during
commit, run `pnpm -r test` manually first.

---

## 9. Apple signing pipeline

### Local builds
Credentials are in the dev machine's keychain. The dev's Apple ID is
`wangharp@gmail.com`, team `9LH9NBX7P4`. The app-specific password is in the
user's password manager. The `DEEPCODE_NOTARY` keychain profile is set up
once via `xcrun notarytool store-credentials`.

The Developer ID Application cert is at SHA-1 `7DC903001F863681EDBB2B4B18755D15D2F19D3B`
(`Developer ID Application: Bihao Wang (9LH9NBX7P4)`).

Steps the script does (`scripts/sign-and-notarize.sh`):
1. `pnpm tauri build --target aarch64-apple-darwin` → produces `.app`
2. `codesign --force --deep --options runtime --entitlements Entitlements.plist
   --timestamp` the .app
3. `xcrun notarytool submit` the .app (Apple takes 1-5 min)
4. `xcrun stapler staple` the .app
5. `scripts/make-dmg.sh` builds the DMG with the signed+stapled .app inside +
   pretty Finder layout (700×420, 128px icons)
6. `codesign` the DMG itself
7. `xcrun notarytool submit` the DMG (Apple takes 1-5 min)
8. `xcrun stapler staple` the DMG
9. `spctl --assess` verifies

### CI builds
`.github/workflows/release.yml` does the same thing on `macos-14` runners. Needs
6 secrets in repo settings (see `docs/RELEASING.md`):

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `CSC_LINK` (base64 of the Developer ID cert .p12), `CSC_KEY_PASSWORD`
- `NPM_TOKEN`

**The secrets are not configured yet** — user needs to set them before tagging
`v1.0.0`.

---

## 10. What's deferred / TODOs

### v0.2 (next minor)
- Composer `+` menu currently does the basics (Attach file inserts `@path`,
  `/` prefixes a slash, `#` prefixes a memory note). Wire `@path` to actually
  fetch the file contents and inject into the prompt. Wire `#` to write to
  `<project>/DEEPCODE.md`.
- Inspector rail `‹` expand: currently disabled. Build the 320 px full
  inspector panel per design spec screen #3.
- Plugins install from the desktop UI: currently just shows "use CLI" feedback.
  Wire `installFromSpec` via a new Tauri command that calls into core's
  installer.
- VS Code extension polish (M6 work, basic).

### v1.0.0 (M9 milestone — user blocks this)
- Configure the 6 GitHub Secrets
- Write a 5-min demo video
- Build the website landing page (no domain yet)
- Set up `docs/quickstart.md`
- Push the tag — release.yml takes over

### v1.1 (after v1.0)
- JetBrains plugin
- Central marketplace registry (currently each plugin is install-by-URL)
- Image input (DeepSeek vision when it lands, or Qwen-VL fallback)
- LSP server feature expansion

### Known small bugs / cleanups
- `apps/desktop/src/lib/mac-agent.ts#getHistoryLength` is exported but unused
- `apps/cli/src/commands.ts#TodosCommand` has a `// M3c-rest` comment that's
  stale (it's actually wired now)
- No e2e test for the Tauri renderer-to-Rust IPC layer — we rely on the user
  to playtest. Adding playwright + a headless Tauri harness would close the
  loop. Until then, every release cycle needs a manual smoke test.

---

## 11. How to verify a build works

The Tauri binary is a GUI — there's no headless launch. The only way to verify
a release is the user installing the DMG and trying:

1. About screen shows the expected version
2. `Pick a project folder` overlay shows on first launch (or you can manually
   clear `~/.deepcode/settings.json#projectPath` to re-trigger)
3. Send a message → DeepSeek streams a reply
4. Make it run a Bash command → green `✓ done` badge (NOT red `✕ error`)
5. Make it Write a file → file actually lands in the project folder
6. Make it Edit a file with approval → inline panel asks; click Always
   allow → check `~/.deepcode/settings.json#permissions.allow` contains `"Edit"`
7. Close + reopen → sidebar shows the past session in the Today bucket
8. ⌘N → fresh chat, sidebar shows previous session still listed
9. Click each inspector rail icon → respective screen renders without crashing
10. Settings → toggle GUI/JSON → edit a key → Save → reopen confirms persistence

The `verify` and `code-review` skills are available (`Skill` tool) for review
passes if needed.

---

## 12. First questions to ask the user (when picking up cold)

- "Have you installed `release-artifacts/DeepCode-0.1.6-arm64.dmg`? What does
  About show?"
- "Is there a specific bug from a screenshot you want me to fix, or new
  feature to add?"
- "Are you ready to tag `v1.0.0` (and have the 6 GitHub Secrets configured)?"
- "Do you want to keep iterating on the Mac client or pivot to the v1.1 work
  (JetBrains / marketplace / image)?"

---

## 13. Style + conventions

- Conventional commits, mostly `feat(scope): …`, `fix(scope): …`,
  `test(scope): …`, `docs(scope): …`
- Co-Authored-By trailer for Claude-authored commits:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Pre-commit hook: `pnpm typecheck && pnpm test`. Don't bypass.
- New files: top-of-file comment explains intent + spec reference + milestone
- React components: PascalCase, one component per file (utility helpers can
  share a file when small)
- No Tailwind any more — raw CSS in `src/index.css` with design tokens
  (`var(--brand)`, `var(--bg-1)`, etc.); component-local styles inline
- No emojis in code unless the user asks; emojis in commit messages and UI
  copy are fine

---

## 14. Where the design language is encoded

`apps/desktop/src/index.css` is the canonical source of design tokens +
component CSS classes (`.sidebar`, `.chat-stream`, `.tool-card`, etc.).
`docs/VISUAL_DESIGN.html` is the design spec (~2000 lines of HTML mockups + CSS
that we mirror in real React + CSS). When the design CSS in `index.css`
deviates from the spec, the spec wins.

The 9 screen sections in the spec are numbered. Cross-references:
- Screen #1: Hero / homepage (deferred — we don't have a marketing page yet)
- Screen #2: First-launch / Onboarding → `src/screens/Onboarding.tsx`
- Screen #3: Main desktop view (3-col shell) → `src/App.tsx` shell + `Sidebar`
  + `Repl` + `InspectorRail`
- Screen #4: Composer detail → toolbar inside `Repl.tsx`
- Screen #5: File panel — DEFERRED. The redesign dropped the right-side
  Source/Diff/History panel; it'd re-emerge if/when the inspector ‹ expand
  panel lands.
- Screen #6: Skills + slash menu → `src/screens/Skills.tsx` (no slash palette
  yet)
- Screen #7: Plan mode → mode dropdown + permission rules
- Screen #8: Plugins → `src/screens/Plugins.tsx`
- Screen #9: Settings → `src/screens/Settings.tsx`

---

That's the lot. Happy hacking. — overnight Claude
