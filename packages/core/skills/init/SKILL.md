---
name: init
description: Generate a starter AGENTS.md after exploring the codebase.
---

# init

Bootstrap a new project's `AGENTS.md` (DeepCode's per-project agent
instructions file). The skill is normally triggered by the `/init` slash
command, but you can also invoke it implicitly when the user asks for
project documentation.

## When to invoke

- User runs `/init` in a project without an existing `AGENTS.md`.
- User says "set up AGENTS.md for this project" or similar.
- A fresh clone is opened and the agent notices the missing file (see
  the `agents-md-missing` system reminder).

## What to produce

A markdown file at `<cwd>/AGENTS.md` covering:

1. **Project name + one-line description** — derived from `package.json`,
   `pyproject.toml`, `Cargo.toml`, etc.
2. **Tech stack** — language / framework / package manager.
3. **Install / build / test commands** — exact invocations
   (`pnpm install && pnpm test`, `cargo build`, etc.).
4. **Code-style conventions** — formatter (Prettier / Black / rustfmt),
   line length, import ordering — whatever's discernible.
5. **Entry points** — where `main.ts` / `__main__.py` / `cmd/cli/main.go`
   lives; which package owns the public API.
6. **Do / don't notes** — anything that would bite a new contributor:
   "don't run `prisma migrate dev` against prod", "always update both
   `core` and the SDK clones in lockstep", etc.

Keep it under 80 lines. Concrete > comprehensive.

## How to invoke (multi-phase flow)

The `/init` slash command in DeepCode walks three phases:

1. **Scan** — list top-level entries, read up to 30 lines each of
   `package.json` / `README.md` / `pyproject.toml` / `Cargo.toml` / `go.mod`.
2. **Propose** — single LLM call with the scan as context; output is the
   `AGENTS.md` markdown only (no preface, no fences).
3. **Approve** — show the first 40 lines, prompt `y/n`. On `y`, write to
   `<cwd>/AGENTS.md`.

## Failure modes

- Empty project (no manifest) → write a stub with just sections 1, 2, 6.
- Existing `AGENTS.md` → ask the user before overwriting.
- LLM returns prose around the markdown → strip code fences if any; if
  output is empty, write a `# AGENTS.md\n\n(Empty draft.)` so the file
  still exists for the user to fill.
