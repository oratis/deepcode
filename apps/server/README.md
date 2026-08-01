# @deepcode/app-server

Experimental line-delimited JSON runtime server for DeepCode clients.

The server owns lifecycle state and delegates model work to `RuntimeHost`. Completed items and
terminal turn state are persisted; streaming deltas are notifications only. The initial transport
is single-client stdio, matching the desktop packaging decision in
`docs/adr/0001-desktop-runtime-sidecar.md`.

After a workspace build, run `node apps/server/dist/cli.js` and send one JSON request per line:

```json
{ "id": 1, "method": "initialize", "params": {} }
```

The transport is experimental. Clients must negotiate `protocolVersion` before using it.
