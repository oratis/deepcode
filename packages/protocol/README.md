# @deepcode/protocol

Experimental, transport-neutral lifecycle contracts for DeepCode runtimes and clients.

The package deliberately has no Node.js, Tauri, React, or model-provider dependency. Durable
events describe thread, turn, and completed-item state. Streaming text, structured tool/usage
activity, and interactive approval/user-input requests are transient and excluded from
record/replay snapshots; their final outcomes are persisted as completed items.

This is an internal experimental boundary. Consumers must negotiate `protocolVersion` through
`initialize` instead of assuming backwards compatibility.
