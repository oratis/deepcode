// `@types/vscode` may never be newer than `engines.vscode`.
//
// `engines.vscode` states the OLDEST VS Code the extension supports. The types
// have to match that floor, not the newest release: compiling against 1.125's
// API surface while claiming to run on 1.85 lets an editor-version-gated call
// typecheck cleanly and then throw `undefined is not a function` on the older
// editor nobody tested.
//
// `vsce package` already enforces this and refuses to build:
//
//   ERROR  @types/vscode ^1.125.0 greater than engines.vscode ^1.85.0
//
// but only inside `pnpm release:check`, several minutes into CI and after a
// full workspace build. A dependency bot proposing the newer types (#262) is
// the ordinary way this happens, so catch it in the unit suite where the
// message arrives in seconds — and where it names the reason rather than the
// symptom.
//
// Fixing it is not "take the bump": raising `engines.vscode` drops every VS
// Code between the two versions, which is a support decision to make on
// purpose. Move both together when you make it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'apps/vscode/package.json'), 'utf8')) as {
  engines: { vscode: string };
  devDependencies: Record<string, string>;
};

/** `^1.85.0` → `[1, 85, 0]`. Ranges here are always a caret over an exact version. */
function floor(range: string): number[] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (!match) throw new Error(`cannot read a version out of ${JSON.stringify(range)}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe('the VS Code extension', () => {
  it('does not compile against a newer API than it claims to run on', () => {
    const engine = pkg.engines.vscode;
    const types = pkg.devDependencies['@types/vscode'];
    expect(types, 'apps/vscode must declare @types/vscode').toBeTypeOf('string');

    expect(
      compare(floor(types!), floor(engine)),
      `@types/vscode ${types} is newer than engines.vscode ${engine}. ` +
        `The types must match the oldest supported editor, so either pin them back ` +
        `or raise engines.vscode deliberately — raising it drops support for every ` +
        `VS Code in between.`,
    ).toBeLessThanOrEqual(0);
  });
});
