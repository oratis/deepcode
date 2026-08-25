// Type packages track the OLDEST runtime we support, never the newest release.
//
// `@types/node` and `@types/vscode` are not ordinary dependencies. They decide
// which APIs the compiler will accept, so they have to describe the *floor* of
// what we claim to run on. Point them at the newest release and a call added
// after that floor typechecks cleanly and then throws on the runtime we
// promised to support — and the test suite will not catch it, because CI runs
// the floor and the broken call is in whatever path the tests do not execute.
//
// This is not hypothetical and it is not once: the `typescript` dependency
// group swept `@types/vscode` to ^1.125.0 against `engines.vscode: ^1.85.0`
// (#262), and `@types/node` was proposed at ^26.2.0 against
// `engines.node: >=22` (#279) the same day. `vsce package` happens to catch the
// first, minutes into `release:check`; nothing at all catches the second.
//
// So check both here, in seconds, with a message that names the trade-off.
// Fixing a failure is never "take the bump": raising the floor drops support
// for every version in between, which is a decision to make deliberately and
// then apply to the types and the engine together.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readPkg = (path: string): Record<string, never> =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Record<string, never>;

/** `^1.85.0`, `>=22`, `22.10.0` → the lowest version the range admits. */
function floor(range: string): number[] {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!match) throw new Error(`cannot read a version out of ${JSON.stringify(range)}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * Compare two floors to `precision` components.
 *
 * The unit that carries meaning differs per ecosystem. Node's is the MAJOR:
 * `@types/node@^22.10.0` against `engines.node: '>=22'` is the intended pin, and
 * comparing minors would fail it. VS Code ships everything as `1.x`, so its unit
 * is the MINOR — 1.85 versus 1.125 is the whole question there.
 */
function compare(a: number[], b: number[], precision: number): number {
  for (let i = 0; i < precision; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Every workspace `package.json`, found rather than listed. */
function manifests(dir: string = root, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'target', 'out', '.git'].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) manifests(path, found);
    else if (entry === 'package.json') found.push(relative(root, path));
  }
  return found;
}

const typesOf = (pkg: Record<string, never>, name: string): string | undefined =>
  (pkg as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> })
    .devDependencies?.[name] ??
  (pkg as { dependencies?: Record<string, string> }).dependencies?.[name];

describe('@types/node', () => {
  // The floor lives in the root `engines.node` and is what CI pins; every
  // package in the workspace runs on it, so every package's types answer to it.
  const engine = (readPkg('package.json') as { engines: { node: string } }).engines.node;

  it.each(manifests().filter((path) => typesOf(readPkg(path), '@types/node') !== undefined))(
    '%s does not type against a newer Node than we support',
    (path) => {
      const types = typesOf(readPkg(path), '@types/node')!;
      expect(
        compare(floor(types), floor(engine), 1),
        `${path} declares @types/node ${types} while the workspace supports Node ${engine}. ` +
          `Types above the floor let a call added in a later Node compile and then fail on ` +
          `the oldest one we ship for — raise engines.node deliberately, or hold the types.`,
      ).toBeLessThanOrEqual(0);
    },
  );
});

describe('@types/vscode', () => {
  const pkg = readPkg('apps/vscode/package.json') as {
    engines: { vscode: string };
    devDependencies: Record<string, string>;
  };

  it('does not type against a newer VS Code than the extension runs on', () => {
    const engine = pkg.engines.vscode;
    const types = pkg.devDependencies['@types/vscode'];
    expect(types, 'apps/vscode must declare @types/vscode').toBeTypeOf('string');

    expect(
      compare(floor(types!), floor(engine), 2),
      `@types/vscode ${types} is newer than engines.vscode ${engine}. ` +
        `vsce package refuses this outright, but only minutes into release:check. ` +
        `Raising engines.vscode drops every VS Code in between — decide that on purpose.`,
    ).toBeLessThanOrEqual(0);
  });
});
