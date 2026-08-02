# @deepcode/protocol

Experimental, transport-neutral lifecycle contracts for DeepCode runtimes and clients.

The package deliberately has no Node.js, Tauri, React, or model-provider dependency. Durable
events describe thread, turn, and completed-item state. Streaming text, structured tool/usage
activity, and interactive approval/user-input requests are transient and excluded from
record/replay snapshots; their final outcomes are persisted as completed items.

This is an internal experimental boundary. Consumers must negotiate `protocolVersion` through
`initialize` instead of assuming backwards compatibility. The contract also covers configuration
diagnostics and redacted diagnostic export.

New turns carry a host-generated optional `traceId` (optional so pre-tracing snapshots remain
readable). The same id is attached to every event for that turn. Consumers must treat it as an
opaque correlation value, not as authorization or a persistence key.

`diagnostics/export` is capability-negotiated. It returns only the local bundle path, generation
time, and record count; the app-server owns path hashing and payload redaction.

`workspace/diff` is also capability-negotiated and requires a canonical `threadId`. It returns
bounded file, hunk, and line objects rather than a client-specific raw patch.

Actionable review output is persisted as `review_finding` completed items. `review/apply` accepts
only finding ids already present in the canonical thread, resolves their original payloads in the
app-server, and starts one permission-gated turn for a selected finding or bounded batch. The
`review_action` completed item correlates that action with its turn; clients never send a writable
replacement payload or write directly.
