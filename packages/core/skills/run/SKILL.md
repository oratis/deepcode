---
name: run
description: Launch this project's app to see a change in action.
---

# run

Drive the project's own dev/test/build scripts. Detect toolchain from manifest.

## When to invoke

- User says "run", "start dev server", "build", "run the tests".
- After making a code change, when the next step is to verify by execution.

## Toolchain detection

| Manifest         | Typical commands                                       |
| ---------------- | ------------------------------------------------------ |
| `package.json`   | `pnpm dev` / `pnpm test` / `pnpm build` (or npm/yarn)  |
| `pyproject.toml` | `pytest`, `uv run pytest`, `python -m <pkg>`           |
| `Cargo.toml`     | `cargo test`, `cargo run`, `cargo build --release`     |
| `go.mod`         | `go test ./...`, `go run ./cmd/<name>`                 |
| `Gemfile`        | `bundle exec rspec`, `bundle exec rails s`             |
| `Makefile`       | Prefer `make test` / `make dev` — usually canonical    |

Read `packageManager` in package.json (or `.tool-versions`) for the pinned
package manager — don't guess.

## Output to report

- Exit code
- The exact command run (so the user can re-execute)
- Summary parsed from the runner: `42 passed, 3 failed, 1 skipped`.
- File path of the first failure so the user can jump to it.
