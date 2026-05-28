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

  it('unshares net when allowedDomains is empty array', () => {
    const args = buildLinuxBwrapArgs({ enabled: true, network: { allowedDomains: [] } }, '/x');
    expect(args).toContain('--unshare-net');
  });

  it('does NOT unshare net when allowedDomains is omitted (default allow)', () => {
    const args = buildLinuxBwrapArgs({ enabled: true }, '/x');
    expect(args).not.toContain('--unshare-net');
  });
});
