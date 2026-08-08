import { describe, expect, it } from 'vitest';
import {
  describeClamp,
  resolveTriggerMode,
  tightenPermissions,
  tightenSandbox,
} from './profile.js';
import type { Mode } from '../types.js';

describe('resolveTriggerMode', () => {
  it('clamps an inherited permissive mode to default', () => {
    // The whole point: `bypassPermissions` chosen for REPL convenience must not
    // silently become the posture of a job that fires with nobody watching.
    for (const ambient of ['bypassPermissions', 'acceptEdits'] as Mode[]) {
      const resolved = resolveTriggerMode(undefined, ambient);
      expect(resolved).toMatchObject({ mode: 'default', clamped: true, ambient });
    }
  });

  it('leaves a non-permissive ambient mode alone', () => {
    for (const ambient of ['default', 'plan', 'dontAsk', 'auto'] as Mode[]) {
      expect(resolveTriggerMode(undefined, ambient)).toMatchObject({
        mode: ambient,
        clamped: false,
      });
    }
  });

  it('honours an explicit profile mode, including a permissive one', () => {
    // This is the opt-in that makes the clamp safe to have: users who really do
    // want an unattended bypass can still say so, deliberately, per job.
    const resolved = resolveTriggerMode({ mode: 'bypassPermissions' }, 'default');
    expect(resolved).toMatchObject({ mode: 'bypassPermissions', clamped: false });
  });

  it('lets a profile pick a stricter mode than ambient', () => {
    expect(resolveTriggerMode({ mode: 'plan' }, 'bypassPermissions').mode).toBe('plan');
  });

  it('explains a clamp, and says nothing when there was none', () => {
    // A silent clamp is as surprising as a silent grant, just in the other
    // direction.
    const clamped = describeClamp(resolveTriggerMode(undefined, 'bypassPermissions'));
    expect(clamped).toContain('bypassPermissions');
    expect(clamped).toContain('profile.mode');
    expect(describeClamp(resolveTriggerMode(undefined, 'default'))).toBeUndefined();
  });
});

describe('tightenPermissions', () => {
  it('returns the ambient rules untouched without a profile', () => {
    const ambient = { allow: ['Read'], deny: ['Bash'] };
    expect(tightenPermissions(ambient, undefined)).toBe(ambient);
  });

  it('unions denies — either source may add a restriction', () => {
    const out = tightenPermissions({ deny: ['Bash'] }, { deny: ['Write'] });
    expect(out?.deny?.sort()).toEqual(['Bash', 'Write']);
  });

  it('unions asks', () => {
    const out = tightenPermissions({ ask: ['Write'] }, { ask: ['Edit'] });
    expect(out?.ask?.sort()).toEqual(['Edit', 'Write']);
  });

  it('intersects allows, so a profile can narrow but never widen', () => {
    const out = tightenPermissions({ allow: ['Read', 'Grep', 'Write'] }, { allow: ['Read'] });
    expect(out?.allow).toEqual(['Read']);
  });

  it('cannot introduce an allow the ambient rules did not have', () => {
    // The one-way property. Whatever a profile author writes, the result is
    // never more permissive than the settings already were.
    const out = tightenPermissions({ allow: ['Read'] }, { allow: ['Read', 'Bash'] });
    expect(out?.allow).toEqual(['Read']);
  });

  it('keeps the ambient allows when the profile names none', () => {
    const out = tightenPermissions({ allow: ['Read'] }, { deny: ['Bash'] });
    expect(out?.allow).toEqual(['Read']);
  });

  it('deduplicates', () => {
    const out = tightenPermissions({ deny: ['Bash'] }, { deny: ['Bash'] });
    expect(out?.deny).toEqual(['Bash']);
  });
});

describe('tightenSandbox', () => {
  it('takes the stricter of the two', () => {
    expect(tightenSandbox('danger-full-access', 'workspace-write')).toBe('workspace-write');
    expect(tightenSandbox('workspace-write', 'read-only')).toBe('read-only');
  });

  it('refuses to loosen', () => {
    expect(tightenSandbox('read-only', 'danger-full-access')).toBe('read-only');
    expect(tightenSandbox('workspace-write', 'danger-full-access')).toBe('workspace-write');
  });

  it('falls back sensibly when one side is absent', () => {
    expect(tightenSandbox(undefined, 'read-only')).toBe('read-only');
    expect(tightenSandbox('read-only', undefined)).toBe('read-only');
    expect(tightenSandbox(undefined, undefined)).toBeUndefined();
  });

  it('ignores an unrecognised profile value rather than trusting it', () => {
    // cron.json is a plain file a user can hand-edit; a typo must not widen.
    expect(tightenSandbox('workspace-write', 'yolo' as never)).toBe('workspace-write');
  });
});
