#!/usr/bin/env node

import { copyFile, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { createInterface } from 'node:readline';

const probeSource = String.raw`
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  const result = request.method === 'initialize'
    ? {
        protocolVersion: 1,
        capabilities: {
          threadResume: true,
          turnInterrupt: true,
          completedItemPersistence: true,
          transientDeltas: true,
        },
        runtime: { execPath: process.execPath, path: process.env.PATH ?? null },
      }
    : undefined;
  process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
  lines.close();
});
`;

async function runProbe(runtimePath, serverPath) {
  const startedAt = performance.now();
  const child = spawn(runtimePath, [serverPath], {
    env: { PATH: '' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const response = new Promise((resolve, reject) => {
    output.once('line', (line) => {
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
  });
  child.stdin.end('{"id":1,"method":"initialize","params":{}}\n');
  const result = await Promise.race([
    response,
    exited.then(({ code, signal }) => {
      throw new Error(`sidecar probe exited before responding (code=${code}, signal=${signal})`);
    }),
  ]);
  const { code, signal } = await exited;
  if (code !== 0) throw new Error(`sidecar probe exited with code=${code}, signal=${signal}`);
  return { result, handshakeMilliseconds: performance.now() - startedAt };
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'deepcode-sidecar-'));
const runtimePath = join(temporaryRoot, 'deepcode-runtime');
const serverPath = join(temporaryRoot, 'app-server.cjs');

try {
  await copyFile(process.execPath, runtimePath);
  await writeFile(serverPath, probeSource);
  const sourceRuntimeBytes = (await stat(runtimePath)).size;
  let thinned = false;
  if (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) {
    const thinPath = `${runtimePath}.thin`;
    const architecture = process.arch === 'x64' ? 'x86_64' : process.arch;
    const thin = spawnSync('/usr/bin/lipo', [
      runtimePath,
      '-thin',
      architecture,
      '-output',
      thinPath,
    ]);
    if (thin.status === 0) {
      await rename(thinPath, runtimePath);
      thinned = true;
    }
  }
  const targetRuntimeBytes = (await stat(runtimePath)).size;
  const strip =
    process.platform === 'darwin' ? spawnSync('/usr/bin/strip', ['-S', runtimePath]) : null;
  const stripped = strip?.status === 0;
  const sign =
    process.platform === 'darwin'
      ? spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', runtimePath])
      : null;
  const signed = sign?.status === 0;
  const afterStrip = (await stat(runtimePath)).size;
  const { result: response, handshakeMilliseconds } = await runProbe(runtimePath, serverPath);
  if (response?.result?.protocolVersion !== 1 || response?.result?.runtime?.path !== '') {
    throw new Error('sidecar did not complete an isolated protocol handshake');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'ok',
        platform: `${process.platform}-${process.arch}`,
        sourceRuntimeBytes,
        targetRuntimeBytes,
        runtimeBytesAfterStrip: afterStrip,
        thinned,
        stripped,
        signed,
        protocolVersion: response.result.protocolVersion,
        handshakeMilliseconds: Math.round(handshakeMilliseconds * 100) / 100,
        childExecPath: response.result.runtime.execPath,
        childPath: response.result.runtime.path,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
