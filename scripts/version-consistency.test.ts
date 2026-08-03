// The version a user sees must be the version we shipped.
//
// `deepcode --version` prints `VERSION` from packages/core, npm publishes
// apps/cli/package.json's version, and the Mac client ships tauri.conf.json's.
// These drifted apart before: core said 0.1.0 while the CLI shipped 0.1.6 and
// the changelog announced 0.2.0. Nothing failed, because nothing compared them.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const pkgVersion = (path: string): string => JSON.parse(read(path)).version as string;

const coreVersion = (): string => {
  const match = /export const VERSION = '([^']+)'/.exec(read('packages/core/src/index.ts'));
  if (!match) throw new Error('packages/core/src/index.ts no longer exports a VERSION literal');
  return match[1]!;
};

describe('shipped version numbers', () => {
  it('core VERSION matches the published CLI package version', () => {
    expect(coreVersion()).toBe(pkgVersion('apps/cli/package.json'));
  });

  it('the Mac client agrees with the CLI', () => {
    expect(pkgVersion('apps/desktop/package.json')).toBe(pkgVersion('apps/cli/package.json'));
    expect(pkgVersion('apps/desktop/src-tauri/tauri.conf.json')).toBe(
      pkgVersion('apps/cli/package.json'),
    );
  });

  it('the Rust crate agrees with the Tauri config it builds', () => {
    const match = /^version = "([^"]+)"/m.exec(read('apps/desktop/src-tauri/Cargo.toml'));
    expect(match?.[1]).toBe(pkgVersion('apps/desktop/src-tauri/tauri.conf.json'));
  });

  // CI runs `cargo check --locked`, which refuses to proceed if Cargo.lock
  // disagrees with Cargo.toml — bumping the crate without the lock is a red CI.
  it('Cargo.lock pins the crate version Cargo.toml declares', () => {
    const lock = read('apps/desktop/src-tauri/Cargo.lock');
    const match = /name = "deepcode_desktop"\nversion = "([^"]+)"/.exec(lock);
    const toml = /^version = "([^"]+)"/m.exec(read('apps/desktop/src-tauri/Cargo.toml'));
    expect(match?.[1]).toBe(toml?.[1]);
  });

  it('the newest CHANGELOG entry is the version we are on', () => {
    const match = /^## \[([0-9][^\]]*)\]/m.exec(read('CHANGELOG.md'));
    expect(match?.[1]).toBe(pkgVersion('apps/cli/package.json'));
  });
});
