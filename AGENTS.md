# DeepCode repository guidance

## North star

DeepCode is a DeepSeek-powered coding agent with CLI, Tauri desktop, VS Code,
and LSP surfaces. The active modernization plan is
[`docs/CODEX_ALIGNMENT_PLAN.md`](docs/CODEX_ALIGNMENT_PLAN.md). It supersedes
the original milestone plan for new architecture decisions.

## Layout

- `packages/core`: provider, agent loop, tools, config, sessions, sandbox,
  hooks, MCP, skills, plugins, tasks, and worktrees.
- `packages/shared-ui`: cross-client types only.
- `apps/cli`: interactive and headless CLI.
- `apps/desktop`: React/Vite renderer plus the Rust/Tauri backend in
  `src-tauri`.
- `apps/lsp` and `apps/vscode`: editor integrations.
- `scripts`: release and repository checks.
- `docs`: current plans plus historical design snapshots.

Do not edit generated `dist/`, `target/`, release artifacts, or lockfiles unless
the task requires it.

## Setup and verification

Use Node 22 and pnpm 9.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm docs:check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Run the smallest relevant package test while iterating, then the full relevant
gate before handing off. Changes to the Rust backend require `cargo fmt --check`
and `cargo test`. Changes to sandbox, permissions, credentials, plugins, hooks,
or process execution require focused adversarial tests.

## Engineering constraints

- Preserve existing user changes and backward-compatible CLI behavior unless a
  migration is explicitly documented.
- All tool execution must pass through one explicit permission policy. Never
  make safety depend on a host remembering to pass an optional argument.
- Do not expose DeepSeek credentials to a renderer or webview. Treat the VS Code
  extension host and its webview as different trust boundaries.
- Cancellation is complete only when providers, child process groups, pending
  approvals, and subsequent writes have stopped.
- Do not force-delete worktree branches or discard unmerged user work.
- Keep legacy session files read-only during migrations; prefer format
  detection and dual-read/single-write adapters.
- Keep provider-specific behavior behind provider capabilities. Do not claim
  exact Codex or Claude parity when DeepSeek constraints differ.
- New public behavior needs tests and user-facing documentation in the same PR.

## Definition of done

A change is done when its behavior is tested at the correct boundary, relevant
quality gates pass, security and migration consequences are documented, and the
diff contains no unrelated generated or user-owned changes. For architecture
work, update the alignment plan or an ADR with the decision and rollback path.
