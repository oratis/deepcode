# Releasing DeepCode

Tag-driven CI pipeline. Push a `v0.X.Y` tag → GitHub Actions takes over:
validate → package VSIX + build/sign/notarize Tauri DMG → publish CLI to npm → create GitHub Release
with the VSIX and DMG attached. npm publication waits for both installable artifacts so an artifact
build failure cannot create an avoidable partial release.

## One-time setup

### 1. GitHub Actions secrets

Set these in repo settings → Secrets and variables → Actions → New
repository secret. All six are required for the _complete_ release graph.

**A release without them still works, partially.** `validate` detects which
credential sets are present and skips the legs it cannot run:

| Missing       | Effect                                                           |
| ------------- | ---------------------------------------------------------------- |
| Apple secrets | `build-mac` is **skipped**; no DMG, and the release notes say so |
| `NPM_TOKEN`   | `publish-cli` is **skipped**; nothing is published to npm        |
| Neither       | GitHub Release still ships with the VSIX and source              |

Skipped, not failed — a red release for a missing credential teaches people to
ignore red releases. A job that actually _fails_ still blocks the release.

| Secret                        | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `APPLE_ID`                    | Your Apple Developer Apple ID (e.g. `you@example.com`)            |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com (used by notarytool) |
| `APPLE_TEAM_ID`               | 10-character team ID (from developer.apple.com → membership)      |
| `CSC_LINK`                    | Base64-encoded `.p12` of the Developer ID Application cert        |
| `CSC_KEY_PASSWORD`            | Password used when exporting the `.p12`                           |
| `NPM_TOKEN`                   | npm access token with `publish` scope for the `@deepcode` scope   |

### 2. Export the Developer ID certificate

```bash
# In Keychain Access on the developer machine:
# select your "Developer ID Application: <Name> (TEAM_ID)" cert + key
# → Export → save as cert.p12 with a strong password.

base64 -i cert.p12 -o cert.p12.b64
# Paste the contents of cert.p12.b64 as the CSC_LINK secret value.
```

The CI workflow imports this into a temporary keychain at build time,
signs the `.app`, then notarizes via Apple's notarytool (the
`DEEPCODE_NOTARY` keychain profile is created on the fly from the
Apple secrets).

### 3. App-specific password

[appleid.apple.com](https://appleid.apple.com) → Sign-in security →
App-specific passwords → Generate. Save the 16-char password as
`APPLE_APP_SPECIFIC_PASSWORD`.

### 4. NPM token

[npmjs.com](https://www.npmjs.com) → account → Access Tokens → Generate
new token → **Automation** (CI-friendly) → save as `NPM_TOKEN`.

The CLI publishes as **`@deepcode/cli`**. The unscoped `deepcode-cli` on npm
belongs to an unrelated project, so the `@deepcode` org must exist and the token
must be able to publish into it. The workflow already passes `--access public`,
which scoped packages need in order not to default to private.

## Releasing

```bash
# 1. Make sure main is green and CHANGELOG.md has an entry for the new version.
# 2. Bump versions everywhere in lockstep — all SIX places:
#    - packages/core/src/index.ts        (VERSION — what `deepcode --version` prints)
#    - apps/cli/package.json             (what npm publishes)
#    - apps/desktop/package.json
#    - apps/desktop/src-tauri/tauri.conf.json
#    - apps/desktop/src-tauri/Cargo.toml
#    - apps/desktop/src-tauri/Cargo.lock (CI runs `cargo check --locked`)
#    (The CI workflow also re-syncs some of these from the tag.)
#    `pnpm test` fails if any of them disagree — see scripts/version-consistency.test.ts.
# 3. Tag + push:

git tag v0.1.3
git push origin v0.1.3
```

The `release.yml` workflow fires on any `v*` tag push. Its validation and publication graph is:

1. **validate** — installs the same sandbox tooling `ci.yml` does (bubblewrap + slirp4netns; the
   deny-all-net fallback test spawns `bwrap`), then typecheck, lint, format, tests, docs,
   `pnpm release:check`, and the Playwright
   desktop protocol journey. The release gate starts the real bundled app-server twice and verifies
   protocol capabilities, thread persistence, thin-client boundaries, bundle budgets, and timing.
2. **publish-cli** — bumps `apps/cli/package.json` to the tag version,
   `pnpm publish` to npm registry. Beta / nightly tags get
   `--tag <channel>` so `latest` stays on stable.
3. **build-vscode** — synchronizes the extension version, rebuilds the app-server bundle, and
   packages `deepcode-<version>.vsix`. Marketplace publication remains a separate, credentialed
   operation; the installable VSIX is attached to GitHub Releases.
4. **build-mac** — macOS-14 runner, Rust + Tauri build, calls
   `scripts/sign-and-notarize.sh` end-to-end. Outputs
   `DeepCode-<version>-arm64.dmg`.
5. **github-release** — generates release notes via
   `scripts/gen-release-notes.ts` (groups PRs by label), creates
   the GitHub Release, and attaches the DMG and VSIX.

## Release channels

Tag format determines the channel + publish target:

| Tag format                | Channel   | npm tag   | GitHub release |
| ------------------------- | --------- | --------- | -------------- |
| `v0.2.1`                  | `stable`  | `latest`  | not prerelease |
| `v0.3.0-beta.1`           | `beta`    | `beta`    | prerelease     |
| `v0.3.0-nightly.20260605` | `nightly` | `nightly` | prerelease     |
| `v0.2.2+security.1`       | `stable`  | `latest`  | mandatory flag |

The `+security.X` suffix sets `is_mandatory=true` in the release output
so the Tauri updater can show a red "must update" banner.

## Auto-update feed (NOT yet wired — do this before relying on in-app updates)

`tauri.conf.json` already has `plugins.updater.active: true` with a committed
**public** key and an endpoint at the release's `latest.json`. Three pieces are
still missing, so **in-app auto-update will not work until they're done** (users
must download the DMG manually):

1. **Tauri updater signing key.** `tauri.conf.json#plugins.updater.pubkey` is the
   public half. The matching **private key** must exist and be added as a GitHub
   secret. If you have it, store it; if not, regenerate the pair (this changes the
   pubkey, so the first build after is a clean break for existing installs):

   ```bash
   pnpm --filter @deepcode/desktop exec tauri signer generate -w deepcode-updater.key
   # → paste the PUBLIC key into tauri.conf.json#plugins.updater.pubkey
   # → add the PRIVATE key file contents as the secret below (never commit it)
   ```

   Add two secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

2. **Enable updater artifacts.** Set `bundle.createUpdaterArtifacts: true` in
   `tauri.conf.json`. ⚠️ Only flip this together with step 1 — `tauri build` will
   **fail** if `createUpdaterArtifacts` is true but no signing key is present in
   the env. (This is why it's left off today: the plain DMG build works without a
   key.)

3. **Generate + upload `latest.json`.** Add a step to `.github/workflows/release.yml`
   (build-mac job) that, after signing, writes `latest.json` matching Tauri v2's
   schema and uploads it to the release:
   ```json
   {
     "version": "<tag>",
     "notes": "...",
     "pub_date": "<ISO>",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<contents of DeepCode_<v>_aarch64.dmg.sig>",
         "url": "https://github.com/oratis/deepcode/releases/download/v<v>/DeepCode_<v>_aarch64.dmg"
       }
     }
   }
   ```
   The `.sig` is produced by the signed build (step 2). The build env must export
   `TAURI_SIGNING_PRIVATE_KEY` + `..._PASSWORD` so the artifact is signed.

Until all three land, ship the DMG (notarized, works today) and tell users to
download manually; the "Relaunch to update" flow lights up once the feed exists.

## After a release

- Verify: `npm view @deepcode/cli@<version>` shows the new version
- Verify: `https://github.com/oratis/deepcode/releases/tag/v<version>`
  has the DMG and version-matched VSIX attached
- Optional: announce in the README / homepage

## Local rehearsal

Before pushing the tag for a real release, the same flow runs locally:

```bash
# Bump versions everywhere first, then:
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm docs:check
pnpm release:check
pnpm --filter @deepcode/desktop test:e2e
bash scripts/sign-and-notarize.sh
```

The DMG lands at
`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/DeepCode_<version>_aarch64.dmg`.
This is the same artifact CI would attach.

The exact automated contract, budgets, additive storage rules, and isolated-home rollback drill are
documented in [`design/release-gates-v1.md`](design/release-gates-v1.md).

## Rollback

GitHub Releases are independent — delete a release (or mark prerelease)
via the GitHub UI to hide it from users.

`npm unpublish` is more restricted: only the most recent version, and
only within 72h of publish. If a CLI version needs urgent rollback past
that window, publish a patched higher version instead and let users
upgrade.

For app-server data rollback, keep `~/.deepcode/sessions` intact. Rich `threads-v1` snapshots are an
additive projection and legacy sessions are never rewritten by import. Rehearse rollback only on a
copy or an isolated `DEEPCODE_HOME`; do not delete user session data to downgrade an application.

## Post-build DMG smoke test

Before promoting a release candidate:

1. install the notarized DMG on a clean macOS account or isolated test machine;
2. confirm About reports the tag version and the app launches without a system Node installation;
3. create a thread, stream a response, approve one safe tool, and interrupt a second turn;
4. relaunch, resume the first thread, and open Files Source/Diff/History;
5. confirm configuration diagnostics contain no secret values and export a redacted bundle;
6. verify the previous app-server-capable build can read a copy of the candidate session home.
