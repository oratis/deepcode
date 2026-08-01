# Session Format v1

Status: experimental, implemented by `@deepcode/core` and the Tauri desktop backend.

## Goals

- one append format across CLI, headless and desktop;
- lossless reads of historical core and desktop sessions;
- no in-place mutation of legacy files;
- explicit cross-process writer ownership;
- recover an interrupted final append, but never hide middle corruption.

## Files

For logical session `<id>` under `~/.deepcode/sessions/`:

- `<id>.v1.jsonl` is the canonical stream;
- `<id>.writer.lock` is held with create-new semantics for each metadata rewrite or append;
- `<id>.jsonl` and `<id>.meta.json` are legacy, read-only inputs;
- `<id>/snapshots/` remains the session artifact directory.

On the first write to a legacy session, DeepCode creates the canonical stream atomically and appends there. The legacy bytes remain unchanged. Explicit user archive/delete operations may move or remove both generations.

## Records

The first record is metadata:

```json
{
  "type": "session_meta",
  "schema_version": 1,
  "id": "…",
  "cwd": "/repo",
  "created_at": "…",
  "updated_at": "…",
  "model": "deepseek-chat"
}
```

Every later record is a completed message envelope:

```json
{ "type": "message", "schema_version": 1, "role": "assistant", "content": [], "timestamp": "…" }
```

Streaming deltas are not persisted. Tool calls and results are stored only after they become completed content blocks in the message history.

## Recovery and ownership

The lock filename and create-new behavior are identical in TypeScript and Rust, so two hosts cannot silently interleave writes. A conflicting writer receives an explicit error. The lock contains diagnostic owner information and is removed when the operation exits.

Readers prefer v1, otherwise detect either legacy layout. An invalid final record without a newline is treated as an interrupted append and ignored. Invalid JSON or an invalid message in the middle is reported with its line number and blocks normalization.

Crash-stale lock recovery is intentionally deferred to the single-owner app-server: clients must not guess that another process is dead and steal ownership.
