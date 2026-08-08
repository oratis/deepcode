# Combo — turning a thread into a skill

`/combo` distils the work you just finished into a reusable `SKILL.md` draft.

```
/combo                     # preview the draft
/combo my-name --write     # write it to .deepcode/skills/<name>/SKILL.md
```

## Why after, not before

DeepCode's skill system was already complete — the loader, the frontmatter
schema, three source layers, overrides. What was missing was the _generating_
end: every `SKILL.md` had to be written by hand, up front, before anyone knew
what the work would involve.

That's backwards. The moment you finish a task is the moment you understand it
best. `/combo` extracts the automation _after_ the work rather than asking you to
configure it before.

## `allowed-tools` is derived, not guessed

The draft's `allowed-tools` lists exactly the tools the thread actually called.

This matters more than it looks. Hand-written skills are almost always broader
than they need to be, because guessing generously is easier than auditing — a
skill that only reads files ends up with `Bash` in its list "just in case".
Deriving the set from a real run gives you least privilege for free.

## Nothing is written until you've seen it

`/combo` alone **prints the draft and writes nothing.** A second invocation with
`--write` commits it. A skill assembled from a transcript is a shareable
artifact, so you read it before it exists on disk.

Writing one is recorded on the [governance ledger](change-ledger.md) — creating a
skill changes what future runs may do, which is not an ordinary file edit.

`--write` refuses to overwrite an existing skill. Pick another name.

## What never makes it into the draft

**Credential-shaped values** are replaced with `[REDACTED]`: API keys, GitHub
tokens, AWS key ids, JWTs, PEM private keys, and `password:`/`token:`-style
assignments.

**Paths your [file contract](file-contract.md) denies reading** are dropped
entirely. A rule that stops at the tool call but not at the export isn't much of
a rule — the filename alone leaks.

Either way the draft tells you what was withheld, so you're not guessing:

```
withheld: redacted API key
withheld: path excluded by file contract: .env
```

## The draft is a draft

It carries a `# TODO: review before use` marker and is not auto-enabled. It was
generated from a transcript; read it before you rely on it.

## What this is not

Floatboat's Combo sits on a "Tacit Engine" that passively observes activity
across files, browser tabs, and system apps to build a habit model. **DeepCode
does not do that.** `/combo` reads the current thread, only when you type it,
and never aggregates across threads or runs in the background.

The useful part of the idea — extract the automation after the work — needs no
passive collection at all.
