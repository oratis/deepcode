import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const read = (path) => readFileSync(resolve(root, path), 'utf8');

const required = [
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/CODEX_ALIGNMENT_PLAN.md',
  'docs/quickstart.md',
  'docs/security-model.md',
  'docs/RELEASING.md',
  'docs/design/release-gates-v1.md',
];

for (const path of required) {
  if (!existsSync(resolve(root, path))) failures.push(`missing required document: ${path}`);
}

const currentDocs = [
  'README.md',
  'CONTRIBUTING.md',
  'packages/core/README.md',
  'docs/quickstart.md',
  'docs/security-model.md',
  'docs/RELEASING.md',
  'docs/design/release-gates-v1.md',
];
const staleCount = /(?:tests[- ]|测试[:：]?\s*|测试\s+)[0-9]{2,}\s*(?:passing|passed|个测试通过)?/i;
for (const path of currentDocs) {
  const body = read(path);
  if (staleCount.test(body)) failures.push(`${path}: hard-codes a test count; link to CI instead`);
}

for (const path of currentDocs) {
  if (/Electron Mac client|Electron \+ React|electron-builder/.test(read(path))) {
    failures.push(`${path}: documents the retired Electron desktop stack`);
  }
}

const historical = [
  'MORNING_REPORT.md',
  'docs/HANDOFF.md',
  'docs/BEHAVIOR_PARITY.md',
  'docs/DEVELOPMENT_PLAN.md',
];
for (const path of historical) {
  const firstLines = read(path).split('\n').slice(0, 12).join('\n');
  if (!firstLines.includes('历史快照')) {
    failures.push(`${path}: legacy status document must be marked as 历史快照 near the top`);
  }
}

const rootTsconfig = JSON.parse(read('tsconfig.json'));
const refs = new Set((rootTsconfig.references ?? []).map((entry) => entry.path));
for (const path of [
  './packages/core',
  './packages/shared-ui',
  './apps/cli',
  './apps/desktop',
  './apps/lsp',
  './apps/vscode',
]) {
  if (!refs.has(path)) failures.push(`tsconfig.json: missing workspace reference ${path}`);
}

if (!read('CONTRIBUTING.md').includes('Node.js ≥ 22')) {
  failures.push('CONTRIBUTING.md: Node requirement must match package.json (>=22)');
}

const packageJson = JSON.parse(read('package.json'));
if (!packageJson.scripts?.['release:check']) {
  failures.push('package.json: missing release:check entrypoint');
}
for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  if (!read(workflow).includes('pnpm release:check')) {
    failures.push(`${workflow}: must enforce pnpm release:check`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Documentation consistency checks passed.\n');
}
