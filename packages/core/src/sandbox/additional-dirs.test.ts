import { describe, expect, it } from 'vitest';
import { withAdditionalWritableDirs } from './index.js';
import type { SandboxConfig } from '../config/types.js';

describe('withAdditionalWritableDirs', () => {
  it('returns the config unchanged when there are no dirs', () => {
    const c: SandboxConfig = { enabled: true };
    expect(withAdditionalWritableDirs(c, [])).toBe(c);
    expect(withAdditionalWritableDirs(c, undefined)).toBe(c);
  });

  it('is a no-op (undefined) when the sandbox is off', () => {
    expect(withAdditionalWritableDirs(undefined, ['/x'])).toBeUndefined();
  });

  it('adds dirs to filesystem.allowWrite, deduped, without mutating the input', () => {
    const c: SandboxConfig = { enabled: true, filesystem: { allowWrite: ['/a'] } };
    const r = withAdditionalWritableDirs(c, ['/a', '/b']);
    expect(r?.filesystem?.allowWrite).toEqual(['/a', '/b']);
    expect(c.filesystem?.allowWrite).toEqual(['/a']); // input untouched
  });

  it('seeds allowWrite when the config had none', () => {
    const r = withAdditionalWritableDirs({ enabled: true }, ['/proj/sub']);
    expect(r?.filesystem?.allowWrite).toEqual(['/proj/sub']);
  });
});
