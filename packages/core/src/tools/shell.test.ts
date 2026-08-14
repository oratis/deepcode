import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ShellRegistry } from '../shell/registry.js';
import { ShellCloseTool, ShellListTool, ShellOpenTool, ShellRunTool } from './shell.js';
import type { ToolContext } from '../types.js';

describe('shell tools', () => {
  let shells: ShellRegistry;
  let ctx: ToolContext;

  beforeEach(() => {
    shells = new ShellRegistry();
    ctx = { cwd: tmpdir(), shells };
  });
  afterEach(async () => {
    await shells.closeAll();
  });

  async function openShell(): Promise<string> {
    const out = await ShellOpenTool.execute({}, ctx);
    return (out.data as { shellId: string }).shellId;
  }

  it('opens a shell and runs commands that build on each other', async () => {
    const id = await openShell();
    await ShellRunTool.execute({ shell_id: id, command: 'export BUILT=yes' }, ctx);
    const out = await ShellRunTool.execute({ shell_id: id, command: 'echo "$BUILT"' }, ctx);

    expect(out.isError).toBeFalsy();
    expect(out.content).toContain('yes');
    expect(out.content).toContain('exit: 0');
  });

  it('reports a failing command as an error', async () => {
    const id = await openShell();
    const out = await ShellRunTool.execute({ shell_id: id, command: 'bash -c "exit 7"' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('exit: 7');
  });

  it('says the shell is unknown instead of silently opening a new one', async () => {
    const out = await ShellRunTool.execute({ shell_id: 'shell-999', command: 'echo hi' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('no open shell');
  });

  it('lists and closes shells', async () => {
    const id = await openShell();
    expect((await ShellListTool.execute({}, ctx)).content).toContain(id);

    expect((await ShellCloseTool.execute({ shell_id: id }, ctx)).content).toContain('Closed');
    expect((await ShellListTool.execute({}, ctx)).content).toBe('No shells open.');
  });

  it('closing an unknown shell is stated, not an error', async () => {
    const out = await ShellCloseTool.execute({ shell_id: 'shell-999' }, ctx);
    expect(out.isError).toBeFalsy();
    expect(out.content).toContain('nothing to close');
  });

  it('points at Bash when the host has no registry', async () => {
    // Silently doing nothing would leave the model waiting on state that never
    // persists; naming the alternative lets it carry on.
    const out = await ShellOpenTool.execute({}, { cwd: tmpdir() });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Bash tool');
  });

  it('says plainly when a timeout cost the shell its state', async () => {
    const id = await openShell();
    const out = await ShellRunTool.execute(
      { shell_id: id, command: 'sleep 30', timeout: 400 },
      ctx,
    );
    // Interrupted but recovered: the shell survives, so state is intact.
    expect(out.content).toContain('interrupted after 400ms');
    expect(out.content).toContain('still usable');
    expect(await ShellRunTool.execute({ shell_id: id, command: 'echo ok' }, ctx)).toMatchObject({
      isError: false,
    });
  });

  it('resolves a relative cwd against the workspace', async () => {
    const out = await ShellOpenTool.execute({ cwd: '.' }, ctx);
    expect((out.data as { cwd: string }).cwd).toBe(tmpdir());
  });

  it('warns that the sandbox policy is fixed at open time', async () => {
    // The shell is wrapped once, when it starts. A model that assumes otherwise
    // would misread a later settings change as applying to an open shell.
    const out = await ShellOpenTool.execute({}, ctx);
    expect(out.content).toContain('sandbox policy is fixed');
  });

  it('warns in its description that full-screen programs do not work', () => {
    expect(ShellOpenTool.definition.description).toContain('vim');
  });
});
