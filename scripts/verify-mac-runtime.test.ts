import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, 'verify-mac-runtime.mjs');

describe('packaged runtime smoke rejects broken artifacts', () => {
  it.each([
    ['early process crash', 'process.exit(23);', 'Runtime exited: 23'],
    [
      'invalid JSON transport',
      "process.stdin.on('data', () => console.log('invalid json'));",
      'SyntaxError',
    ],
    [
      'uncorrelated protocol rejection',
      `process.stdin.on('data', () => console.log(JSON.stringify({ id: null, error: { code: 'parse_error' } })));`,
      'parse_error',
    ],
    [
      'missing journal capability',
      `process.stdin.on('data', () => console.log(JSON.stringify({ id: 1, result: { protocolVersion: 1, capabilities: {} } })));`,
      'AssertionError',
    ],
  ])('%s fails promptly instead of publishing a false success', (_name, source, expected) => {
    const root = mkdtempSync(join(tmpdir(), 'mac-artifact-negative-'));
    const app = join(root, 'DeepCode.app');
    mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
    mkdirSync(join(app, 'Contents/Resources'), { recursive: true });
    symlinkSync(process.execPath, join(app, 'Contents/MacOS/deepcode-runtime'));
    writeFileSync(join(app, 'Contents/Resources/app-server.cjs'), source);
    try {
      const result = spawnSync(process.execPath, [script, app], {
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(expected);
      expect(result.stdout).not.toContain('"status":"passed"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
