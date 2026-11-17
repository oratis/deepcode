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
| `NPM_TOKEN`                   | npm access token able to publish into the `@oratis` scope         |

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
new **granular access token** with publish permission for `@oratis/deepcode` → save as `NPM_TOKEN`.
Use a limited scope and expiration; see [npm token documentation](https://docs.npmjs.com/creating-and-viewing-access-tokens/).

The CLI publishes as **`@oratis/deepcode`** — the personal scope of the account
that owns the repository, so no organisation has to exist first. The token must
be issued by that account. The workflow already passes `--access public`, which
scoped packages need in order not to default to private.

Two earlier names were dead ends, and both were only discovered by checking the
registry rather than by reading our own `package.json`:

| Name           | Owner                                                            |
| -------------- | ---------------------------------------------------------------- |
| `deepcode-cli` | an unrelated Doubao-based CLI (`guocong-bincai/deepcode-cli`)    |
| `@deepcode/*`  | an unrelated scope holding `@deepcode/tsc`, `@deepcode/dcignore` |

`@deepcode/cli` itself is unpublished, which is what made it look available —
but npm rejects a publish into a scope you do not own regardless of whether the
individual name is free. A scope is not claimable by publishing into it.

## Releasing

```bash
# 1. Make sure main is green and CHANGELOG.md has an entry for the new version.
# 2. Bump versions everywhere in lockstep — all SEVEN places:
#    - packages/core/src/index.ts        (VERSION — what `deepcode --version` prints)
#    - apps/cli/package.json             (what npm publishes)
#    - apps/vscode/package.json          (installable VSIX)
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
   builds and verifies the standalone tarball, then uses `npm publish <tarball>` to publish it. Beta / nightly tags get
   `--tag <channel>` so `latest` stays on stable.
3. **build-vscode** — synchronizes the extension version, rebuilds the app-server bundle, and
   packages `deepcode-<version>.vsix`. Marketplace publication remains a separate, credentialed
   operation; the installable VSIX is attached to GitHub Releases.
4. **build-mac** — macOS-14 runner, Rust + Tauri build, calls
   `scripts/sign-and-notarize.sh` end-to-end. Outputs
   `DeepCode-<version>-arm64.dmg`.
5. **github-release** — builds the release body via
   `scripts/gen-release-notes.ts`, creates the GitHub Release, and attaches the
   DMG and VSIX.

   **The body is CHANGELOG.md's entry for the tagged version.** Repo-relative
   links are rewritten to absolute URLs pinned at the tag — a release body does
   not render inside the repository, so a relative link resolves against nothing,
   and pinning at the tag keeps it pointing at this release's version of the file
   after that file moves.

   With no matching entry it falls back to the commit range and says so, in the
   body and on stderr. That fallback is a signal that step 1 of the release
   checklist was skipped, not a supported mode.

## Standalone CLI package

Run `pnpm build && pnpm --dir apps/cli package:check`. The gate creates
`apps/cli/dist/npm/oratis-deepcode-<version>.tgz`, installs it outside the workspace
without registry access, and checks builtin skills, schema/profile loading, session
operations, restart durability and optional SDK discovery. CI attaches this tarball
to the GitHub Release even when npm credentials are unavailable.

Publish the verified tarball with `npm publish <tarball> --access public` (add the
appropriate `--tag` for a prerelease). Do not run `pnpm publish` directly inside
`apps/cli`: its source manifest deliberately contains private workspace dependencies.
Users can install the downloaded tarball with `npm install -g --omit=optional ./oratis-deepcode-<version>.tgz`.
Omitting optional dependencies selects the native runtime; installing the optional
Claude SDK does not make its provider features identical to native DeepSeek.

## Local Keychain signing

An existing Developer ID Application identity and notarization Keychain profile
can sign this app without exporting either credential into the checkout or GitHub.
Build from the intended release commit using Node 22, then run:

```bash
DEEPCODE_SIGNING_ID='<certificate SHA-1>' \
DEEPCODE_NOTARY_PROFILE='<existing Keychain profile>' \
bash scripts/sign-and-notarize.sh
```

The script signs Node with `RuntimeEntitlements.plist` (V8 JIT), runs the real
bundled server in an isolated HOME with an empty PATH, signs/notarizes/staples the
app, then creates and separately notarizes the DMG. Signature, ticket and final
Gatekeeper checks fail the release on error. `DEEPCODE_SKIP_BUILD=1` is for an
already built, version-checked candidate. The signing certificate and notary
profile are independent of npm authentication and the Tauri updater key.

Before attaching a local DMG to its existing release, mount it at a unique temporary
path, verify the contained app's signature/ticket/Gatekeeper and run
`node scripts/verify-mac-runtime.mjs /path/to/mounted/DeepCode.app`. Download the
published asset and repeat the checks. Record SHA-256 and Apple submission IDs,
and update release notes to reflect the artifacts that were actually published.
The DMG includes the native runtime; the experimental Claude SDK is not bundled.

For automatic updates, `sign-and-notarize.sh` rebuilds and signs the update archive
**after** the app is stapled, with `COPYFILE_DISABLE=1` to exclude AppleDouble
entries that Tauri cannot unpack. The `Contents/CodeResources` notarization ticket
remains a regular archive entry. Verify the signature against the committed public key
and inspect the extracted app before uploading a feed. Never publish Tauri's earlier
build-time archive after re-signing the app. An unavailable updater private key does
not block manual DMG distribution and must not trigger an undocumented key rotation.

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

## Auto-update feed

The pipeline produces `latest.json` and the signed update bundle **as soon as a
signing key exists**. One thing is left, and only you can do it:

**Generate the updater key pair and add it as a secret.**

```bash
pnpm --filter @deepcode/desktop exec tauri signer generate -w deepcode-updater.key
# → paste the PUBLIC key into tauri.conf.json#plugins.updater.pubkey
# → add the PRIVATE key file contents as TAURI_SIGNING_PRIVATE_KEY (never commit it)
# → add its passphrase as TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

`tauri.conf.json` already carries a committed public key. If the private half is
lost, regenerating changes the public key, and **existing installs will refuse
every update signed by the new one** — they verify against the key they shipped
with. That is a clean break requiring a manual re-download, so treat the private
key as unrecoverable-if-lost, not as something to regenerate casually.

### v0.5.3 updater key migration

The prior updater private key could not be recovered. With explicit owner approval,
v0.5.3 introduces a new dedicated updater key; only its public half is committed.
Existing 0.5.2-or-earlier installs must install the signed v0.5.3 DMG manually once.
No old signature check is disabled and no historical tag is changed. Future updates
must use this same new private key, held in restricted local operator storage.
Back up that private key securely; the Apple Developer ID PEM/CSR cannot substitute
for a Tauri updater key. Rollback to an older app also restores its older public key
and requires another manual upgrade to return to the new update stream.

### What the pipeline does with it

| Step                                                                                 | Where                           |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| Detect `TAURI_SIGNING_PRIVATE_KEY` → `has_updater`                                   | `validate`                      |
| Flip `bundle.createUpdaterArtifacts` to true                                         | `build-mac`, before the build   |
| Export the signing key to `tauri build`                                              | `build-mac`                     |
| Rebuild `*.app.tar.gz` from the signed, stapled app; sign it and write `latest.json` | `build-mac`, after notarization |
| Attach all three to the release                                                      | `github-release`                |

`createUpdaterArtifacts` stays **false in the committed config** on purpose:
`tauri build` fails outright when it is true and no key is in the environment,
so leaving it on would break every credential-less release. CI flips it, and
only when the key is there.

Without the key the DMG still builds and ships — and the release body says the
feed is missing, because an updater that silently polls a 404 forever looks
identical to one that has simply found no update.

The manifest is generated by [`scripts/gen-update-manifest.ts`](../scripts/gen-update-manifest.ts)
rather than inline YAML: its shape is a contract with the updater, and a wrong
field name fails the way a missing file does — quietly, in the user's app, long
after the release was cut. It refuses to emit an empty signature, and it pins
the download URL at the tag rather than `/latest/` so a manifest a client
already fetched keeps resolving to the build its signature was made for.

## After a release

- Verify: `npm view @oratis/deepcode@<version>` shows the new version
- Verify: `https://github.com/oratis/deepcode/releases/tag/v<version>`
  has the DMG and version-matched VSIX attached
- With an updater key configured: `curl -sSL https://github.com/oratis/deepcode/releases/latest/download/latest.json`
  returns the manifest — that URL is exactly what the app polls, so fetching it
  yourself is the whole test
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

For app-server data rollback, keep `~/.deepcode/sessions` and legacy `threads-v1` snapshots intact.
Version 0.5.0 writes new facts to `sessions-v2`; 0.4.x cannot read that journal. Legacy native imports
leave their source payloads unchanged, and legacy SDK/snapshot-only records remain read-only. See the
[session compatibility and rollback guide](HARNESS_RUNTIME_GUIDE.md). Rehearse rollback only on a
copy or an isolated `DEEPCODE_HOME`; do not delete user session data to downgrade an application.

## Post-build DMG smoke test

Before promoting a release candidate:

1. install the notarized DMG on a clean macOS account or isolated test machine;
2. confirm About reports the tag version and the app launches without a system Node installation;
3. create a thread, stream a response, approve one safe tool, and interrupt a second turn;
4. relaunch, resume the first thread, and open Files Source/Diff/History;
5. confirm configuration diagnostics contain no secret values and export a redacted bundle;
6. verify the previous app-server-capable build can read a copy of the candidate session home.
