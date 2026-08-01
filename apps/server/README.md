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

Each turn leases a host composition for its workspace. The backend loads user/project
`DEEPCODE.md`, `AGENTS.md`, rules, memory, skills, output style, hooks, and settings defaults before
calling `RuntimeHost`; clients remain unaware of those files. The lease has an explicit async close
hook. Trusted plugin contributions and MCP servers are composed in that lease: eager/deferred tools
share the host registry, MCP resource references are expanded before the model call, startup/resource
failures become value-free turn diagnostics, and every subprocess/connection closes in `finally`.

Trusted-directory project/local command hooks still require exact-definition review. The shared
hook trust store disables pending or changed definitions and exposes value-free warnings through
`config/diagnostics`; use `deepcode hooks list` and `deepcode hooks trust <hash>` to review them.

The host generates one `traceId` per turn and attaches it to durable and transient protocol events.
Bounded NDJSON logs live under `logs/app-server.ndjson`; their schema only permits correlation ids,
event names, status codes, and durations. It never serializes protocol payloads, prompts, commands,
tool arguments/results, or error messages. `diagnostics/export` (also available as
`deepcode diagnostics export`) writes a mode-0600 support bundle under `diagnostics/`. The export
hashes workspace/config paths, omits issue messages and configuration values, re-sanitizes every log
record, and can be removed without affecting threads. Removing `logs/` and `diagnostics/` is the
rollback for this optional observability layer.

`workspace/diff` is bound to a canonical `threadId`, so clients cannot substitute an unrelated cwd.
The server invokes Git without a shell and returns a bounded file/hunk/line DTO for tracked and
untracked changes. Untracked symlinks and binary contents are never read into the response. Desktop,
VS Code, and LSP consume this same capability; clients do not parse Git output independently.

The read-only `SubmitReviewFinding` tool turns model findings into durable `review_finding` items
with a workspace-relative path, tight line range, priority, and optional exact replacement.
`review/apply` accepts one bounded list of finding ids, resolves the original payloads from the
canonical thread, builds the verification-first prompt in the host, and records a `review_action`
item tied to the new turn. It is not a filesystem endpoint: every edit still uses the existing
Edit/Write permission, approval, hook, sandbox, and snapshot path.
