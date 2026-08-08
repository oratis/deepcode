import { RuntimeHost } from '@deepcode/core';
import { ToolRegistry } from '@deepcode/core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Provider, ProviderResult } from '@deepcode/core';
import { capabilitiesFor } from './capabilities.js';

const nullProvider: Provider = {
  name: 'null',
  async runTurn(): Promise<ProviderResult> {
    throw new Error('not used');
  },
};

/**
 * The alignment plan's P0 is that permissions and tool execution are not a
 * unified runtime capability — different hosts resolve the same settings
 * differently. This suite is the executable form of that claim: if the CLI and
 * the app-server ever disagree about what the runtime may do, it fails here
 * rather than in someone's workspace.
 *
 * VS Code and the LSP are thin protocol clients over the app-server, so they
 * receive the server's answer verbatim and are equal by construction.
 */
describe('runtime capabilities agree across hosts', () => {
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-caps-cwd-'));
    home = await mkdtemp(join(tmpdir(), 'dc-caps-home-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  async function writeSettings(settings: Record<string, unknown>): Promise<void> {
    await mkdir(join(home), { recursive: true });
    await writeFile(join(home, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  /** The CLI path: RuntimeHost resolves policy itself. */
  async function cliCapabilities(settings: {
    mode?: string;
    permissions?: Record<string, unknown>;
    sandbox?: Record<string, unknown>;
  }) {
    const host = new RuntimeHost({
      provider: nullProvider,
      tools: new ToolRegistry([]),
      cwd,
      home,
      mode: (settings.mode ?? 'default') as never,
      permissions: settings.permissions as never,
      sandboxConfig: settings.sandbox as never,
    });
    return host.capabilities(cwd);
  }

  it('agree on a default configuration', async () => {
    await writeSettings({});
    const server = await capabilitiesFor(cwd, home);
    const cli = await cliCapabilities({});
    expect(server.sandbox).toEqual(cli.sandbox);
    expect(server.writeScope).toEqual(cli.writeScope);
    expect(server.confirmationRequired).toEqual(cli.confirmationRequired);
    expect(server.permissions.fileContract).toEqual(cli.permissions.fileContract);
  });

  it('agree that the sandbox is off when settings disable it', async () => {
    const sandbox = { mode: 'danger-full-access' };
    await writeSettings({ sandbox });
    const server = await capabilitiesFor(cwd, home);
    const cli = await cliCapabilities({ sandbox });
    expect(server.sandbox).toEqual({ mode: 'danger-full-access', effective: false });
    expect(server.sandbox).toEqual(cli.sandbox);
    expect(server.writeScope).toEqual(cli.writeScope);
  });

  it('agree on rule counts', async () => {
    const permissions = { allow: ['Read', 'Grep'], deny: ['Bash'] };
    await writeSettings({ permissions });
    const server = await capabilitiesFor(cwd, home);
    const cli = await cliCapabilities({ permissions });
    expect(server.permissions.ruleCounts).toEqual({ allow: 2, ask: 0, deny: 1 });
    expect(server.permissions.ruleCounts).toEqual(cli.permissions.ruleCounts);
  });

  it('agree that a contract is loaded', async () => {
    await writeSettings({});
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "**/.env*"\n    read: deny\n',
    );
    const server = await capabilitiesFor(cwd, home);
    const cli = await cliCapabilities({});
    expect(server.permissions.fileContract).toBe('loaded');
    expect(server.permissions.fileContract).toBe(cli.permissions.fileContract);
  });

  it('agree that a malformed contract is invalid, not absent', async () => {
    await writeSettings({});
    await mkdir(join(cwd, '.deepcode'), { recursive: true });
    await writeFile(
      join(cwd, '.deepcode', 'file-contract.yaml'),
      'version: 1\nrules:\n  - glob: "a"\n    read: maybe\n',
    );
    const server = await capabilitiesFor(cwd, home);
    const cli = await cliCapabilities({});
    expect(server.permissions.fileContract).toBe('invalid');
    expect(server.permissions.fileContract).toBe(cli.permissions.fileContract);
  });

  it('point at the same ledger file', async () => {
    await writeSettings({});
    const server = await capabilitiesFor(cwd, home);
    const cli = await cliCapabilities({});
    expect(server.ledger.path).toBe(cli.ledger.path);
    expect(server.ledger.enabled).toBe(true);
  });
});
