import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentShell } from './session.js';
import { ShellRegistry } from './registry.js';

const open = async (): Promise<PersistentShell> =>
  PersistentShell.open({ cwd: await mkdtemp(join(tmpdir(), 'dc-shell-')) });

describe('PersistentShell', () => {
  const opened: PersistentShell[] = [];
  const track = async (): Promise<PersistentShell> => {
    const shell = await open();
    opened.push(shell);
    return shell;
  };
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((s) => s.close()));
  });

  it('runs a command and reports its exit code', async () => {
    const shell = await track();
    const result = await shell.run('echo hello', 10_000);
    expect(result.output).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('reports a non-zero exit code', async () => {
    const shell = await track();
    expect((await shell.run('bash -c "exit 3"', 10_000)).exitCode).toBe(3);
  });

  it('treats `exit` as closing the shell, because that is what it does', async () => {
    // Not a bug to paper over: `exit` in a real shell ends the session too. The
    // caller is told the shell is gone rather than being handed a dead id.
    const shell = await track();
    const out = await shell.run('exit 3', 10_000);
    expect(out.discarded).toBe(true);
    expect(shell.closed).toBe(true);
  });

  it('keeps the working directory between commands', async () => {
    // The entire point: `cd` in one call is still in effect in the next.
    const shell = await track();
    await shell.run('mkdir -p sub && cd sub', 10_000);
    expect((await shell.run('basename "$PWD"', 10_000)).output).toBe('sub');
  });

  it('keeps environment variables between commands', async () => {
    const shell = await track();
    await shell.run('export GREETING=hi', 10_000);
    expect((await shell.run('echo "$GREETING"', 10_000)).output).toBe('hi');
  });

  it('keeps shell functions between commands', async () => {
    const shell = await track();
    await shell.run('greet() { echo "hey $1"; }', 10_000);
    expect((await shell.run('greet there', 10_000)).output).toBe('hey there');
  });

  it('interleaves stderr with stdout', async () => {
    const shell = await track();
    const out = await shell.run('echo one; echo two >&2; echo three', 10_000);
    expect(out.output.split('\n')).toEqual(['one', 'two', 'three']);
  });

  it('runs multi-line commands', async () => {
    const shell = await track();
    const out = await shell.run('for i in 1 2 3; do\n  echo "n$i"\ndone', 10_000);
    expect(out.output).toBe('n1\nn2\nn3');
  });

  it('is not fooled by a command that prints something sentinel-shaped', async () => {
    // The sentinel is random per session, so this cannot collide by accident.
    const shell = await track();
    const out = await shell.run('echo "__DEEPCODE_deadbeef__ 0"; echo real', 10_000);
    expect(out.output).toContain('real');
    expect(out.exitCode).toBe(0);
  });

  it('does not let a command steal the sentinel through stdin', async () => {
    // `cat` with an inherited stdin would swallow the sentinel line and hang
    // until the deadline. Commands run with stdin closed for exactly this.
    const shell = await track();
    const out = await shell.run('cat', 10_000);
    expect(out.timedOut).toBe(false);
    expect(out.exitCode).toBe(0);
  });

  it('interrupts a command that overruns, and stays usable', async () => {
    const shell = await track();
    const out = await shell.run('sleep 30', 700);
    expect(out.timedOut).toBe(true);
    expect(out.discarded).toBe(false);
    // Still alive, and still holding the state it had.
    expect((await shell.run('echo alive', 10_000)).output).toBe('alive');
  });

  it('refuses to run two commands at once', async () => {
    const shell = await track();
    const first = shell.run('sleep 0.4', 10_000);
    await expect(shell.run('echo second', 10_000)).rejects.toThrow(/already running/);
    await first;
  });

  it('reports as discarded once closed', async () => {
    const shell = await track();
    await shell.close();
    const out = await shell.run('echo anything', 10_000);
    expect(out.discarded).toBe(true);
  });

  it('kills what it started when it closes', async () => {
    const shell = await track();
    const started = await shell.run('sleep 60 & echo "$!"', 10_000);
    const pid = Number(started.output.trim());
    expect(Number.isFinite(pid)).toBe(true);

    await shell.close();
    await new Promise((r) => setTimeout(r, 300));
    // A shell that leaves its children running is the leak this must not have.
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe('ShellRegistry', () => {
  it('hands back the same shell for an id', async () => {
    const registry = new ShellRegistry();
    const id = await registry.open({ cwd: tmpdir() });
    await registry.get(id)?.run('export MARK=kept', 10_000);
    expect((await registry.get(id)?.run('echo "$MARK"', 10_000))?.output).toBe('kept');
    await registry.closeAll();
  });

  it('lists what is open and forgets what is closed', async () => {
    const registry = new ShellRegistry();
    const id = await registry.open({ cwd: tmpdir() });
    expect(registry.list().map((s) => s.id)).toEqual([id]);

    expect(await registry.close(id)).toBe(true);
    expect(registry.list()).toEqual([]);
    expect(registry.get(id)).toBeUndefined();
    expect(await registry.close(id)).toBe(false);
  });

  it('refuses to open past the cap rather than accumulating shells', async () => {
    const registry = new ShellRegistry({ maxShells: 2 });
    await registry.open({ cwd: tmpdir() });
    await registry.open({ cwd: tmpdir() });
    await expect(registry.open({ cwd: tmpdir() })).rejects.toThrow(/Too many shells/);
    await registry.closeAll();
  });

  it('closes an idle shell on its own', async () => {
    const registry = new ShellRegistry({ idleTimeoutMs: 150 });
    const id = await registry.open({ cwd: tmpdir() });
    await new Promise((r) => setTimeout(r, 400));
    expect(registry.get(id)).toBeUndefined();
    await registry.closeAll();
  });

  it('restarts the idle countdown when a shell is used', async () => {
    const registry = new ShellRegistry({ idleTimeoutMs: 300 });
    const id = await registry.open({ cwd: tmpdir() });
    await new Promise((r) => setTimeout(r, 200));
    registry.touch(id);
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.get(id)).toBeDefined();
    await registry.closeAll();
  });

  it('closeAll leaves nothing open', async () => {
    const registry = new ShellRegistry();
    await registry.open({ cwd: tmpdir() });
    await registry.open({ cwd: tmpdir() });
    await registry.closeAll();
    expect(registry.list()).toEqual([]);
  });
});
