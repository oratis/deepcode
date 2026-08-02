# Experimental app-server vertical slice

Status: experimental  
Transport: line-delimited JSON over stdio  
Implementation: `apps/server`

## Ownership model

Version 1 has one app-server process and one owning client. It is not a daemon and does not allow a
second client to attach to an active turn. The client keeps stdin open for the lifetime of the
server. EOF means the owner disconnected: the server aborts every active executor, persists each
turn as `interrupted`, waits for cancellation to settle, and exits.

This boundary is suitable for the Tauri-supervised sidecar selected in ADR 0001. A future shared
daemon requires a separate authenticated socket and subscription design.

## Framing

Each request and response occupies one UTF-8 JSON line. Events use a notification envelope:

```json
{ "method": "event", "params": { "type": "turn.completed", "threadId": "thread-1", "turn": {} } }
```

Malformed lines receive a `parse_error` response with a null id; the server continues reading the
connection. Request validation and lifecycle invariant errors use string error codes because the
protocol is still experimental.

The writer observes Node stream backpressure. If its bounded queue is saturated, it may drop only
`item.delta` notifications; durable lifecycle and completed-item events are never intentionally
dropped. Reconnecting clients recover completed state through `thread/read` or `thread/resume`, not
by expecting partial deltas to replay.

## Methods

| Method           | Required parameters        | Result                                  |
| ---------------- | -------------------------- | --------------------------------------- |
| `initialize`     | none                       | version and capabilities                |
| `thread/start`   | `cwd`                      | new thread snapshot                     |
| `thread/read`    | `threadId`                 | thread snapshot or null                 |
| `thread/resume`  | `threadId`                 | resumable snapshot                      |
| `turn/start`     | `threadId`, object `input` | in-progress turn snapshot               |
| `turn/interrupt` | `threadId`, `turnId`       | whether interruption won the state race |

`turn/start` returns before model work finishes. The server emits transient deltas while the turn
runs, then persists new provider-history messages as completed items before emitting exactly one
terminal turn event.

If a process crashes after persisting an in-progress turn, the next `thread/resume` marks that
orphaned turn interrupted. Version 1 does not attempt to resurrect an unknown provider request or
tool process after a crash.

## Storage and security

The Node-specific `FileThreadStore` writes one mode-0600 JSON snapshot per thread through a
same-directory temporary file and atomic rename. The app-server CLI stores these under
`~/.deepcode/threads-v1` by default. This is the protocol rollout store; canonical session-v1 files
remain readable compatibility data until the client migration joins their indexes.

`RuntimeHostExecutor` reconstructs exact stored provider messages from completed protocol items.
The default server runtime resolves credentials only in the trusted backend, uses the central
`RuntimeHost`, and denies interactive approvals because version 1 has not yet added an approval
request/response method. Consequently write or shell actions requiring approval fail closed.

## Entrypoints

After `pnpm build`, either command starts the same handler:

```bash
node apps/server/dist/cli.js
node apps/cli/dist/cli.js app-server
```

The second form is exposed as `deepcode app-server` in packaged CLI builds. Existing REPL and
headless output contracts remain unchanged during this experimental phase.

## Deferred from this slice

- approval and ask-user server requests;
- config provenance and per-turn model/effort options;
- thread listing, archive, fork, and search;
- multi-client subscriptions or active-turn attachment;
- joining the new thread snapshot index with legacy/canonical session listings;
- a production-bundled CommonJS app-server artifact and pinned Node 22 runtime.
