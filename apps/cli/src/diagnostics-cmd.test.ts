import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { runDiagnosticsCommand } from './diagnostics-cmd.js';

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function capture(stream: PassThrough): () => string {
  let value = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    value += chunk;
  });
  return () => value;
}

describe('runDiagnosticsCommand', () => {
  it('exports through the shared app-server sanitizer', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepcode-diagnostics-cli-'));
    const cwd = join(root, 'private-workspace-name');
    const output = new PassThrough();
    const errOutput = new PassThrough();
    const outputText = capture(output);

    await expect(
      runDiagnosticsCommand(['export'], { cwd, home: root, output, errOutput }),
    ).resolves.toBe(0);
    const path = outputText().trim().replace('Wrote redacted diagnostic bundle: ', '');
    const bundle = await readFile(path, 'utf8');
    expect(bundle).not.toContain('private-workspace-name');
  });

  it('rejects unknown diagnostics actions', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepcode-diagnostics-cli-'));
    const output = new PassThrough();
    const errOutput = new PassThrough();
    const errorText = capture(errOutput);
    await expect(
      runDiagnosticsCommand([], { cwd: root, home: root, output, errOutput }),
    ).resolves.toBe(2);
    expect(errorText()).toContain('diagnostics export');
  });
});
