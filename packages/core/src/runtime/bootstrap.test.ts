import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppBootstrap } from './bootstrap.js';
import { resolveProfile, RUNTIME_PROFILES } from './profile.js';
import { loadProfileLayers } from './profile-loader.js';
import type { Provider } from '../providers/types.js';
import { RuntimeHost } from './host.js';
import { ToolRegistry } from '../tools/registry.js';

const provider = { chat: vi.fn() } as unknown as Provider;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('sealed bootstrap and profiles', () => {
  it.each(RUNTIME_PROFILES)(
    'boots %s through the real host with the same trusted roots',
    async (profileId) => {
      const host = new RuntimeHost({
        profileId,
        provider,
        tools: new ToolRegistry([]),
        cwd: '/tmp',
        disableLedger: true,
      });
      const inspection = await host.bootstrap.inspect();
      expect(inspection.profile.profileId).toBe(profileId);
      expect(inspection.roots.map((root) => root.service)).toEqual([
        'policy',
        'credentials',
        'resources',
        'journal',
      ]);
      expect(inspection.plugins).toContain('deepcode.base-coding');
      expect(provider.chat).not.toHaveBeenCalled();
      await host.close();
      await expect(host.bootstrap.inspect()).rejects.toThrow('closed');
    },
  );
  it.each([
    { plugins: [] },
    { bundles: [] },
    { credentials: {} },
    { engine: 'evil' },
    { endpoint: 'https://evil.invalid' },
    { schemaVersion: 3 },
    { tools: { allow: ['Read', 'Read'] } },
  ])('rejects unsafe/unknown patches %j', (patch) => {
    expect(() =>
      resolveProfile('headless', [{ source: 'startup', value: { schemaVersion: 1, ...patch } }]),
    ).toThrow();
  });
  it('intersects allows, unions denies, snapshots patches, and exposes value-free provenance', async () => {
    const patch = { schemaVersion: 1, tools: { allow: ['Read'], deny: ['Write'] } };
    const bootstrap = new AppBootstrap({
      provider,
      layers: [
        { source: 'user-profile', value: patch },
        {
          source: 'trusted-workspace',
          value: { schemaVersion: 1, tools: { allow: ['Read', 'Bash'], deny: ['Bash'] } },
        },
      ],
    });
    patch.tools.allow.push('Write');
    const result = await bootstrap.inspect();
    expect(result.profile.tools).toEqual({ allow: ['Read'], deny: ['Write', 'Bash'] });
    expect(
      result.provenance.every((value) => Object.keys(value).sort().join() === 'field,source'),
    ).toBe(true);
    result.profile.tools.allow!.push('Bash');
    expect((await bootstrap.inspect()).profile.tools.allow).toEqual(['Read']);
    await bootstrap.close();
  });
  it('rejects active reload and preserves the last good generation after failed admission', async () => {
    const bootstrap = new AppBootstrap({ provider });
    const before = await bootstrap.inspect();
    let finish!: () => void;
    const entered = Promise.withResolvers<void>();
    const running = bootstrap.run(undefined, async () => {
      entered.resolve();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await entered.promise;
    await expect(bootstrap.reload([])).rejects.toThrow('idle');
    finish();
    await running;
    await expect(
      bootstrap.reload([{ source: 'startup', value: { schemaVersion: 1, bundles: [] } }]),
    ).rejects.toThrow();
    expect((await bootstrap.inspect()).generation).toBe(before.generation);
    await bootstrap.reload([
      { source: 'startup', value: { schemaVersion: 1, tools: { deny: ['Bash'] } } },
    ]);
    expect((await bootstrap.inspect()).generation).not.toBe(before.generation);
    await bootstrap.close();
  });
  it('shutdown cancels active turns, drains them, and refuses new admission', async () => {
    const bootstrap = new AppBootstrap({ provider });
    const entered = Promise.withResolvers<void>();
    let ended = false;
    const turn = bootstrap.run(undefined, async ({ signal }) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      ended = true;
    });
    await entered.promise;
    await bootstrap.close();
    await turn;
    expect(ended).toBe(true);
    await expect(bootstrap.run(undefined, async () => {})).rejects.toThrow();
  });
  it('ignores untrusted project profiles and validates trusted layers before activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dc-profile-'));
    roots.push(root);
    await mkdir(join(root, '.deepcode'), { recursive: true });
    await writeFile(
      join(root, '.deepcode/runtime-profile.json'),
      JSON.stringify({ schemaVersion: 1, credentials: { secret: 'never-echo' } }),
    );
    expect(
      await loadProfileLayers({ profileId: 'headless', cwd: root, directory: join(root, 'user') }),
    ).toEqual([]);
    await expect(
      loadProfileLayers({
        profileId: 'headless',
        cwd: root,
        directory: join(root, 'user'),
        workspaceTrusted: true,
      }),
    ).rejects.toThrow('Unknown profile field: credentials');
  });
});

it('a restrictive profile is enforced even in an explicitly permissive host', async () => {
  const execute = vi.fn(async () => ({ content: 'side effect' }));
  let step = 0;
  const host = new RuntimeHost({
    profileLayers: [{ source: 'startup', value: { schemaVersion: 1, tools: { deny: ['Bash'] } } }],
    tools: new ToolRegistry([
      { name: 'Bash', definition: { name: 'Bash', description: '', inputSchema: {} }, execute },
    ]),
    cwd: '/tmp',
    mode: 'bypassPermissions',
    disableLedger: true,
    provider: {
      name: 'fixture',
      runTurn: async () => ({
        content:
          step++ === 0
            ? [{ type: 'tool_use', id: 'call', name: 'Bash', input: { command: 'echo no' } }]
            : [],
        stopReason: step === 1 ? 'tool_use' : 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
      }),
    },
  });
  await host.run({
    model: 'fixture',
    systemPrompt: '',
    userMessage: 'test',
    systemReminders: false,
  });
  expect(execute).not.toHaveBeenCalled();
  await host.close();
});

it('refuses activation when an actual security service is missing', async () => {
  const bootstrap = new AppBootstrap({ provider });
  const roots = Reflect.get(bootstrap, 'roots');
  Reflect.set(roots, 'policy', undefined);
  await expect(bootstrap.start()).rejects.toThrow();
  expect(provider.chat).not.toHaveBeenCalled();
});
it('persists the last good profile and leaves it unchanged after a rejected reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dc-generation-'));
  roots.push(root);
  const bootstrap = new AppBootstrap({ provider, stateDirectory: root });
  await bootstrap.start();
  const { readFile } = await import('node:fs/promises');
  const before = await readFile(join(root, 'interactive.last-good.json'));
  await expect(
    bootstrap.reload([{ source: 'startup', value: { schemaVersion: 1, plugins: [] } }]),
  ).rejects.toThrow();
  expect(await readFile(join(root, 'interactive.last-good.json'))).toEqual(before);
  await bootstrap.close();
});
