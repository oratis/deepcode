import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('macOS signing admission', () => {
  it('rejects an older already-built app before signing or notarizing', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepcode-stale-app-'));
    const tauri = join(root, 'apps/desktop/src-tauri');
    const contents = join(
      tauri,
      'target/aarch64-apple-darwin/release/bundle/macos/DeepCode.app/Contents',
    );
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(contents, { recursive: true });
    copyFileSync(
      resolve(import.meta.dirname, 'sign-and-notarize.sh'),
      join(root, 'scripts/sign-and-notarize.sh'),
    );
    writeFileSync(join(tauri, 'tauri.conf.json'), '{"version": "0.5.2"}');
    writeFileSync(
      join(contents, 'Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.5.1</string></dict></plist>',
    );
    try {
      const result = spawnSync('/bin/bash', [join(root, 'scripts/sign-and-notarize.sh')], {
        env: { HOME: root, PATH: '/usr/bin:/bin', DEEPCODE_SKIP_BUILD: '1' },
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('app version 0.5.1 does not match release version 0.5.2');
      expect(result.stdout).not.toContain('Signing identity:');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('archives the stapled app without AppleDouble entries that break updater extraction', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepcode-updater-archive-'));
    const tauri = join(root, 'apps/desktop/src-tauri');
    const app = join(tauri, 'target/aarch64-apple-darwin/release/bundle/macos/DeepCode.app');
    const mockBin = join(root, 'mock-bin');
    const scripts = join(root, 'scripts');
    const env = {
      HOME: root,
      PATH: `${mockBin}:/usr/bin:/bin`,
      DEEPCODE_SKIP_BUILD: '1',
      DEEPCODE_SIGNING_ID: 'archive-test-no-real-identity',
      DEEPCODE_NOTARY_PROFILE: 'archive-test-no-real-profile',
      TAURI_SIGNING_PRIVATE_KEY: 'archive-test-not-a-key',
    };
    const executable = (path: string, body: string) => {
      writeFileSync(path, `#!/bin/bash\nset -euo pipefail\n${body}\n`);
      chmodSync(path, 0o755);
    };
    try {
      mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
      mkdirSync(mockBin);
      mkdirSync(scripts);
      writeFileSync(join(tauri, 'tauri.conf.json'), '{"version": "0.5.2"}');
      writeFileSync(
        join(app, 'Contents/Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.5.2</string></dict></plist>',
      );
      executable(join(app, 'Contents/MacOS/deepcode-runtime'), 'exit 0');
      for (const name of ['codesign', 'spctl', 'node']) executable(join(mockBin, name), 'exit 0');
      // Model stapling as a regular ticket file added after signing. Real
      // credential operations never run; only ditto, tar and PlistBuddy do.
      executable(
        join(mockBin, 'xcrun'),
        `
if [ "$1" = stapler ] && [ "$2" = staple ] && [ -d "$3" ]; then
  printf 'stapled-ticket-fixture\\n' > "$3/Contents/CodeResources"
fi`,
      );
      executable(
        join(mockBin, 'pnpm'),
        `
for argument in "$@"; do artifact="$argument"; done
printf 'updater-signature-fixture\\n' > "$artifact.sig"`,
      );
      executable(join(scripts, 'make-dmg.sh'), 'printf "dmg-fixture\\n" > "$2"');
      copyFileSync(
        resolve(import.meta.dirname, 'sign-and-notarize.sh'),
        join(scripts, 'sign-and-notarize.sh'),
      );
      const attribute = spawnSync(
        '/usr/bin/xattr',
        [
          '-wx',
          'com.apple.FinderInfo',
          '0000000000000000040000000000000000000000000000000000000000000000',
          app,
        ],
        {
          env,
          encoding: 'utf8',
        },
      );
      expect(attribute.status, attribute.stderr).toBe(0);
      const result = spawnSync('/bin/bash', [join(scripts, 'sign-and-notarize.sh')], {
        env,
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      // BSD tar -t hides AppleDouble even with COPYFILE_DISABLE=1. Inspect raw
      // headers so this check catches what Tauri's Rust extractor will see.
      const archiveEnv = { ...env, COPYFILE_DISABLE: '1' };
      const entries = archiveEntries(`${app}.tar.gz`);
      expect(
        entries.filter((entry) => entry.split('/').some((part) => part.startsWith('._'))),
      ).toEqual([]);
      expect(entries).toContain('DeepCode.app/Contents/CodeResources');
      expect(entries.every((entry) => entry.startsWith('DeepCode.app/'))).toBe(true);
      const ticket = spawnSync(
        '/usr/bin/tar',
        ['-xOf', `${app}.tar.gz`, 'DeepCode.app/Contents/CodeResources'],
        {
          env: archiveEnv,
          encoding: 'utf8',
        },
      );
      expect(ticket.status, ticket.stderr).toBe(0);
      expect(ticket.stdout).toBe('stapled-ticket-fixture\n');
      expect(readFileSync(`${app}.tar.gz.sig`, 'utf8')).toBe('updater-signature-fixture\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});

// The fixture has only short paths and tiny files. Skip metadata headers but
// preserve every file/directory header, including Apple's ._ companion files.
function archiveEntries(path: string): string[] {
  const archive = gunzipSync(readFileSync(path));
  const names: string[] = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().split('\0')[0]!;
    if (!name) break;
    const prefix = header.subarray(345, 500).toString().split('\0')[0]!;
    const type = header.subarray(156, 157).toString();
    if (!['x', 'g', 'L', 'K'].includes(type)) names.push(prefix ? `${prefix}/${name}` : name);
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
    expect(Number.isSafeInteger(size)).toBe(true);
    expect(size).toBeGreaterThanOrEqual(0);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}
