import { describe, expect, it } from 'vitest';
import { withAdditionalWritableDirs } from './additional-dirs.js';
import type { SandboxConfig } from '../config/types.js';

const enabled: SandboxConfig = { enabled: true, filesystem: { allowWrite: ['/repo'] } };

describe('withAdditionalWritableDirs', () => {
  it('folds additional directories into filesystem.allowWrite', () => {
    const out = withAdditionalWritableDirs(enabled, ['/data', '/scratch']);
    expect(out?.filesystem?.allowWrite).toEqual(['/repo', '/data', '/scratch']);
  });

  it('never mutates its input', () => {
    const input: SandboxConfig = { enabled: true, filesystem: { allowWrite: ['/repo'] } };
    withAdditionalWritableDirs(input, ['/data']);
    expect(input.filesystem?.allowWrite).toEqual(['/repo']);
  });

  it('dedupes against existing entries', () => {
    const out = withAdditionalWritableDirs(enabled, ['/repo', '/data']);
    expect(out?.filesystem?.allowWrite).toEqual(['/repo', '/data']);
  });

  it('returns the same object when nothing new is added', () => {
    expect(withAdditionalWritableDirs(enabled, ['/repo'])).toBe(enabled);
  });

  it('seeds allowWrite when the sandbox has no filesystem section', () => {
    const out = withAdditionalWritableDirs({ enabled: true }, ['/data']);
    expect(out?.filesystem?.allowWrite).toEqual(['/data']);
  });

  it('is a no-op when the sandbox is disabled — never silently enables it', () => {
    const off: SandboxConfig = { enabled: false };
    expect(withAdditionalWritableDirs(off, ['/data'])).toBe(off);
    expect(withAdditionalWritableDirs(undefined, ['/data'])).toBeUndefined();
  });

  it('is a no-op for empty/undefined directory lists', () => {
    expect(withAdditionalWritableDirs(enabled, [])).toBe(enabled);
    expect(withAdditionalWritableDirs(enabled, undefined)).toBe(enabled);
  });

  it('resolves relative entries against cwd', () => {
    const out = withAdditionalWritableDirs(enabled, ['sub/dir'], '/work');
    expect(out?.filesystem?.allowWrite).toEqual(['/repo', '/work/sub/dir']);
  });

  it('drops relative entries when no cwd is available rather than passing them through', () => {
    // Sandbox profile writers require absolute paths; a bare relative string
    // would be meaningless (or worse, mis-anchored) by the time it got there.
    expect(withAdditionalWritableDirs(enabled, ['sub/dir'])).toBe(enabled);
  });
});
