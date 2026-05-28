import { describe, expect, it } from 'vitest';
import { wrapBashCommand } from './index.js';

describe('wrapBashCommand', () => {
  it('returns unwrapped /bin/sh when sandbox disabled', async () => {
    const r = await wrapBashCommand({
      userCommand: 'echo hi',
      cwd: '/tmp',
      config: { enabled: false },
    });
    expect(r.command).toBe('/bin/sh');
    expect(r.args).toEqual(['-c', 'echo hi']);
  });

  it('returns unwrapped when no config provided', async () => {
    const r = await wrapBashCommand({ userCommand: 'true', cwd: '/tmp', config: undefined });
    expect(r.command).toBe('/bin/sh');
  });

  it('bypasses sandbox for excludedCommands', async () => {
    const r = await wrapBashCommand({
      userCommand: 'git status',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    expect(r.command).toBe('/bin/sh');
  });

  it('bypasses for exact-match excluded command', async () => {
    const r = await wrapBashCommand({
      userCommand: 'git',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    expect(r.command).toBe('/bin/sh');
  });

  it('does NOT bypass when excluded only is a prefix of a different command', async () => {
    const r = await wrapBashCommand({
      userCommand: 'gittime --show',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    // platform may vary — but the key invariant is "we did try to sandbox"
    if (process.platform === 'darwin') expect(r.command).toBe('sandbox-exec');
    else if (process.platform === 'linux') expect(r.command).toBe('bwrap');
    else expect(r.command).toBe('/bin/sh');
  });

  it.runIf(process.platform === 'darwin')('wraps with sandbox-exec on macOS', async () => {
    const r = await wrapBashCommand({
      userCommand: 'echo hi',
      cwd: '/tmp',
      config: { enabled: true, filesystem: { allowRead: ['/tmp'] } },
    });
    expect(r.command).toBe('sandbox-exec');
    expect(r.args[0]).toBe('-f');
    expect(r.args[1]).toMatch(/deepcode-sb-.*\.sb$/);
    expect(r.args[2]).toBe('/bin/sh');
    expect(r.args[3]).toBe('-c');
    expect(r.args[4]).toBe('echo hi');
  });

  it.runIf(process.platform === 'linux')('wraps with bwrap on Linux', async () => {
    const r = await wrapBashCommand({
      userCommand: 'echo hi',
      cwd: '/tmp',
      config: { enabled: true },
    });
    expect(r.command).toBe('bwrap');
    expect(r.args).toContain('--ro-bind-try');
    expect(r.args[r.args.length - 3]).toBe('/bin/sh');
    expect(r.args[r.args.length - 1]).toBe('echo hi');
  });
});
