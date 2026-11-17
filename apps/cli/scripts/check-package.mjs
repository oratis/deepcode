import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(cliRoot, 'dist/npm/package-report.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'deepcode-npm-check-'));
const home = join(temporary, 'home');
const workspace = join(temporary, 'workspace');
const install = join(temporary, 'install');
const environment = { HOME: home, PATH: '', DEEPCODE_HOME: join(home, '.deepcode') };
try {
  await Promise.all([home, workspace, install].map((path) => mkdir(path)));
  await writeFile(join(install, 'package.json'), '{"private":true}\n');
  await writeFile(join(temporary, 'npmrc'), '');
  // The install deliberately has neither workspace links nor registry access.
  // Optional SDK availability is a separate path, exercised below.
  execFileSync(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--omit=optional',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--userconfig',
      join(temporary, 'npmrc'),
      '--cache',
      join(temporary, 'cache'),
      report.tarball,
    ],
    {
      cwd: install,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const packageRoot = join(install, 'node_modules/@oratis/deepcode');
  const bin = join(install, 'node_modules/.bin/deepcode');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, report.version);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.optionalDependencies['@anthropic-ai/claude-agent-sdk'], '0.3.310');
  const notices = await readFile(join(packageRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const dependency of [
    '@deepseek-ai/cordis@4.1.0',
    '@deepseek-ai/cosmokit@1.9.0',
    '@modelcontextprotocol/sdk@',
    'openai@',
  ])
    assert(notices.includes(dependency), `Missing ${dependency} notice`);
  assert(notices.includes('Permission is hereby granted'));
  const schema = JSON.parse(
    await readFile(join(packageRoot, 'schemas/settings.schema.json'), 'utf8'),
  );
  assert.equal(schema.type, 'object');
  const run = (args, extraEnv = {}) =>
    execFileSync(process.execPath, [bin, ...args], {
      cwd: workspace,
      env: { ...environment, ...extraEnv },
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  assert.equal(run(['--version']).trim(), report.version);
  assert.equal(
    execFileSync(bin, ['--version'], {
      cwd: workspace,
      env: { ...environment, PATH: dirname(process.execPath) },
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
    report.version,
  );
  assert.match(run(['--help']), /app-server/);
  const skills = JSON.parse(run(['skills', 'list', '--json']));
  const expected = (await readdir(join(packageRoot, 'skills'))).sort();
  assert.deepEqual(
    skills
      .filter((skill) => skill.source === 'builtin')
      .map((skill) => skill.name)
      .sort(),
    expected,
  );
  assert.match(run(['profile', 'inspect', '--profile', 'headless']), /headless/);

  let threadId;
  await journey(bin, async (request) => {
    const init = await request('initialize');
    assert.equal(init.protocolVersion, 1);
    assert.equal(init.capabilities.sessionJournal, true);
    threadId = (await request('thread/start', { cwd: workspace })).id;
    assert.equal((await request('thread/read', { threadId })).id, threadId);
    await request('thread/rename', { threadId, title: 'Installed CLI smoke' });
    await request('runtime/capabilities', { cwd: workspace });
    const diagnostics = await request('config/diagnostics', { cwd: workspace });
    assert(['trusted', 'untrusted', 'plan-only'].includes(diagnostics.trustStatus));
    assert.deepEqual(
      await request('session/snapshots', { threadId, path: join(workspace, 'file.txt') }),
      [],
    );
    const deleted = await request('thread/fork', { threadId });
    await request('thread/delete', { threadId: deleted.id });
    const archived = await request('thread/fork', { threadId });
    await request('thread/archive', { threadId: archived.id });
    assert.equal((await request('thread/list')).threads.length, 1);
  });
  await journey(bin, async (request) => {
    await request('initialize');
    const thread = await request('thread/resume', { threadId });
    assert.equal(thread.id, threadId);
    assert.equal(thread.title, 'Installed CLI smoke');
  });

  const settings = join(temporary, 'sdk-settings.json');
  await writeFile(settings, JSON.stringify({ engine: 'claude-sdk' }));
  const sdkArgs = [
    '-p',
    'packaging probe',
    '--settings',
    settings,
    '--model',
    'kimi-k2.5',
    '--mode',
    'plan',
  ];
  const sdkEnvironment = { MOONSHOT_API_KEY: 'local-packaging-fixture' };
  assert.throws(
    () => run(sdkArgs, sdkEnvironment),
    (error) => {
      assert.match(error.stderr, /Claude SDK optional runtime is unavailable/);
      return true;
    },
  );
  // Resolve the optional SDK next to the installed CLI, not back in the checkout.
  // This fake module produces no tools, subprocesses, credentials or requests.
  const fixture = join(packageRoot, 'node_modules/@anthropic-ai/claude-agent-sdk');
  await mkdir(fixture, { recursive: true });
  await writeFile(
    join(fixture, 'package.json'),
    JSON.stringify({
      name: '@anthropic-ai/claude-agent-sdk',
      version: '0.3.310',
      type: 'module',
      exports: './index.js',
    }),
  );
  await writeFile(
    join(fixture, 'index.js'),
    `
export function createSdkMcpServer() { return { instance: { server: { setRequestHandler() {} }, async close() {} } }; }
export function query() {
  const stream = (async function* () {
    yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'installed-sdk-fixture-ok' } } };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'installed-sdk-fixture-ok' }] } };
    yield { type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } };
  })();
  stream.close = () => {};
  return stream;
}
`,
  );
  assert.match(run(sdkArgs, sdkEnvironment), /installed-sdk-fixture-ok/);
  report.validation = {
    status: 'passed',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    checks: [
      'isolated offline tarball install',
      'version/help',
      'all builtin skills',
      'schema asset/profile',
      'stdio session lifecycle',
      'restart durability',
      'optional SDK absent/present',
    ],
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function journey(bin, body) {
  const child = spawn(process.execPath, [bin, 'app-server'], {
    cwd: workspace,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const reader = createInterface({ input: child.stdout });
  const pending = new Map();
  let sequence = 0;
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve, reject) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', reject);
  });
  reader.on('line', (line) => {
    try {
      const response = JSON.parse(line);
      if (response.id === null && response.error) throw new Error(JSON.stringify(response.error));
      const waiter = pending.get(response.id);
      if (waiter) {
        pending.delete(response.id);
        if (response.error) waiter.reject(new Error(JSON.stringify(response.error)));
        else waiter.resolve(response.result);
      }
    } catch (error) {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    }
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, 5_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  try {
    await body(request);
    child.stdin.end();
    assert.equal(
      await Promise.race([
        exit,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('app-server shutdown timeout')), 5_000);
          timer.unref();
        }),
      ]),
      0,
      stderr,
    );
  } finally {
    child.kill('SIGKILL');
    reader.close();
    for (const waiter of pending.values()) waiter.reject(new Error('app-server closed'));
  }
}
