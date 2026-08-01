# Shipping the macOS client

DeepCode Desktop uses **Tauri 2 + Rust + React**. The earlier Electron shipping
instructions have been retired because following them would install unrelated
dependencies and bypass the actual release pipeline.

The maintained release checklist is [`RELEASING.md`](RELEASING.md). In short:

1. Verify the full TypeScript and Rust gates.
2. Keep CLI, desktop, Tauri config, and Cargo versions in sync.
3. Build the Tauri app and run `scripts/sign-and-notarize.sh`.
4. Validate the notarized DMG before pushing a release tag.
5. Treat in-app updates as unavailable until the Tauri signing key,
   `createUpdaterArtifacts`, signed updater artifact, and `latest.json` feed are
   all configured as described in `RELEASING.md`.

Do not restore `electron-builder`, `electron-updater`, Electron templates, or a
`latest-mac.yml` feed. They are not part of the current application.

## Local verification

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
pnpm --filter @deepcode/desktop tauri:build
bash scripts/sign-and-notarize.sh
```

Signing and notarization require the Apple credentials documented in
`RELEASING.md`. Never place certificate material, app-specific passwords, or
Tauri updater private keys in the repository or command output.
