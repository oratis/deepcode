// The name we tell people to install must be the name we publish.
//
// The CLI has been renamed twice, and both times some of the install strings
// moved while others stayed. A rename that touches `package.json` but not the
// `/upgrade` hint ships a working package alongside instructions for a package
// that belongs to somebody else — which is worse than either name alone.
//
// So: every `npm i -g <pkg>` in a current document or in CLI source must name
// the package `apps/cli/package.json` publishes.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

const publishedName = (): string => JSON.parse(read('apps/cli/package.json')).name as string;

// Historical snapshots (MORNING_REPORT, DEVELOPMENT_PLAN, HANDOFF,
// BEHAVIOR_PARITY, release-artifacts) deliberately keep the names that were
// true when they were written, so they are not scanned. scripts/check-docs.mjs
// is what keeps them marked as historical.
const scanned = [
  'README.md',
  'CONTRIBUTING.md',
  'apps/cli/README.md',
  'docs/quickstart.md',
  'docs/RELEASING.md',
  'docs/MIGRATION_FROM_CLAUDE_CODE.md',
  'docs/cli-flags.md',
  'apps/cli/src/cli.ts',
  'apps/cli/src/commands.ts',
];

const installCommand = /npm (?:i|install) -g\s+(@?[\w./-]+?)(?:@latest)?(?=[\s`'"\\]|$)/g;

describe('published package name', () => {
  it('is what every install instruction names', () => {
    const expected = publishedName();
    const wrong: string[] = [];

    for (const path of scanned) {
      const body = read(path);
      for (const match of body.matchAll(installCommand)) {
        if (match[1] !== expected) wrong.push(`${path}: ${match[0]}`);
      }
    }

    expect(wrong).toEqual([]);
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
