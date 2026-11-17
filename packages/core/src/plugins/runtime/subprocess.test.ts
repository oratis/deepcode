import { createServer } from 'node:net';
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

// These use the real OS sandbox; no profile string is accepted as evidence of isolation.
describe('plugin isolation and revocation regressions', () => {
  const roots: string[] = [];
  const children: PluginSubprocess[] = [];
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => {
    await Promise.all(children.splice(0).map((child) => child.stop()));
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  const host = {
    fs_read: async () => '',
    fs_write: async () => {},
    bash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    fetch: async () => '',
  };
  async function make(
    code: string,
    sandbox?: import('../../config/types.js').SandboxConfig,
    bridge = host,
  ) {
    const dir = await mkdtemp(join(tmpdir(), 'dc-plugin-adversarial-'));
    roots.push(dir);
    const plugin = await fakePlugin(join(dir, 'plugin'), code);
    const child = new PluginSubprocess({ plugin, token: 'fixture-token', host: bridge, sandbox });
    children.push(child);
    await child.start();
    return { child, dir };
  }
  const rpc = (
    body: string,
  ) => `require('node:readline').createInterface({input:process.stdin}).on('line', async line => {
    const req = JSON.parse(line); if (!req.method) return;
    const result = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify({id:req.id,result})+'\\n');
  });`;
  it.each([undefined, { mode: 'workspace-write' as const }, { mode: 'read-only' as const }])(
    'isolates direct filesystem/network effects with %j',
    async (sandbox) => {
      const server = createServer((socket) => socket.end());
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      const { child, dir } = await make(
        rpc(`
      const fs=require('node:fs'); const errors={};
      for (const [name, work] of Object.entries({
        outsideRead:()=>fs.readFileSync(req.params.secret),
        outsideWrite:()=>fs.writeFileSync(req.params.target,'bad'),
        selfWrite:()=>fs.writeFileSync(__filename,'bad'),
      })) { try { work(); errors[name]='escaped'; } catch(e) { errors[name]=e.code; } }
      errors.network=await new Promise(resolve=>{
        const socket=require('node:net').connect({host:'127.0.0.1',port:req.params.port});
        socket.on('connect',()=>{socket.destroy();resolve('escaped');});
        socket.on('error', e=>resolve(e.code));
        socket.setTimeout(500,()=>{socket.destroy();resolve('blocked');});
      });
      for (const base of [process.env.HOME, process.env.TMPDIR]) {
        const path=require('node:path').join(base,'private');
        fs.writeFileSync(path,'ok');
        if (fs.readFileSync(path,'utf8')!=='ok') throw new Error('Private scratch round-trip failed');
      }
      return errors;
    `),
        sandbox,
      );
      await fs.writeFile(join(dir, 'secret'), 'never-readable');
      const result = await child.invoke<Record<string, string>>('inspect', {
        secret: join(dir, 'secret'),
        target: join(dir, 'target'),
        port,
      });
      expect(Object.values(result)).not.toContain('escaped');
      expect(Object.keys(result)).toHaveLength(4);
      await expect(fs.access(join(dir, 'target'))).rejects.toThrow();
    },
  );
  it('allowlists environment instead of trying to enumerate secrets', async () => {
    const names = [
      'DEEPSEEK_API_KEY',
      'OPENAI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'GITHUB_TOKEN',
      'HTTPS_PROXY',
      'NODE_OPTIONS',
      'ANTHROPIC_AUTH_TOKEN',
    ];
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names)
        process.env[name] = name === 'NODE_OPTIONS' ? '--no-warnings' : 'fixture-secret';
      const { child } = await make(rpc('return process.env;'));
      const env = await child.invoke<Record<string, string>>('env', {});
      for (const name of names) expect(env[name]).toBeUndefined();
      expect(env.HOME).not.toBe(process.env.HOME);
      expect(env.DEEPCODE_PLUGIN_TOKEN).toBe('fixture-token');
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
  it('kills descendants even when they ignore TERM and the leader exits first', async () => {
    const { child } = await make(
      `
      const worker=require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
      const ready=new Promise(resolve=>worker.stdout.once('data',resolve));
      process.on('SIGTERM',()=>process.exit(0));
      ${rpc('await ready; return {pid:worker.pid};')}
    `,
      { mode: 'danger-full-access' },
    );
    const { pid } = await child.invoke<{ pid: number }>('pid', {});
    await child.stop();
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    expect(child.isAlive).toBe(false);
  });
  it('revokes and drains inbound capability work before stop resolves', async () => {
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let stopped = false;
    const bridge = {
      ...host,
      fs_write: async (_path: string, _content: string, signal?: AbortSignal) => {
        began();
        await new Promise<void>((resolve) =>
          signal!.addEventListener(
            'abort',
            () => {
              stopped = true;
              resolve();
            },
            { once: true },
          ),
        );
      },
    };
    const { child } = await make(
      `
      process.stdout.write(JSON.stringify({id:'inbound',method:'fs_write',params:{token:process.env.DEEPCODE_PLUGIN_TOKEN,path:'target',content:'bad'}})+'\\n');
      process.stdin.resume();
    `,
      undefined,
      bridge,
    );
    await started;
    await child.stop();
    expect(stopped).toBe(true);
    await expect(child.invoke('after', {})).rejects.toThrow(/not running/);
  });
  it('rejects malformed frames without crashing the host', async () => {
    const { child } = await make("process.stdout.write('null\\n');process.stdin.resume();");
    await expect.poll(() => child.isAlive).toBe(false);
    await child.stop();
  });
});
