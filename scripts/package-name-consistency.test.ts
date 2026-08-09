// The name we tell people to install must be the name we publish.
//
// The CLI has been renamed twice, and both times some of the install strings
// moved while others stayed. A rename that touches `package.json` but not the
// `/upgrade` hint ships a working package alongside instructions for a package
// that belongs to somebody else — which is worse than either name alone.
//
// So: every `npm i -g <pkg>` in a current document or in CLI source must name
// the package `apps/cli/package.json` publishes.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

const publishedName = (): string => JSON.parse(read('apps/cli/package.json')).name as string;

// Everything is scanned unless it is listed here, rather than nothing being
// scanned unless it is listed there.
//
// An allowlist has to be extended by whoever adds the next document, and the
// failure when they forget is silent — which is the same shape as the bug this
// file exists to catch. It is also not hypothetical: the rename this test
// shipped with had to hand-edit install strings in
// `packages/core/src/config/claude-compat.test.ts` and
// `apps/cli/src/parity-commands.test.ts`, neither of which an allowlist built
// from the documents anybody thought of would have contained.
//
// Historical snapshots deliberately keep the names that were true when they
// were written; `scripts/check-docs.mjs` is what keeps them marked as such, and
// this is the same list. CHANGELOG entries for shipped releases are history too.
const historical = new Set([
  'CHANGELOG.md',
  'MORNING_REPORT.md',
  'docs/HANDOFF.md',
  'docs/BEHAVIOR_PARITY.md',
  'docs/DEVELOPMENT_PLAN.md',
  // A dated delivery report for one release. Its §7.1 records the rename that
  // was decided at the time, and that record should keep saying what was
  // decided — with a note pointing at the correction, which is what it has.
  'docs/V0.3.0_REPORT.md',
]);
const skipDirs = new Set(['node_modules', 'dist', 'target', 'out', '.git', 'release-artifacts']);
const scannedExtensions = ['.md', '.ts', '.tsx', '.mjs', '.sh'];

function scannedFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const path = join(dir, entry);
    // lstat, not stat: a symlink into a skipped tree must not be followed back
    // in, and a broken one must not throw.
    const stats = lstatSync(path, { throwIfNoEntry: false });
    if (!stats) continue;
    if (stats.isDirectory()) scannedFiles(path, found);
    else if (scannedExtensions.some((ext) => entry.endsWith(ext))) {
      const rel = relative(root, path);
      if (!historical.has(rel)) found.push(rel);
    }
  }
  return found;
}

const installCommand = /npm (?:i|install) -g\s+(@?[\w./-]+?)(?:@latest)?(?=[\s`'"\\]|$)/g;

describe('published package name', () => {
  it('is what every install instruction names', () => {
    const expected = publishedName();
    const wrong: string[] = [];

    for (const path of scannedFiles(root)) {
      for (const match of read(path).matchAll(installCommand)) {
        if (match[1] !== expected) wrong.push(`${path}: ${match[0]}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('scans the files that actually carry install strings', () => {
    // Guards the walker itself: a skip rule that quietly swallowed `docs/` or
    // `apps/` would leave the check above passing over nothing at all.
    const scanned = scannedFiles(root);
    expect(scanned).toContain('README.md');
    expect(scanned).toContain('docs/quickstart.md');
    expect(scanned).toContain('apps/cli/src/cli.ts');
    expect(scanned).toContain('packages/core/src/config/claude-compat.test.ts');
    expect(scanned).not.toContain('docs/DEVELOPMENT_PLAN.md');
  });

  it('is not one of the names that belong to somebody else', () => {
    // Checked against the registry, not against availability of the leaf name:
    // `@deepcode/cli` is unpublished, which is exactly why it looked free — but
    // the `@deepcode` scope holds `@deepcode/tsc` and `@deepcode/dcignore`, and
    // npm rejects a publish into a scope you do not own. `deepcode-cli` is an
    // unrelated Doubao-based CLI. Both would 403 at `pnpm publish`.
    expect(['deepcode-cli', '@deepcode/cli']).not.toContain(publishedName());
  });

  it('is reached by a binary still called deepcode', () => {
    const pkg = JSON.parse(read('apps/cli/package.json')) as { bin: Record<string, string> };
    expect(Object.keys(pkg.bin)).toEqual(['deepcode']);
  });
});
