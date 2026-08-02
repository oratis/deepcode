# Experimental runtime protocol v1

Status: experimental  
Owner: runtime architecture  
Implementation: `packages/protocol`

## Purpose

DeepCode clients currently integrate with the agent loop through surface-specific callbacks. The
experimental runtime protocol introduces a transport-neutral boundary that can be shared by the
CLI, desktop, VS Code, LSP, and a future local app server. It is intentionally independent of
Node.js, Tauri, React, and model providers.

Version 1 proves lifecycle semantics and record/replay behavior. It is not yet a promise that
existing clients will migrate without a negotiated version check.

## Lifecycle

A thread contains ordered turns. A thread may have at most one `in_progress` turn. A turn starts
with a completed `user_message` item and reaches exactly one terminal state:

```text
                    +-> completed
in_progress --------+-> interrupted
                    +-> failed
```

Terminal transitions are idempotent. Once a turn is terminal, later terminal requests return the
stored terminal snapshot and no second terminal event is emitted. Completed items cannot be added
to a terminal turn.

## Durable and transient events

Durable events describe state that can be reconstructed after a process restart:

- `thread.started`
- `turn.started`
- `item.completed`
- `turn.completed`
- `turn.interrupted`
- `turn.failed`

`item.delta` is transient. A delta is suitable for live UI streaming, but it is neither saved by
the thread store nor included in protocol recordings. A client that reconnects reads the latest
completed-item snapshot instead of replaying partial text.

State is saved before its corresponding durable event is emitted. A consumer may therefore read
the referenced thread immediately after receiving an event.

## Initialization and compatibility

Clients call `initialize` before other methods and inspect both `protocolVersion` and advertised
capabilities. Version 1 advertises thread resume, turn interruption, completed-item persistence,
and transient deltas.

Unknown methods and non-object request parameters are rejected by the line-oriented JSON codec.
Future incompatible lifecycle changes require a new protocol version; optional behavior should be
introduced through capabilities.

## Current scope

The in-memory store and codec are reference implementations used by contract tests. Production
transport, authorization, persistent storage, backpressure, and wiring to `RuntimeHost` belong to
the app-server phase of the alignment roadmap.
