import { describe, expect, it } from 'vitest';
import {
  ALWAYS_CONFIRMED_ACTIONS,
  buildRuntimeCapabilities,
  type BuildRuntimeCapabilitiesInput,
} from './capabilities.js';

function input(
  overrides: Partial<BuildRuntimeCapabilitiesInput> = {},
): BuildRuntimeCapabilitiesInput {
  return {
    cwd: '/work/repo',
    mode: 'default',
    fileContract: 'absent',
    ...overrides,
  };
}

describe('buildRuntimeCapabilities', () => {
  it('is pure — the same input always produces the same object', () => {
    // The equality between hosts is the whole point of this method, so it has
    // to hold structurally rather than by convention.
    expect(buildRuntimeCapabilities(input())).toEqual(buildRuntimeCapabilities(input()));
  });

  it('reports the workspace as writable under workspace-write', () => {
    const caps = buildRuntimeCapabilities(input({ sandboxConfig: { mode: 'workspace-write' } }));
    expect(caps.writeScope).toContain('/work/repo');
    expect(caps.sandbox).toEqual({ mode: 'workspace-write', effective: true });
  });

  it('includes explicitly allowed write paths', () => {
    const caps = buildRuntimeCapabilities(
      input({
        sandboxConfig: { mode: 'workspace-write', filesystem: { allowWrite: ['/tmp/build'] } },
      }),
    );
    expect(caps.writeScope).toEqual(['/work/repo', '/tmp/build']);
  });

  it('reports nothing writable under read-only', () => {
    const caps = buildRuntimeCapabilities(input({ sandboxConfig: { mode: 'read-only' } }));
    expect(caps.writeScope).toEqual([]);
    expect(caps.sandbox.effective).toBe(true);
  });

  it('says "everything" rather than nothing when the sandbox is off', () => {
    // An empty writeScope reads as "writes nowhere" — the exact opposite of
    // the truth, and the most dangerous thing this declaration could get wrong.
    const caps = buildRuntimeCapabilities(input({ sandboxConfig: { mode: 'danger-full-access' } }));
    expect(caps.writeScope).toEqual(['<everything: sandbox disabled>']);
    expect(caps.sandbox.effective).toBe(false);
  });

  it('treats an unconfigured sandbox as the host default', () => {
    expect(buildRuntimeCapabilities(input()).sandbox.mode).toBe('workspace-write');
    expect(
      buildRuntimeCapabilities(input({ sandboxDefaultMode: 'danger-full-access' })).sandbox.mode,
    ).toBe('danger-full-access');
  });

  it('always lists the confirmation-required actions', () => {
    expect(buildRuntimeCapabilities(input()).confirmationRequired).toEqual([
      ...ALWAYS_CONFIRMED_ACTIONS,
    ]);
  });

  it('reports rule counts, not the rules themselves', () => {
    // The rules can contain user paths; a count answers "is anything
    // configured" without handing them to every client that asks.
    const caps = buildRuntimeCapabilities(
      input({ permissions: { allow: ['Read', 'Grep'], deny: ['Bash'] } }),
    );
    expect(caps.permissions.ruleCounts).toEqual({ allow: 2, ask: 0, deny: 1 });
    expect(JSON.stringify(caps)).not.toContain('Grep');
  });

  it('surfaces the contract status, including invalid', () => {
    for (const status of ['absent', 'loaded', 'invalid'] as const) {
      expect(
        buildRuntimeCapabilities(input({ fileContract: status })).permissions.fileContract,
      ).toBe(status);
    }
  });

  it('maps modules to enabled/disabled', () => {
    const caps = buildRuntimeCapabilities(input({ modules: { hooks: true, plugins: false } }));
    expect(caps.modules).toEqual({ hooks: 'enabled', plugins: 'disabled' });
  });

  it('reports no ledger path when the ledger is off', () => {
    expect(buildRuntimeCapabilities(input()).ledger).toEqual({ enabled: false, path: '' });
  });
});
