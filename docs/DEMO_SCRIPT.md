# 5-minute demo script

Recorded shot-by-shot script for the v1 launch video. Times are
cumulative. Run the demo on macOS with `pnpm install` already done and
~/.deepcode/credentials.json populated.

Capture with QuickTime (Cmd-Shift-5 → "Record Entire Screen") at 1080p.
Voiceover added in post via iMovie or Final Cut.

---

## 0:00–0:20 — Hook

**Visual**: Terminal with `deepcode` typed but not run yet.

**VO**: "DeepCode is a Claude-Code-style coding agent powered by
DeepSeek. Same workflow, same UX, your own provider."

Press Enter.

---

## 0:20–1:00 — REPL basics + a simple fix

**Visual**: REPL boots, system reminder shows today's date + cwd.

Type:
```
add a CONTRIBUTING.md outline to this repo
```

Watch the agent call `Read README.md`, then `Write CONTRIBUTING.md`.
Approval prompt appears for Write. Press `y`.

**VO**: "Every tool call goes through mode + permissions + sandbox.
You stay in control."

---

## 1:00–1:40 — Plan mode

Type `/mode plan` → "plan".

Type:
```
refactor the auth module into separate files for login, logout, session
```

The agent thinks aloud, lists steps, calls `ExitPlanMode` with the plan
summary. REPL prints "Exited plan mode (agent will now execute)."

**VO**: "Plan mode keeps the agent read-only until it commits to a
plan you approve."

---

## 1:40–2:20 — Skill in action

Type:
```
review my latest commit
```

The agent invokes the `code-review` skill (see SKILL.md body). Shows
file:line cites for findings.

**VO**: "Skills are reusable agent recipes — built-in or yours. The
agent finds the right one by description match."

---

## 2:20–3:00 — Sub-agent + hooks

Show `~/.deepcode/agents/explorer.md` briefly. Type:
```
explorer: what does this repo do?
```

Sub-agent runs with its own narrower toolset (just Read + Grep + Glob).
Returns a paragraph.

Show `PostToolUse` hook from settings.json doing a lint check on every
edit. Edit a file → hook fires → output appears in REPL.

**VO**: "Sub-agents and hooks are exactly Claude Code's. Same files,
same shape."

---

## 3:00–3:40 — Sandbox + permissions

Type:
```
delete the test database
```

Permission rule `Bash(rm:*)` is `ask`. Permission prompt appears. Show
`/permissions` (CLI) or the Mac client's Permissions screen.

**VO**: "Permissions are 4-pattern glob rules. Sandbox runs Bash under
`sandbox-exec` on macOS or `bwrap` on Linux."

---

## 3:40–4:20 — Mac client

Switch to the Mac client. Show:
- Onboarding screen (briefly, with a placeholder key)
- REPL with the same chat
- Sessions list
- Plugins panel
- Settings panel

**VO**: "Same agent, same model, native Mac UI. Auto-update via GitHub
Releases."

---

## 4:20–4:50 — Plugins + marketplace

Type in the install spec:
```
gh:deepcode-plugins/git-helpers
```

Plugin downloads, hash-pins, spawns under sandbox-exec. New
`/git-status` slash appears.

**VO**: "Plugins run in sandboxed subprocesses with hash-pinned trust.
Marketplace uses ed25519 signatures + a revocation list."

---

## 4:50–5:00 — Outro

**Visual**: GitHub repo page.

**VO**: "DeepCode. Open source. github.com/oratis/deepcode."

---

## Recording checklist

- [ ] Mic input set to a good external mic (not the laptop's).
- [ ] `~/.deepcode/credentials.json` populated with a working key.
- [ ] Demo project: ideally an actual small open-source repo, not the
      DeepCode repo itself (avoids "self-referential" confusion).
- [ ] Terminal: zsh, ~24pt font, light/dark theme matching your slide
      template.
- [ ] Browser: Chrome, hidden tabs, github.com/oratis/deepcode loaded
      for the outro.
- [ ] All cmd-tab apps quit except: Terminal, DeepCode.app, Chrome.
- [ ] Notifications silenced (Do Not Disturb on).
- [ ] Screen resolution: 2560x1440 → exports clean 1080p.

## Post-production

- Trim dead air aggressively. Final cut should be 4:30-5:00.
- Add a `cmd+T` style on-screen text for each section.
- Background music: free Royalty-Free instrumental from epidemicsound
  (acoustic, low-bpm, no vocals).
- Export 1080p H.264 .mp4, upload to YouTube + drop into the GitHub
  README.

## What NOT to include

- Real API keys (always blur or use a fake `sk-...` placeholder).
- The agent making mistakes in front of camera — pre-rehearse and
  re-record sections that derail.
- Long compile / install spinners — trim them out.
