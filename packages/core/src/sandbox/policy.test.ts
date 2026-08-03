import { describe, expect, it } from 'vitest';
import {
  describeSandboxMode,
  isSandboxMode,
  resolveSandboxMode,
  sandboxConfigForMode,
  withSandboxMode,
} from './policy.js';

describe('resolveSandboxMode', () => {
  it('takes mode when set', () => {
    expect(resolveSandboxMode({ mode: 'read-only' })).toBe('read-only');
  });

  it('lets mode win over the legacy enabled flag', () => {
    expect(resolveSandboxMode({ mode: 'read-only', enabled: false })).toBe('read-only');
    expect(resolveSandboxMode({ mode: 'danger-full-access', enabled: true })).toBe(
      'danger-full-access',
    );
  });

  it('maps the legacy boolean on', () => {
    expect(resolveSandboxMode({ enabled: true })).toBe('workspace-write');
    expect(resolveSandboxMode({ enabled: false })).toBe('danger-full-access');
  });

  it('falls back to workspace-write when nothing is configured', () => {
    expect(resolveSandboxMode(undefined)).toBe('workspace-write');
    expect(resolveSandboxMode({})).toBe('workspace-write');
  });

  it('honours a caller-supplied fallback, so libraries keep the old default', () => {
    expect(resolveSandboxMode(undefined, 'danger-full-access')).toBe('danger-full-access');
  });

  it('ignores a mode value that is not a mode', () => {
    expect(resolveSandboxMode({ mode: 'yolo' as never })).toBe('workspace-write');
  });
});

describe('sandboxConfigForMode', () => {
  it('always makes the workspace readable — the bug that made the sandbox unusable', () => {
    const cfg = sandboxConfigForMode({}, 'workspace-write', '/repo');
    expect(cfg?.filesystem?.allowRead).toContain('/repo');
  });

  it('makes the workspace writable in workspace-write only', () => {
    expect(sandboxConfigForMode({}, 'workspace-write', '/repo')?.filesystem?.allowWrite).toContain(
      '/repo',
    );
    expect(sandboxConfigForMode({}, 'read-only', '/repo')?.filesystem?.allowWrite).toEqual([]);
  });

  it('keeps read access to the workspace in read-only', () => {
    expect(sandboxConfigForMode({}, 'read-only', '/repo')?.filesystem?.allowRead).toContain(
      '/repo',
    );
  });

  it('disables the sandbox entirely for danger-full-access', () => {
    expect(sandboxConfigForMode({}, 'danger-full-access', '/repo')?.enabled).toBe(false);
  });

  it('adds a linked worktree’s git dirs, which live outside the workspace', () => {
    const cfg = sandboxConfigForMode({}, 'workspace-write', '/repo/wt', [
      '/main/.git/worktrees/wt',
      '/main/.git',
    ]);
    expect(cfg?.filesystem?.allowWrite).toEqual(
      expect.arrayContaining(['/repo/wt', '/main/.git/worktrees/wt', '/main/.git']),
    );
  });

  it('preserves configured allow lists rather than replacing them', () => {
    const cfg = sandboxConfigForMode(
      { filesystem: { allowRead: ['/data'], allowWrite: ['/out'] } },
      'workspace-write',
      '/repo',
    );
    expect(cfg?.filesystem?.allowRead).toEqual(['/data', '/repo']);
    expect(cfg?.filesystem?.allowWrite).toEqual(['/out', '/repo']);
  });

  it('does not duplicate a workspace already listed', () => {
    const cfg = sandboxConfigForMode(
      { filesystem: { allowWrite: ['/repo'] } },
      'workspace-write',
      '/repo',
    );
    expect(cfg?.filesystem?.allowWrite).toEqual(['/repo']);
  });

  it('keeps network settings untouched', () => {
    const cfg = sandboxConfigForMode(
      { network: { allowedDomains: ['example.com'] } },
      'workspace-write',
      '/repo',
    );
    expect(cfg?.network?.allowedDomains).toEqual(['example.com']);
  });
});

describe('withSandboxMode', () => {
  it('returns the config unchanged when no override is given', () => {
    const config = { mode: 'read-only' as const };
    expect(withSandboxMode(config, undefined)).toBe(config);
  });

  it('applies the override', () => {
    expect(withSandboxMode({}, 'read-only')?.mode).toBe('read-only');
  });

  it('drops a stale enabled:false so an explicit flag is not silently defeated', () => {
    const result = withSandboxMode({ enabled: false }, 'workspace-write');
    expect(result?.mode).toBe('workspace-write');
    expect(result?.enabled).toBeUndefined();
    expect(resolveSandboxMode(result)).toBe('workspace-write');
  });
});

describe('isSandboxMode / describeSandboxMode', () => {
  it('recognises exactly the three modes', () => {
    expect(isSandboxMode('read-only')).toBe(true);
    expect(isSandboxMode('workspace-write')).toBe(true);
    expect(isSandboxMode('danger-full-access')).toBe(true);
    expect(isSandboxMode('off')).toBe(false);
  });

  it('describes each mode in terms of what a command may do', () => {
    expect(describeSandboxMode('read-only')).toMatch(/cannot write/);
    expect(describeSandboxMode('workspace-write')).toMatch(/can write/);
    expect(describeSandboxMode('danger-full-access')).toMatch(/unsandboxed/);
  });
});
