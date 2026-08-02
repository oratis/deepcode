import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { DirectoryTrustStore, writeSettings } from '@deepcode/core';
import { afterEach, describe, expect, it } from 'vitest';

import { runHooksCommand } from './hooks-cmd.js';

function sink(): { stream: Writable; text: () => string } {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    text: () => value,
  };
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('runHooksCommand', () => {
  it('lists, trusts, and revokes exact project command hooks', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dc-hooks-command-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'dc-hooks-command-cwd-'));
    roots.push(home, cwd);
    await new DirectoryTrustStore({ home }).trust(cwd, 'full');
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo reviewed' }] }] },
    });

    const pending = sink();
    expect(await runHooksCommand(['list'], { cwd, home, output: pending.stream })).toBe(0);
    expect(pending.text()).toMatch(/pending.*Stop.*echo reviewed/);

    const trusted = sink();
    await runHooksCommand(['trust', '--all'], { cwd, home, output: trusted.stream });
    expect(trusted.text()).toContain('Trusted 1');
    const listed = sink();
    await runHooksCommand(['list'], { cwd, home, output: listed.stream });
    expect(listed.text()).toMatch(/trusted.*Stop.*echo reviewed/);

    await runHooksCommand(['revoke'], { cwd, home, output: sink().stream });
    const revoked = sink();
    await runHooksCommand(['list'], { cwd, home, output: revoked.stream });
    expect(revoked.text()).toMatch(/pending/);
  });
});
