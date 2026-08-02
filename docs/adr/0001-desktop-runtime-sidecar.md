# ADR 0001: Package the desktop runtime as a supervised Node sidecar

- Status: Accepted
- Date: 2026-08-01
- Decision owners: DeepCode runtime maintainers
- Roadmap: `docs/CODEX_ALIGNMENT_PLAN.md`, PR 4

## Context

The Tauri renderer currently imports selected pieces of `@deepcode/core`, creates the
`DeepSeekProvider`, and calls `runAgent` inside the WebView. The renderer receives API credentials
from Rust, cannot load core modules that depend on Node APIs, and disables runtime features such as
hooks and system reminders. Each workaround widens the behavior gap between desktop and the other
clients.

Moving the existing TypeScript runtime behind a process boundary is therefore required. An
installed desktop app cannot assume that Node is present on the user's `PATH`.

Tauri 2 supports target-specific external binaries for precisely this class of dependency; its
[sidecar documentation](https://v2.tauri.app/develop/sidecar/) describes embedding executables so
users do not need to install runtimes such as Node or Python. Node also offers
[single-executable applications](https://nodejs.org/download/release/latest-jod/docs/api/single-executable-applications.html),
but the Node 22 feature is still marked active development, accepts one embedded CommonJS script,
and requires a separate platform-specific injection step.

## Decision

DeepCode will use a **Tauri-supervised, target-specific Node 22 sidecar** as the transitional
desktop runtime boundary.

- The release build pins and checksum-verifies an official Node 22 binary for each supported
  target. It does not copy an arbitrary developer-machine runtime into a release.
- The app server is bundled into one CommonJS file and included as an app resource. Its production
  dependency graph must not resolve modules from a user-controlled working directory.
- Tauri packages the runtime through `bundle.externalBin`. The filename follows Tauri's required
  target suffix convention, such as `deepcode-runtime-aarch64-apple-darwin`.
- Rust owns sidecar startup, shutdown, crash reporting, and stdio. The renderer communicates only
  through the versioned line-delimited JSON protocol.
- The sidecar owns `RuntimeHost`, provider creation, credentials, configuration, hooks, MCP,
  permissions, sandboxing, session persistence, and the agent lifecycle. Credentials never enter
  WebView memory.
- Version 1 uses one child process per desktop app and a single-client stdio connection. A shared
  multi-client daemon requires a later decision covering socket authentication, ownership,
  subscriptions, and backpressure.
- Release signing explicitly signs the nested runtime before the outer `.app`; CI then performs
  deep strict signature verification before notarization.

The bundled runtime is an implementation detail behind the protocol. It may later become a Node
SEA, another compatible JavaScript runtime, or a native implementation without changing clients.

## Spike evidence

`pnpm spike:desktop-sidecar` creates an isolated temporary layout, copies and target-thins the
current runtime, strips it where supported, ad-hoc signs the resulting Mach-O, clears `PATH`, and
performs an `initialize` handshake over stdio. The script fails unless the child reports protocol
version 1 without discovering a system runtime.

On the 2026-08-01 Apple Silicon development host:

| Measurement                    | Result              |
| ------------------------------ | ------------------- |
| Existing unsigned Tauri `.app` | 6,733,824 bytes     |
| Local universal Node runtime   | 237,619,616 bytes   |
| Target-thin arm64 runtime      | 117,655,968 bytes   |
| Thin, stripped runtime         | 108,412,080 bytes   |
| Isolated protocol handshake    | passed with no PATH |
| Cold isolated handshake        | 1.02 seconds        |

These are topology measurements, not release promises. The local runtime is Homebrew's universal
Node 24 build, whereas production will use a pinned target-specific Node 22 distribution. A signed
and notarized artifact cannot be verified locally without release credentials, so that remains a
release-CI gate rather than a claimed spike result.

### Packaged implementation evidence

The first implementation build on the same host adds the production-shaped artifacts:

| Measurement                           | Result                 |
| ------------------------------------- | ---------------------- |
| Bundled CommonJS app-server           | 229,175 bytes          |
| Thin/stripped bundled runtime         | 108,412,096 bytes      |
| Complete sidecar-enabled `.app`       | 115,134,464 bytes      |
| Handshake from packaged paths         | passed with empty PATH |
| Nested-then-outer ad-hoc verification | strict deep pass       |

The release workflow now pins Node 22.23.1 and verifies the official archive SHA256 before the
Tauri build. Local ad-hoc signing proves bundle structure and signing order only; Developer ID,
notarization, stapling, and compressed DMG size remain release gates.

The production renderer now consumes this boundary exclusively: provider/agent/tool execution and
credential plaintext were removed from the WebView bundle, and Rust no longer exposes native
Write/Edit/Bash/Glob/Grep commands to renderer IPC. Protocol resume, interrupt, approvals,
AskUserQuestion, tool events, usage, snapshots, and canonical session projection are wired through
the supervised sidecar.

## Options considered

### Keep the agent loop in the WebView

Rejected. It exposes credentials to renderer JavaScript, forces browser-compatible subsets of
core, duplicates host assembly, and cannot provide a trustworthy long-running backend.

### Node single-executable application

Deferred. SEA does not remove the Node runtime size, and Node 22 adds CommonJS bundling, blob
injection, fuse mutation, and post-injection signing to the release chain while the feature remains
in active development. Reconsider after the app-server bundle is stable and the SEA build is
reproducible on all release targets.

### Bun-compiled sidecar

Deferred. It could simplify single-file creation, but it adds a second JavaScript runtime and new
compatibility risk for Node-heavy core modules. It may be evaluated later against the same protocol
and test corpus.

### Rewrite the runtime in Rust

Rejected for this migration. It preserves a small app but duplicates the provider, tool, hook,
plugin, MCP, session, and policy implementations before their shared semantics are stable.

### Require a system Node installation

Rejected. It makes the desktop artifact non-self-contained and introduces unsupported version and
PATH variation.

## Consequences and gates

The installed app becomes materially larger. That cost is accepted to eliminate the higher-risk
renderer runtime split, but release PRs must report uncompressed `.app` size, compressed DMG size,
and cold handshake time. The first production sidecar is blocked if any of these gates fail:

- a clean environment with an empty `PATH` cannot initialize the server;
- the bundled app resolves server code or dependencies outside its signed resources;
- credentials or provider calls remain in renderer bundles;
- interrupting the desktop turn does not stop the backend operation;
- nested and outer signatures fail `codesign --verify --deep --strict`;
- notarization or stapling fails;
- the final DMG exceeds 100 MB without a separate maintainers' decision.

Rollback is a configuration-level switch to the existing renderer runtime during the experimental
phase. The fallback must be removed once sidecar parity, credential isolation, and signed release
gates pass; it is not a permanent dual architecture.
