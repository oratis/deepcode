# @deepcode/app-server

Experimental line-delimited JSON runtime server for DeepCode clients.

The server owns lifecycle state and delegates model work to `RuntimeHost`. Completed items and
terminal turn state are persisted; streaming and interactive requests are notifications only.
Approval and user-input responses are bound to their active thread and turn. The initial transport
is single-client stdio, matching the desktop packaging decision in
`docs/adr/0001-desktop-runtime-sidecar.md`.

Lifecycle snapshots live under `threads-v1`; their message projection uses the same id in the
canonical session-v1 index. Legacy-only sessions are imported lazily on resume.

After a workspace build, run `node apps/server/dist/cli.js` and send one JSON request per line:

```json
{ "id": 1, "method": "initialize", "params": {} }
```

The transport is experimental. Clients must negotiate `protocolVersion` before using it.

`config/diagnostics` accepts a workspace `cwd` and returns a value-free report containing loaded
layers, leaf provenance, trust-gated fields, and validation issues. Configuration values and
credentials never cross this protocol boundary.
