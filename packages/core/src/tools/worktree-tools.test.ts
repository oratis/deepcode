import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnterWorktreeTool, ExitWorktreeTool } from './worktree-tools.js';
import type { ToolContext } from '../types.js';

const exec = promisify(execFile);

describe('EnterWorktree / ExitWorktree', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'dc-wt-'));
    await exec('git', ['init', '-q'], { cwd: repo });
    await exec('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await exec('git', ['config', 'user.name', 't'], { cwd: repo });
    await writeFile(join(repo, 'a.txt'), 'hi');
    await exec('git', ['add', '.'], { cwd: repo });
    await exec('git', ['commit', '-qm', 'init'], { cwd: repo });
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('enters a worktree (switches cwd) and exits (restores cwd)', async () => {
    const ctx: ToolContext = { cwd: repo };
    const enter = await EnterWorktreeTool.execute({ branch: 'dc/test' }, ctx);
    expect(enter.isError).toBeFalsy();
    const wtPath = (enter.data as { path: string }).path;
    expect(ctx.cwd).toBe(wtPath); // cwd switched into the worktree
    expect(ctx.worktree?.originalCwd).toBe(repo);
    await access(join(wtPath, 'a.txt')); // committed file is present in the worktree

    const exit = await ExitWorktreeTool.execute({}, ctx);
    expect(exit.isError).toBeFalsy();
    expect(ctx.cwd).toBe(repo); // cwd restored
    expect(ctx.worktree).toBeUndefined();
    await expect(access(wtPath)).rejects.toBeTruthy(); // worktree dir removed
  }, 20_000);

  it('EnterWorktree refuses to nest; ExitWorktree errors when not in one', async () => {
    const ctx: ToolContext = { cwd: repo };
    await EnterWorktreeTool.execute({}, ctx);
    const again = await EnterWorktreeTool.execute({}, ctx);
    expect(again.isError).toBe(true);
    expect(again.content).toMatch(/Already in a worktree/);
    await ExitWorktreeTool.execute({}, ctx);

    const exitAgain = await ExitWorktreeTool.execute({}, ctx);
    expect(exitAgain.isError).toBe(true);
    expect(exitAgain.content).toMatch(/Not currently in a worktree/);
  }, 20_000);
});
