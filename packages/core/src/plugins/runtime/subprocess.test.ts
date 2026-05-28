import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledPlugin } from '../manifest.js';
import { generatePluginToken, PluginSubprocess } from './subprocess.js';

async function fakePlugin(dir: string, indexJs: string): Promise<InstalledPlugin> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({ name: 'p', version: '0.0.1' }),
    'utf8',
  );
  await fs.writeFile(join(dir, 'index.js'), indexJs, 'utf8');
  return {
    manifest: { name: 'p', version: '0.0.1' },
    path: dir,
    sourceHash: 'h',
    enabled: true,
  };
}

describe('PluginSubprocess', () => {
  let pluginDir: string;
  beforeEach(async () => {
    pluginDir = await mkdtemp(join(tmpdir(), 'dc-plug-sub-'));
  });
  afterEach(async () => {
    await rm(pluginDir, { recursive: true, force: true });
  });

  it('starts a subprocess and stops it cleanly', async () => {
    const plugin = await fakePlugin(
      pluginDir,
      `// minimal: read stdin, never send anything
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', () => {});
`,
    );
    const sub = new PluginSubprocess({
      plugin,
      token: 't',
      host: {
        fs_read: async () => '',
        fs_write: async () => {},
        bash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        fetch: async () => '',
      },
    });
    await sub.start();
    await sub.stop();
  }, 10000);

  it('plugin can request fs_read via RPC and receives result', async () => {
    const plugin = await fakePlugin(
      pluginDir,
      `// plugin: ask host to fs_read('/etc/hostname'), then exit
const TOKEN = process.env.DEEPCODE_PLUGIN_TOKEN;
process.stdout.write(JSON.stringify({
  id: 'r1',
  method: 'fs_read',
  params: { token: TOKEN, path: '/etc/hostname' }
}) + '\\n');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c.toString();
  let nl = buf.indexOf('\\n');
  if (nl !== -1) {
    const line = buf.slice(0, nl);
    const msg = JSON.parse(line);
    if (msg.id === 'r1') {
      // Echo back so the host can see the result via stderr (for testability)
      process.stderr.write('plugin received: ' + JSON.stringify(msg.result) + '\\n');
      process.exit(0);
    }
  }
});
`,
    );
    let fsReadCalled = false;
    const sub = new PluginSubprocess({
      plugin,
      token: 't-secret',
      host: {
        fs_read: async (path: string) => {
          fsReadCalled = true;
          expect(path).toBe('/etc/hostname');
          return 'fake-hostname';
        },
        fs_write: async () => {},
        bash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        fetch: async () => '',
      },
    });
    await sub.start();
    // Wait briefly for plugin to exchange + exit
    await new Promise((r) => setTimeout(r, 500));
    await sub.stop();
    expect(fsReadCalled).toBe(true);
  }, 10000);

  it('rejects RPC with wrong token', async () => {
    // Plugin tries fs_read without supplying the correct token in params
    const plugin = await fakePlugin(
      pluginDir,
      `process.stdout.write(JSON.stringify({
  id: 'r1',
  method: 'fs_read',
  params: { token: 'WRONG-TOKEN', path: '/x' }
}) + '\\n');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c.toString();
  const nl = buf.indexOf('\\n');
  if (nl !== -1) {
    const msg = JSON.parse(buf.slice(0, nl));
    process.stderr.write('reply: ' + JSON.stringify(msg) + '\\n');
    process.exit(0);
  }
});
`,
    );
    let fsReadCalled = false;
    const sub = new PluginSubprocess({
      plugin,
      token: 'real-token',
      host: {
        fs_read: async () => {
          fsReadCalled = true;
          return 'should not happen';
        },
        fs_write: async () => {},
        bash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        fetch: async () => '',
      },
    });
    await sub.start();
    await new Promise((r) => setTimeout(r, 500));
    await sub.stop();
    expect(fsReadCalled).toBe(false);
  }, 10000);

  it('generatePluginToken returns unique values', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generatePluginToken()));
    expect(tokens.size).toBe(50);
  });

  it('strips DeepSeek API key env vars in child process', async () => {
    const plugin = await fakePlugin(
      pluginDir,
      `// Print whether DEEPSEEK_API_KEY env var leaked
const leaked = process.env.DEEPSEEK_API_KEY || '';
process.stderr.write('LEAKED=[' + leaked + ']');
process.exit(0);
`,
    );
    process.env.DEEPSEEK_API_KEY = 'sk-test-secret';
    const stderrChunks: string[] = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Buffer): boolean => {
      stderrChunks.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      const sub = new PluginSubprocess({
        plugin,
        token: 't',
        host: {
          fs_read: async () => '',
          fs_write: async () => {},
          bash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
          fetch: async () => '',
        },
      });
      await sub.start();
      await new Promise((r) => setTimeout(r, 500));
      await sub.stop();
    } finally {
      process.stderr.write = origStderrWrite;
      delete process.env.DEEPSEEK_API_KEY;
    }
    const combined = stderrChunks.join('');
    // Key should NOT have made it through
    expect(combined).toContain('LEAKED=[]');
    expect(combined).not.toContain('sk-test-secret');
  }, 10000);
});
