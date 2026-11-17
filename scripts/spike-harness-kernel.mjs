#!/usr/bin/env node
// Current-runtime packaging smoke plus an incremental standalone kernel fixture comparison.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire, isBuiltin } from 'node:module';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireServer = createRequire(join(root, 'apps/server/package.json'));
const requireVscode = createRequire(join(root, 'apps/vscode/package.json'));
const requireKernel = createRequire(join(root, 'packages/kernel/package.json'));
const { build } = requireServer('esbuild');
const work = await mkdtemp(join(tmpdir(), 'deepcode-h02-'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const schema = await readFile(join(root, 'packages/core/schemas/settings.schema.json'), 'utf8');
const notices = await readFile(join(root, 'packages/kernel/THIRD_PARTY_NOTICES.md'), 'utf8');
const kernelPath = join(root, 'packages/kernel/src/index.ts');
const runPath = join(root, 'apps/server/src/run.ts');
const report = {
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  status: 'failed',
  comparison: {
    baseline: 'current app-server (already includes Cordis)',
    candidate: 'current app-server plus an independent kernel fixture',
    scope: 'incremental fixture only; not the cost of introducing Cordis',
  },
};
const graph = `[{id:'fixture',provides:['fixture'],apply(ctx){ctx.provide('fixture',42);ctx.effect(()=>()=>{});}},
{id:'consumer',requires:['fixture'],apply(ctx){if(ctx.get('fixture')!==42)throw Error('injection');}}]`;
const options = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  external: ['@anthropic-ai/claude-agent-sdk'],
  legalComments: 'none',
  metafile: true,
  define: { __DEEPCODE_SETTINGS_SCHEMA__: JSON.stringify(schema), 'import.meta.url': 'undefined' },
};
async function bundle(candidate, desktop = false) {
  const filename = join(
    work,
    `${candidate ? 'candidate' : 'baseline'}${desktop ? '-desktop' : ''}.cjs`,
  );
  const source = `import {runAppServer} from ${JSON.stringify(runPath)};
${candidate ? `import {createKernel} from ${JSON.stringify(kernelPath)};` : ''}
(async()=>{${candidate ? `const kernel=await createKernel(${graph});` : ''}
process.stderr.write('H02_RSS='+process.memoryUsage().rss+'\\n');
try{await runAppServer({input:process.stdin,output:process.stdout,home:process.env.DEEPCODE_HOME,forceFileCredentials:${desktop}});}
finally{${candidate ? 'await kernel.close();' : ''}}})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const result = await build({
    ...options,
    banner: candidate ? { js: `/* ${notices.replaceAll('*/', '* /')} */` } : undefined,
    stdin: { contents: source, resolveDir: root, sourcefile: 'h02-prototype.ts' },
    outfile: filename,
  });
  const external = Object.values(result.metafile.outputs)
    .flatMap((out) => out.imports)
    .filter((entry) => entry.external);
  assert(
    external.every(
      (entry) => isBuiltin(entry.path) || entry.path === '@anthropic-ai/claude-agent-sdk',
    ),
    `Unexpected external runtime dependency: ${external.map((entry) => entry.path).join(', ')}`,
  );
  return { filename, bytes: (await stat(filename)).size };
}
async function probe(runtime, filename, n) {
  const home = join(work, `home-${n}`);
  await mkdir(home);
  const start = performance.now();
  const child = spawn(runtime, [filename], {
    cwd: work,
    env: { PATH: '', HOME: home, DEEPCODE_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout });
  let timeout;
  try {
    const exited = new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code));
    });
    const result = new Promise((resolveResult, reject) => {
      lines.once('line', (line) => {
        try {
          resolveResult({ response: JSON.parse(line), ms: performance.now() - start });
        } catch (error) {
          reject(error);
        }
      });
    });
    child.stdin.end('{"id":1,"method":"initialize","params":{}}\n');
    const response = await Promise.race([
      result,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('initialize exceeded 5s')), 5000);
      }),
    ]);
    assert(response.response.result?.protocolVersion === 1, 'Invalid protocol handshake');
    const code = await Promise.race([
      exited,
      new Promise((_, reject) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => reject(new Error('Shutdown exceeded 5s')), 5000);
      }),
    ]);
    assert(code === 0, `Probe failed: ${stderr}`);
    const rss = Number(/H02_RSS=(\d+)/.exec(stderr)?.[1]);
    assert(rss > 0, 'Missing memory sample');
    return { initializeMs: response.ms, rssBytes: rss };
  } finally {
    clearTimeout(timeout);
    child.kill('SIGKILL');
    lines.close();
  }
}
async function packageVsix(stage, server, name) {
  await copyFile(server, join(stage, 'dist/app-server.cjs'));
  const path = join(work, `${name}.vsix`);
  const cli = requireVscode.resolve('@vscode/vsce/vsce');
  execFileSync(process.execPath, [cli, 'package', '--no-dependencies', '--out', path], {
    cwd: stage,
    stdio: 'pipe',
    env: { ...process.env, SOURCE_DATE_EPOCH: '1794873600' },
  });
  return (await stat(path)).size;
}
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
try {
  assert(process.versions.node.split('.')[0] === '22', 'Run this spike with Node 22');
  report.cordis = requireKernel('@deepseek-ai/cordis/package.json').version;
  assert(report.cordis === '4.1.0', 'Unexpected Cordis version');
  // H03 integrated Cordis into runAppServer's dependency graph. Both bundles now
  // contain it; only the candidate activates an additional, independent fixture.
  const baseline = await bundle(false);
  const candidate = await bundle(true);
  const desktop = await bundle(true, true);
  const runtime = join(work, 'deepcode-runtime');
  await copyFile(process.execPath, runtime);
  if (process.platform === 'darwin')
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', runtime], { stdio: 'pipe' });
  const samples = { baseline: [], candidate: [] };
  // Interleave to reduce cache / machine-load bias. Each sample is a fresh process and home.
  for (let n = 0; n < 11; n++) {
    const order = n % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const kind of order)
      samples[kind].push(
        await probe(
          runtime,
          kind === 'candidate' ? candidate.filename : baseline.filename,
          `${kind}-${n}`,
        ),
      );
  }
  report.desktop = await probe(runtime, desktop.filename, 'desktop');
  report.samples = samples;
  report.medians = Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [
      key,
      {
        initializeMs: median(values.map((value) => value.initializeMs)),
        rssBytes: median(values.map((value) => value.rssBytes)),
      },
    ]),
  );
  // Browser graph probe has no Node globals and no external dependencies.
  const browserFile = join(work, 'kernel-browser.js');
  await build({
    stdin: {
      contents: `import {createKernel} from ${JSON.stringify(kernelPath)};globalThis.h02=(async()=>{const k=await createKernel(${graph});await k.close();return true;})();`,
      resolveDir: root,
    },
    outfile: browserFile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  });
  const browserContext = vm.createContext({ console });
  vm.runInContext(await readFile(browserFile, 'utf8'), browserContext);
  assert(await browserContext.h02, 'Browser Context/Fiber lifecycle failed');
  report.browserBytes = (await stat(browserFile)).size;
  const stage = join(work, 'extension');
  await mkdir(join(stage, 'dist'), { recursive: true });
  for (const file of ['README.md', 'LICENSE', 'media'])
    await cp(join(root, 'apps/vscode', file), join(stage, file), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'apps/vscode/package.json'), 'utf8'));
  delete manifest.scripts;
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
  const extensionPath = join(root, 'apps/vscode/dist/extension.cjs');
  await copyFile(extensionPath, join(stage, 'dist/extension.cjs'));
  const vsixBaseline = await packageVsix(stage, baseline.filename, 'baseline');
  await writeFile(join(stage, 'THIRD_PARTY_NOTICES.md'), notices);
  const vsixCandidate = await packageVsix(stage, candidate.filename, 'candidate');
  report.bytes = {
    extension: (await stat(extensionPath)).size,
    baselineServer: baseline.bytes,
    candidateServer: candidate.bytes,
    desktopServer: desktop.bytes,
    baselineVsix: vsixBaseline,
    candidateVsix: vsixCandidate,
  };
  report.incrementalFixtureOverhead = {
    server: candidate.bytes / baseline.bytes - 1,
    vsix: vsixCandidate / vsixBaseline - 1,
    initialize: report.medians.candidate.initializeMs / report.medians.baseline.initializeMs - 1,
    rss: report.medians.candidate.rssBytes / report.medians.baseline.rssBytes - 1,
  };
  assert(
    report.bytes.extension <= 64 * 1024 &&
      candidate.bytes <= 768 * 1024 &&
      vsixCandidate <= 256 * 1024,
    'Existing package budget exceeded',
  );
  assert(
    Object.values(report.incrementalFixtureOverhead).every((value) => value <= 0.15),
    'Incremental kernel fixture overhead exceeded 15% of the current runtime',
  );
  report.status = 'ok';
} finally {
  // Output is reproducible evidence, kept outside source by default.
  const output = process.argv[2];
  if (output) await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  await rm(work, { recursive: true, force: true });
}
