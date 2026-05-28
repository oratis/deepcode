# DeepCode v0.1.0 — Signing & Notarization Log

This file records the signing flow that produced the signed/notarized
artifacts in this directory.

## Credentials

| Field | Value |
| --- | --- |
| Apple ID | `wangharp@gmail.com` |
| Team ID | `9LH9NBX7P4` |
| Team | Bihao Wang |
| Signing identity | `Developer ID Application: Bihao Wang (9LH9NBX7P4)` |
| Signing cert SHA-1 | `7DC903001F863681EDBB2B4B18755D15D2F19D3B` |
| Notarytool keychain profile | `DEEPCODE_NOTARY` |

The app-specific password was stored in macOS keychain via:

```
xcrun notarytool store-credentials "DEEPCODE_NOTARY" \
  --apple-id "wangharp@gmail.com" \
  --team-id "9LH9NBX7P4" \
  --password "<redacted>"
```

The raw app-specific password is **not stored** in this repo — only the
keychain profile reference (`DEEPCODE_NOTARY`) is.

## Flow

`scripts/sign-and-notarize.sh` does, in order:

1. `pnpm --filter @deepcode/desktop tauri build --target aarch64-apple-darwin`
2. Auto-detect Developer ID Application identity in keychain
3. `codesign --force --deep --options runtime --entitlements
   apps/desktop/src-tauri/Entitlements.plist --sign <id> --timestamp <.app>`
4. `codesign --verify --deep --strict <.app>` (sanity)
5. `ditto -c -k --keepParent <.app> /tmp/.../DeepCode.zip`
6. `xcrun notarytool submit <zip> --keychain-profile DEEPCODE_NOTARY --wait`
7. `xcrun stapler staple <.app>`
8. `codesign --force --sign <id> --timestamp <.dmg>`
9. `xcrun notarytool submit <dmg> --keychain-profile DEEPCODE_NOTARY --wait`
10. `xcrun stapler staple <.dmg>`
11. `spctl --assess --type open --context context:primary-signature <.dmg>` (sanity)

## Verifying the artifact

After installation, verify the .app's signature + notarization status:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/DeepCode.app
spctl --assess --type exec --verbose /Applications/DeepCode.app
# Expected: "accepted, source=Notarized Developer ID"

xcrun stapler validate /Applications/DeepCode.app
# Expected: "The validate action worked!"
```

## Re-signing

To re-sign a fresh build (e.g. after a code change):

```bash
. "$HOME/.cargo/env"
bash scripts/sign-and-notarize.sh
```

Total wall-clock: ~3 min Rust build + ~30 s codesign + ~2-5 min Apple
notarytool wait (peak hours can spike to 30 min).
