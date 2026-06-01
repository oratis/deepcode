// Pure unit tests for the network-sandbox decision helpers. The end-to-end
// orchestration (spawnNetworkSandbox) is exercised by netns-integration.test.ts
// on the Linux CI runner; here we just cover the branch logic that decides
// WHEN to use it and the fail-closed config derivation.

import { describe, expect, it } from 'vitest';
import type { SandboxConfig } from '../config/types.js';
import { denyAllNetwork, needsNetworkSandbox } from './netns.js';

describe('needsNetworkSandbox', () => {
  const cfg = (network?: SandboxConfig['network'], enabled = true): SandboxConfig => ({
    enabled,
    network,
  });

  it('is true for a non-empty allowlist on Linux', () => {
    expect(needsNetworkSandbox(cfg({ allowedDomains: ['github.com'] }), 'linux')).toBe(true);
  });

  it('is false for an empty allowlist (deny-all-net, handled by --unshare-net)', () => {
    expect(needsNetworkSandbox(cfg({ allowedDomains: [] }), 'linux')).toBe(false);
  });

  it('is false when allowedDomains is undefined (full network)', () => {
    expect(needsNetworkSandbox(cfg({}), 'linux')).toBe(false);
    expect(needsNetworkSandbox(cfg(undefined), 'linux')).toBe(false);
  });

  it('is false on non-Linux platforms (macOS uses sandbox-exec)', () => {
    expect(needsNetworkSandbox(cfg({ allowedDomains: ['github.com'] }), 'darwin')).toBe(false);
    expect(needsNetworkSandbox(cfg({ allowedDomains: ['github.com'] }), 'win32')).toBe(false);
  });

  it('is false when the sandbox is disabled', () => {
    expect(needsNetworkSandbox(cfg({ allowedDomains: ['github.com'] }, false), 'linux')).toBe(
      false,
    );
  });

  it('is false for an undefined config', () => {
    expect(needsNetworkSandbox(undefined, 'linux')).toBe(false);
  });
});

describe('denyAllNetwork', () => {
  it('forces allowedDomains to [] (no network)', () => {
    const out = denyAllNetwork({ enabled: true, network: { allowedDomains: ['github.com'] } });
    expect(out.network?.allowedDomains).toEqual([]);
  });

  it('preserves other config + network fields', () => {
    const out = denyAllNetwork({
      enabled: true,
      excludedCommands: ['git'],
      network: { allowedDomains: ['a.com'], allowUnixSockets: true },
    });
    expect(out.enabled).toBe(true);
    expect(out.excludedCommands).toEqual(['git']);
    expect(out.network?.allowUnixSockets).toBe(true);
    expect(out.network?.allowedDomains).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input: SandboxConfig = { enabled: true, network: { allowedDomains: ['a.com'] } };
    denyAllNetwork(input);
    expect(input.network?.allowedDomains).toEqual(['a.com']);
  });
});
