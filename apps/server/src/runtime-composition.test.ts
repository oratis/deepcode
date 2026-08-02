import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HookDispatcher } from '@deepcode/core/hooks';
import type { McpClientHandle } from '@deepcode/core/mcp';
import type { ToolHandler } from '@deepcode/core/tools';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPluginCapabilityBridge,
  composeRuntime,
  resolveComposedMode,
  type RuntimeCompositionServices,
} from './runtime-composition.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('composeRuntime', () => {
  it('uses trusted settings mode unless the client explicitly overrides it', () => {
    const settings = { permissions: { defaultMode: 'plan' as const } };
    expect(resolveComposedMode('default', false, settings)).toBe('plan');
    expect(resolveComposedMode('auto', true, settings)).toBe('auto');
  });

  it('registers the internal restore tool only for canonical revert turns', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-composition-revert-'));
    roots.push(cwd);
    const normal = await composeRuntime({
      cwd,
      settings: { plugins: { globalEnabled: false } },
    });
    expect(normal.tools.get('RestoreReviewAction')).toBeUndefined();
    await normal.close();

    const revert = await composeRuntime({
      cwd,
      settings: { plugins: { globalEnabled: false } },
      includeReviewRestore: true,
    });
    expect(revert.tools.get('RestoreReviewAction')).toBeDefined();
    await revert.close();
  });

  it('assembles memory, AGENTS, skills, style, hooks, and model defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dc-composition-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'dc-composition-cwd-'));
    roots.push(directory, cwd);
    await writeFile(join(directory, 'DEEPCODE.md'), 'User-level instructions.');
    await writeFile(join(cwd, 'AGENTS.md'), 'Project agent instructions.');
    await mkdir(join(directory, 'skills', 'verify'), { recursive: true });
    await writeFile(
      join(directory, 'skills', 'verify', 'SKILL.md'),
      '---\nname: verify\ndescription: Verify the result.\n---\nRun the relevant tests.',
    );
    await mkdir(join(directory, 'output-styles'), { recursive: true });
    await writeFile(
      join(directory, 'output-styles', 'focused.md'),
      '---\nname: focused\n---\nReport only material findings.',
    );

    const composition = await composeRuntime({
      cwd,
      directory,
      settings: {
        model: 'deepseek-reasoner',
        effortLevel: 'high',
        outputStyle: 'focused',
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'prompt', prompt: 'Additional hook context.' }] }],
        },
      },
    });

    expect(composition.systemPrompt).toContain('User-level instructions.');
    expect(composition.systemPrompt).toContain('Project agent instructions.');
    expect(composition.systemPrompt).toContain('verify');
    expect(composition.systemPrompt).toContain('Report only material findings.');
    expect(composition.tools.get('Read')).toBeDefined();
    expect(composition.tools.get('Bash')).toBeDefined();
    expect(composition.tools.get('Skill')).toBeDefined();
    expect(composition.model).toBe('deepseek-reasoner');
    expect(composition.effort).toBe('high');
    await expect(
      composition.hooks.dispatch({
        event: 'UserPromptSubmit',
        cwd,
        triggeredAt: '2026-08-01T00:00:00.000Z',
        payload: { prompt: 'test' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ stdout: expect.stringContaining('hook context') }),
    );
    await composition.close();
  });

  it('registers eager and deferred MCP tools, expands resources, and closes every lease', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dc-composition-mcp-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'dc-composition-mcp-cwd-'));
    roots.push(directory, cwd);
    const tool = (name: string): ToolHandler => ({
      name,
      definition: { name, description: `${name} description`, inputSchema: { type: 'object' } },
      execute: async () => ({ content: name }),
    });
    const eager = tool('mcp__eager__read');
    const deferred = tool('mcp__deferred__search');
    const handle = (serverName: string, tools: ToolHandler[]) =>
      ({ serverName, tools, resources: [], resourceTemplates: [], prompts: [] }) as McpClientHandle;
    const closeMcp = vi.fn(async () => undefined);
    const shutdownPlugins = vi.fn(async () => undefined);
    const services: Partial<RuntimeCompositionServices> = {
      collectPluginContributions: async () => ({
        dirs: [join(directory, 'plugins', 'demo')],
        mcpServers: {},
      }),
      connectAllMcpServers: async () => ({
        handles: [handle('eager', [eager]), handle('deferred', [deferred])],
        errors: [{ serverName: 'broken', error: 'offline' }],
      }),
      closeAllMcpServers: closeMcp,
      expandMcpResourceRefs: async () => ({
        text: 'expanded resource',
        resolved: [],
        errors: [
          {
            ref: { raw: '@eager:file://x', server: 'eager', uri: 'file://x' },
            error: 'missing',
          },
        ],
      }),
      wirePlugins: async () => ({
        plugins: [],
        hashMismatches: ['demo: hash drift'],
        spawnFailures: ['demo'],
        shutdown: shutdownPlugins,
      }),
    };

    const composition = await composeRuntime({
      cwd,
      directory,
      settings: {
        mcpServers: {
          eager: { command: 'eager' },
          deferred: { command: 'deferred', alwaysLoad: false },
        },
      },
      services,
    });

    expect(composition.tools.get(eager.name)).toBe(eager);
    expect(composition.tools.get(deferred.name)).toBeUndefined();
    expect(composition.tools.get('ToolSearch')).toBeDefined();
    expect(composition.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'mcp_connect_failed',
      'plugin_hash_mismatch',
      'plugin_start_failed',
    ]);
    await expect(composition.prepareUserMessage('read it')).resolves.toEqual({
      text: 'expanded resource',
      diagnostics: [expect.objectContaining({ code: 'mcp_resource_failed' })],
    });
    await composition.close();
    await composition.close();
    expect(closeMcp).toHaveBeenCalledOnce();
    expect(shutdownPlugins).toHaveBeenCalledOnce();
  });

  it('gates plugin subprocess capabilities through mode and approval policy', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dc-plugin-bridge-cwd-'));
    roots.push(cwd);
    const target = join(cwd, 'plugin.txt');
    const hooks = new HookDispatcher({});
    const denied = buildPluginCapabilityBridge({ cwd, mode: 'plan', hooks });
    await expect(denied.fs_write(target, 'blocked')).rejects.toThrow(/mode=plan/);

    const requestApproval = vi.fn(async () => 'allow' as const);
    const allowed = buildPluginCapabilityBridge({
      cwd,
      mode: 'default',
      hooks,
      requestApproval,
    });
    await allowed.fs_write(target, 'allowed');
    expect(await readFile(target, 'utf8')).toBe('allowed');
    expect(requestApproval).toHaveBeenCalledWith('Write', expect.any(String));
  });
});
