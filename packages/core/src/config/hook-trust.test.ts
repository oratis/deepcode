import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HookTrustStore } from './hook-trust.js';
import { loadSettings, writeSettings } from './loader.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('HookTrustStore', () => {
  it('filters project command hooks until their exact definition is trusted', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dc-hook-trust-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'dc-hook-trust-cwd-'));
    roots.push(home, cwd);
    await writeSettings(join(home, '.deepcode', 'settings.json'), {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] },
    });
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'echo project' },
              { type: 'prompt', prompt: 'safe context' },
            ],
          },
        ],
      },
    });
    const loaded = await loadSettings({ cwd, home });
    const store = new HookTrustStore({ home });

    const pending = await store.review(cwd, loaded, loaded.merged.hooks);
    expect(pending.hooks?.Stop?.[0]?.hooks).toHaveLength(1);
    expect(pending.hooks?.PreToolUse?.[0]?.hooks.map((hook) => hook.type)).toEqual(['prompt']);
    expect(pending.reviews).toEqual([
      expect.objectContaining({ trusted: false, command: 'echo project' }),
    ]);

    await store.trust(cwd, pending.reviews);
    const trusted = await store.review(cwd, loaded, loaded.merged.hooks);
    expect(trusted.hooks?.PreToolUse?.[0]?.hooks.map((hook) => hook.type)).toEqual([
      'command',
      'prompt',
    ]);

    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo changed' }] }],
      },
    });
    const changed = await loadSettings({ cwd, home });
    const reviewed = await store.review(cwd, changed, changed.merged.hooks);
    expect(reviewed.reviews[0]).toEqual(expect.objectContaining({ trusted: false }));
    expect(reviewed.hooks?.PreToolUse).toBeUndefined();
  });
});
