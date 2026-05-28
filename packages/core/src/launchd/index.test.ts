import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPlist,
  installPlist,
  LAUNCHD_LABEL,
  launchdPlistPath,
  uninstallPlist,
} from './index.js';

describe('buildPlist', () => {
  it('embeds the label, binPath, and interval', () => {
    const xml = buildPlist({
      binPath: '/usr/local/bin/deepcode',
      intervalSec: 30,
      home: '/Users/x',
    });
    expect(xml).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(xml).toContain('<string>/usr/local/bin/deepcode</string>');
    expect(xml).toContain('<integer>30</integer>');
  });

  it('escapes XML special chars in paths', () => {
    const xml = buildPlist({
      binPath: '/path & dir/deepcode<bin>',
      home: '/Users/x',
    });
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;bin&gt;');
  });

  it('splits subcommand into separate ProgramArguments', () => {
    const xml = buildPlist({
      binPath: '/usr/local/bin/deepcode',
      subcommand: 'scheduler run',
      home: '/Users/x',
    });
    expect(xml).toContain('<string>scheduler</string>');
    expect(xml).toContain('<string>run</string>');
  });
});

describe('installPlist / uninstallPlist', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-ld-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('writes the plist to ~/Library/LaunchAgents/', async () => {
    const path = await installPlist({ binPath: '/usr/local/bin/deepcode', home });
    expect(path).toBe(launchdPlistPath(home));
    const xml = await fs.readFile(path, 'utf8');
    expect(xml).toContain(LAUNCHD_LABEL);
  });

  it('uninstall removes the file and reports true; second call returns false', async () => {
    await installPlist({ binPath: '/usr/local/bin/deepcode', home });
    expect(await uninstallPlist(home)).toBe(true);
    expect(await uninstallPlist(home)).toBe(false);
  });
});
