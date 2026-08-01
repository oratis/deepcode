# @deepcode/protocol

Experimental, transport-neutral lifecycle contracts for DeepCode runtimes and clients.

The package deliberately has no Node.js, Tauri, React, or model-provider dependency. Durable
events describe thread, turn, and completed-item state; streaming deltas are transient and are
excluded from record/replay snapshots.

This is an internal experimental boundary. Consumers must negotiate `protocolVersion` through
`initialize` instead of assuming backwards compatibility.
