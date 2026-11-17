import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
});
