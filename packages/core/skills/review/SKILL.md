---
name: review
description: Review the current PR (uses gh CLI).
---

# review

Review a GitHub pull request: pull the diff via `gh`, run `code-review`
checklist, post or summarize findings.

## When to invoke

- User says "review PR #N", "look at this PR", "review my PR".
- User is on a feature branch and wants a check before pushing.

## Process

1. **Identify the PR**:
   - Explicit `#N` → `gh pr view N --json title,body,baseRefName,headRefName`.
   - "current branch" → `gh pr view --json ...` (detects from HEAD).
2. **Fetch the diff**:
   - `gh pr diff <N>` (or `git diff <baseRef>...HEAD` if local).
3. **Apply the `code-review` skill** — bug / latent / suggestion findings
   with `file:line` cites.
4. **Apply `security-review` if** the diff touches auth / file paths /
   exec / HTTP / serialization.
5. **Decide on output**:
   - Local feedback → print to user.
   - Post as PR comment → `gh pr comment <N> --body "..."`.
   - Post inline review → `gh api` with a review payload (advanced).

## What NOT to do

- Don't approve or merge — those require user action.
- Don't post findings without showing the user the draft first.
- Don't paraphrase the diff back at the user. Be specific about defects.

## Output shape

```
Reviewing PR #42: "Add /init multi-phase flow"

  Found 3 issues:

  · BUG  apps/cli/src/repl.ts:147  — initFlow promise resolves before file
       write completes; user sees "OK" then file is half-written if Ctrl+C.
  · TEST GAP  apps/cli/src/headless.test.ts — no test for `--json-schema`
       happy path; only error paths covered.
  · STYLE  apps/cli/src/commands.ts:222  — unused `_args`; drop the prefix.

  Verdict: changes-requested. Ready to push these to the PR comments? [y/n]
```
