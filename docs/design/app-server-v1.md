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

| Method               | Required parameters             | Result                                             |
| -------------------- | ------------------------------- | -------------------------------------------------- |
| `initialize`         | none                            | version and capabilities                           |
| `thread/start`       | `cwd`                           | new thread snapshot                                |
| `thread/read`        | `threadId`                      | thread snapshot or null                            |
| `thread/resume`      | `threadId`                      | resumable snapshot                                 |
| `turn/start`         | `threadId`, object `input`      | in-progress turn snapshot                          |
| `turn/interrupt`     | `threadId`, `turnId`            | whether interruption won the state race            |
| `approval/respond`   | thread, turn, request, decision | whether the pending request accepted the response  |
| `user-input/respond` | thread, turn, request, answer   | whether the pending request accepted the response  |
| `config/diagnostics` | workspace cwd                   | value-free layers, provenance, trust gates, issues |
| `diagnostics/export` | workspace cwd                   | redacted local diagnostic bundle metadata          |
| `workspace/diff`     | `threadId`                      | bounded structured workspace diff                  |
| `review/apply`       | `threadId`, `findingIds`        | permission-gated review action turn                |

`turn/start` returns before model work finishes. The server emits transient deltas while the turn
runs, then persists new provider-history messages as completed items before emitting exactly one
terminal turn event.

If a process crashes after persisting an in-progress turn, the next `thread/resume` marks that
orphaned turn interrupted. Version 1 does not attempt to resurrect an unknown provider request or
tool process after a crash.

`review/apply` resolves every id from durable `review_finding` items already stored in the target
thread, then generates the bounded verification prompt inside the app-server. Its `review_action`
item records the selected ids and action turn. Direct `turn/start` requests cannot inject this
reserved metadata.

## Storage and security

The Node-specific `CanonicalThreadStore` writes one mode-0600 lifecycle snapshot per thread under
`~/.deepcode/threads-v1` through a same-directory temporary file and atomic rename. It also
materializes the message history under the same id in canonical `~/.deepcode/sessions/*.v1.jsonl`,
using the shared cross-process writer lock. Existing CLI/desktop session lists therefore see new
protocol threads immediately. If only a canonical or legacy session exists, the store lazily
imports its messages into a completed compatibility turn without modifying the legacy file.

`RuntimeHostExecutor` reconstructs exact stored provider messages from completed protocol items.
The default server runtime resolves credentials only in the trusted backend and uses the central
`RuntimeHost`. Tool starts/results and usage are structured transient events. Approval and
AskUserQuestion prompts are emitted with opaque request ids; responses must match the active
thread, turn, request id, and request kind. Interrupt and shutdown resolve pending prompts before
waiting for the executor, so an abandoned UI cannot strand the server.

The desktop sidecar loads credentials from its private data directory in file-only mode because
Tauri onboarding writes that file and never returns its secret fields to the webview. Every host
uses the core directory-trust store: untrusted project/local layers cannot replace permissions,
auto mode, sandbox, environment, hooks, MCP, helpers, or status-line configuration. The canonical
SessionManager remains attached for pre/post file snapshots, with message appends disabled because
`CanonicalThreadStore` is the single message materializer.

Configuration diagnostics expose only JSON-pointer key paths and source filenames. Values are
never serialized, so provider credentials, hook headers, MCP environment values, and helpers stay
inside the app-server. The report distinguishes discovered layers from effective trust gating and
includes shallow schema issues.

The default executor composes `DEEPCODE.md`, `AGENTS.md`, project rules, persistent memory,
user/project skills, output styles, hooks, and model/effort/mode defaults inside the backend for
every workspace turn. `RuntimeHostExecutor` accepts a turn-scoped lease containing the host and
composed prompt, and releases it in `finally`. Trusted plugin contributions and MCP servers now live
inside that boundary: tools share the registry, deferred MCP tools sit behind `ToolSearch`, resource
references expand before provider input, and connection/plugin failures are persisted as value-free
diagnostics without aborting healthy peers. Plugin capability RPC goes through mode, permission,
hook, approval, and sandbox gates. Explicit client model/effort/mode values still override trusted
settings.

Directory trust does not directly authorize project/local command hooks. Their canonical event,
matcher, and handler definition is SHA-256 pinned in the shared hook trust store; pending or changed
definitions are removed before `HookDispatcher` construction and reported value-free through
configuration diagnostics. User-global and explicit override hooks remain trusted layers.

## Entrypoints

After `pnpm build`, either command starts the same handler:

```bash
node apps/server/dist/cli.js
node apps/cli/dist/cli.js app-server
```

The second form is exposed as `deepcode app-server` in packaged CLI builds. Existing REPL and
headless output contracts remain unchanged during this experimental phase.

`@deepcode/protocol` also exports the transport-neutral `ProtocolClient`. It owns initialization,
request correlation, timeouts, disconnect rejection, reconnection, and event fan-out; each host
supplies only an ordered message connection. The desktop implementation is now a thin Tauri
adapter, and editor clients use the same client state machine instead of duplicating RPC logic.
Node hosts use `SpawnedAppServerConnection`, which resolves the packaged app-server entrypoint,
honors stdio backpressure, bounds stderr diagnostics, treats exit as a protocol disconnect, and
closes stdin first so the server can interrupt and persist active turns before a timed SIGTERM.

## Deferred from this slice

- thread listing, archive, fork, and search;
- multi-client subscriptions or active-turn attachment;
