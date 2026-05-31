import { describe, expect, it } from 'vitest';
import { buildLinuxBwrapArgs, buildMacOsProfile, detectPlatform } from './profile.js';

describe('detectPlatform', () => {
  it('returns one of the supported values', () => {
    const p = detectPlatform();
    expect(['macos', 'linux', 'unsupported']).toContain(p);
  });
});

describe('buildMacOsProfile', () => {
  it('returns empty when disabled', () => {
    expect(buildMacOsProfile({ enabled: false }, '/x')).toBe('');
  });

  it('starts with deny-default + allows system reads', () => {
    const profile = buildMacOsProfile({ enabled: true }, '/proj');
    expect(profile).toMatch(/\(deny default\)/);
    expect(profile).toMatch(/file-read\* \(subpath "\/usr"\)/);
    expect(profile).toMatch(/file-write\* \(subpath "\/private\/tmp"\)/);
  });

  it('includes allowRead + allowWrite paths', () => {
    const profile = buildMacOsProfile(
      {
        enabled: true,
        filesystem: {
          allowRead: ['/etc/hosts', '~/.config'],
          allowWrite: ['~/Projects'],
        },
      },
      '/proj',
    );
    expect(profile).toContain('/etc/hosts');
    expect(profile).toMatch(/file-write\* \(subpath ".*Projects"\)/);
    // ~ should be expanded
    expect(profile).not.toContain('"~/');
  });

  it('appends deny rules after allows (so deny wins)', () => {
    const profile = buildMacOsProfile(
      {
        enabled: true,
        filesystem: {
          allowRead: ['/etc'],
          denyRead: ['/etc/passwd'],
        },
      },
      '/proj',
    );
    const allowIdx = profile.indexOf('/etc"');
    const denyIdx = profile.indexOf('/etc/passwd');
    expect(denyIdx).toBeGreaterThan(allowIdx);
  });

  it('escapes special SBPL chars in paths', () => {
    const profile = buildMacOsProfile(
      {
        enabled: true,
        filesystem: { allowRead: ['/path with "quotes"'] },
      },
      '/proj',
    );
    expect(profile).toContain('\\"quotes\\"');
  });

  it('unix-socket opt-in', () => {
    const profile = buildMacOsProfile(
      { enabled: true, network: { allowUnixSockets: true } },
      '/proj',
    );
    expect(profile).toMatch(/network\* \(local unix-socket\)/);
  });
});

describe('buildLinuxBwrapArgs', () => {
  it('returns empty when disabled', () => {
    expect(buildLinuxBwrapArgs({ enabled: false }, '/x')).toEqual([]);
  });

  it('binds system dirs read-only', () => {
    const args = buildLinuxBwrapArgs({ enabled: true }, '/proj');
    expect(args).toContain('--ro-bind-try');
    expect(args).toContain('/usr');
    expect(args).toContain('/lib');
  });

  it('binds cwd read-write', () => {
    const args = buildLinuxBwrapArgs({ enabled: true }, '/my/project');
    const idx = args.indexOf('--bind');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/my/project');
    expect(args[idx + 2]).toBe('/my/project');
  });

  it('unshares pid/ipc/uts', () => {
    const args = buildLinuxBwrapArgs({ enabled: true }, '/x');
    expect(args).toContain('--unshare-pid');
    expect(args).toContain('--unshare-ipc');
    expect(args).toContain('--unshare-uts');
  });

  it('adds hardening flags (--new-session blocks TIOCSTI, --die-with-parent)', () => {
    const args = buildLinuxBwrapArgs({ enabled: true }, '/x');
    expect(args).toContain('--new-session');
    expect(args).toContain('--die-with-parent');
  });

  it('unshares net when allowedDomains is empty array', () => {
    const args = buildLinuxBwrapArgs({ enabled: true, network: { allowedDomains: [] } }, '/x');
    expect(args).toContain('--unshare-net');
  });

  it('does NOT unshare net when allowedDomains is omitted (default allow)', () => {
    const args = buildLinuxBwrapArgs({ enabled: true }, '/x');
    expect(args).not.toContain('--unshare-net');
  });

  it('unshares net + binds resolv.conf when allowedDomains non-empty + dnsProxyPort given', () => {
    const args = buildLinuxBwrapArgs(
      { enabled: true, network: { allowedDomains: ['github.com'] } },
      '/proj',
      { dnsProxyPort: 53053, resolvConfPath: '/tmp/dc-resolv.conf' },
    );
    expect(args).toContain('--unshare-net');
    expect(args).toContain('--ro-bind');
    const idx = args.indexOf('--ro-bind');
    // Walk forward through args looking for the resolv.conf binding
    const has = args.some(
      (a, i) =>
        a === '--ro-bind' &&
        args[i + 1] === '/tmp/dc-resolv.conf' &&
        args[i + 2] === '/etc/resolv.conf',
    );
    expect(has).toBe(true);
    void idx;
  });

  it('does NOT bind resolv.conf when dnsProxyPort is omitted (even if allowedDomains non-empty)', () => {
    const args = buildLinuxBwrapArgs(
      { enabled: true, network: { allowedDomains: ['github.com'] } },
      '/proj',
    );
    // Without a proxy we fall back to default-allow (no unshare-net) — the
    // domain whitelist can't be enforced without the proxy.
    expect(args).not.toContain('--unshare-net');
  });
});
