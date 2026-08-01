# Release gates v1

Status: enforced  
Owner: repository CI and tag-driven release workflow

## Purpose

DeepCode now has one trusted runtime boundary but several thin clients. A release must prove that
the bundled app-server still starts without development-time module resolution, advertises the
expected protocol, persists canonical threads across restart, and stays within measured packaging
budgets. Unit tests alone cannot establish those properties.

`pnpm release:check` is the local and CI entrypoint. It builds the monorepo, produces the real VS
Code `extension.cjs` and `app-server.cjs` bundles, then runs `scripts/release-gate.mjs` against the
bundle with a temporary `DEEPCODE_HOME`. No provider credential is supplied or read.

## Automated contract

The gate fails unless all of the following hold:

1. The extension bundle is at most 64 KiB, the app-server bundle is at most 768 KiB, and the
   installable VSIX is at most 256 KiB and contains both bundles.
2. A cold app-server returns protocol version 1 within 5 seconds and advertises every required v1
   capability, including diagnostics, structured workspace diff, and review actions.
3. `thread/start`, `thread/read`, configuration diagnostics, and `workspace/diff` work against the
   packaged server. Metadata requests have a 2-second budget; workspace diff has a 10-second budget.
4. After a graceful process shutdown, a new packaged server using the same temporary home can read
   and resume the same canonical thread.
5. Desktop, VS Code, and LSP production sources do not import the provider, credentials, agent loop,
   or `RuntimeHost`, and do not contain renderer credential escape hatches.

The current budgets deliberately leave cross-platform CI headroom over the measured baseline. A
budget increase requires a PR description with before/after measurements and an explanation of the
new user value. Do not raise a limit only to turn a red gate green.

The gate writes `apps/vscode/dist/release-gate-report.json`; CI uploads it on failure. The report
contains sizes, timings, capability results, and source-scan counts, never prompts, credentials, or
workspace file contents.

## Other release evidence

The root gate complements, rather than replaces, these checks:

- typecheck, lint, formatting, unit/integration tests, build, and documentation checks on Ubuntu and
  macOS;
- the Playwright desktop protocol journey, including approval, tool/usage events, session resume,
  and Files Source/Diff/History;
- Cargo check and tests for Tauri supervision and read-only commands;
- the tag workflow build, Developer ID signing, notarization, and artifact verification.

The browser fixture does not prove that a signed WebKit/Tauri bundle launches on every supported
macOS version. Release candidates still require the short post-build DMG smoke test in
[`docs/RELEASING.md`](../RELEASING.md).

## Migration and rollback drill

Canonical storage is additive:

- rich lifecycle snapshots live in `~/.deepcode/threads-v1`;
- canonical message projections live in `~/.deepcode/sessions/*.v1.jsonl`;
- pre-migration session files remain read-only and are imported lazily;
- snapshot `capturedAtMs` is an additive field, while readers continue to accept ISO-only and older
  desktop manifests.

The automated restart journey is the minimum rollback drill for every commit. Before a release
candidate, also verify this sequence with an isolated home:

1. create a thread with the candidate app-server;
2. stop it gracefully and start a fresh process;
3. read and resume the thread;
4. open the same session in the desktop fixture;
5. run the previous app-server-capable release against a copy of the isolated home and confirm that
   canonical message history remains readable.

Never test rollback against the real user home. Never rewrite or delete legacy session files as part
of rollback. To disable the new lifecycle projection while investigating, move a copy of
`threads-v1` out of an isolated test home; retain `sessions` as the recovery source. `logs` and
redacted `diagnostics` are non-authoritative and may be discarded without affecting threads.

Protocol v1 clients fail closed on a version mismatch. If a server change cannot remain compatible,
ship a coordinated client/server version bump rather than silently interpreting a new shape as v1.

## Failure policy

- A capability, persistence, boundary-scan, or protocol failure blocks the release.
- A performance or bundle regression blocks the release until measured and accepted in the design
  document.
- A flaky gate is treated as a gate defect: preserve the failing report, fix determinism, and rerun;
  do not add blind retries to the protocol script.
- Signing/notarization failure blocks DMG publication. npm publication and GitHub release creation
  already depend on the validated release graph; recovery uses a higher patch version rather than
  mutating an artifact users may already have installed.
