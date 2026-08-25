import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type {
  WorkspaceDiffFile,
  WorkspaceDiffHunk,
  WorkspaceDiffResult,
  WorkspaceFileStatus,
} from '@deepcode/protocol';
import { gitSpawnEnv } from '@deepcode/core';

const execFileAsync = promisify(execFile);
const MAX_FILES = 100;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_GIT_BUFFER = 32 * 1024 * 1024;

export async function collectWorkspaceDiff(cwd: string): Promise<WorkspaceDiffResult> {
  const workspace = resolve(cwd);
  const status = await git(workspace, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
  ]);
  if (!status.ok) return { repository: false, base: null, files: [], truncated: false };
  const hasHead = (await git(workspace, ['rev-parse', '--verify', 'HEAD'])).ok;
  const entries = parseStatus(status.stdout);
  const selected = entries.slice(0, MAX_FILES);
  let remainingBytes = MAX_PATCH_BYTES;
  let truncated = entries.length > selected.length;
  const files: WorkspaceDiffFile[] = [];

  for (const entry of selected) {
    let patch: string;
    let binary: boolean;
    let fileTruncated = false;
    if (entry.untracked || !hasHead) {
      const captured = await addedFilePatch(workspace, entry.path, remainingBytes);
      patch = captured.patch;
      binary = captured.binary;
      fileTruncated = captured.truncated;
    } else {
      const result = await git(workspace, [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--unified=3',
        'HEAD',
        '--',
        entry.path,
      ]);
      patch = result.ok ? result.stdout : '';
      binary = /(?:Binary files|GIT binary patch)/.test(patch);
      if (Buffer.byteLength(patch) > remainingBytes) {
        patch = truncateUtf8(patch, remainingBytes);
        fileTruncated = true;
      }
    }
    remainingBytes = Math.max(0, remainingBytes - Buffer.byteLength(patch));
    if (remainingBytes === 0) truncated = true;
    const hunks = binary ? [] : parseHunks(patch);
    files.push({
      path: entry.path,
      previousPath: entry.previousPath,
      status: entry.status,
      additions: hunks.reduce(
        (total, hunk) => total + hunk.lines.filter((line) => line.kind === 'addition').length,
        0,
      ),
      deletions: hunks.reduce(
        (total, hunk) => total + hunk.lines.filter((line) => line.kind === 'deletion').length,
        0,
      ),
      binary,
      truncated: fileTruncated,
      hunks,
    });
    if (remainingBytes === 0) break;
  }
  return { repository: true, base: hasHead ? 'HEAD' : 'empty', files, truncated };
}

interface StatusEntry {
  path: string;
  previousPath?: string;
  status: WorkspaceFileStatus;
  untracked: boolean;
}

function parseStatus(raw: string): StatusEntry[] {
  const fields = raw.split('\0');
  const entries: StatusEntry[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (!field || field.length < 4) continue;
    const code = field.slice(0, 2);
    const path = field.slice(3);
    let previousPath: string | undefined;
    if (code.includes('R') || code.includes('C')) previousPath = fields[++index] || undefined;
    entries.push({
      path,
      previousPath,
      status: fileStatus(code),
      untracked: code === '??',
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function fileStatus(code: string): WorkspaceFileStatus {
  if (code === '??' || code.includes('A')) return 'added';
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('R') || code.includes('C')) return 'renamed';
  if (code.includes('D')) return 'deleted';
  return 'modified';
}

async function addedFilePatch(
  cwd: string,
  path: string,
  budget: number,
): Promise<{ patch: string; binary: boolean; truncated: boolean }> {
  const absolute = resolve(cwd, path);
  const relativePath = relative(cwd, absolute);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return { patch: '', binary: true, truncated: true };
  }
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return { patch: '', binary: true, truncated: false };
    }
    const limit = Math.min(MAX_FILE_BYTES, budget);
    const contents = await readFile(absolute);
    if (contents.includes(0)) return { patch: '', binary: true, truncated: false };
    const truncated = contents.length > limit;
    const text = contents.subarray(0, limit).toString('utf8');
    const lines = text.length === 0 ? [] : text.replace(/\n$/, '').split('\n');
    return {
      patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n`,
      binary: false,
      truncated,
    };
  } catch {
    return { patch: '', binary: true, truncated: false };
  }
}

function parseHunks(patch: string): WorkspaceDiffHunk[] {
  const hunks: WorkspaceDiffHunk[] = [];
  let current: WorkspaceDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const rawLine of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = {
        oldStart: oldLine,
        oldLines: Number(header[2] ?? 1),
        newStart: newLine,
        newLines: Number(header[4] ?? 1),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current || rawLine === '\\ No newline at end of file') continue;
    if (rawLine.startsWith('+')) {
      current.lines.push({ kind: 'addition', newLine: newLine++, text: rawLine.slice(1) });
    } else if (rawLine.startsWith('-')) {
      current.lines.push({ kind: 'deletion', oldLine: oldLine++, text: rawLine.slice(1) });
    } else if (rawLine.startsWith(' ')) {
      current.lines.push({
        kind: 'context',
        oldLine: oldLine++,
        newLine: newLine++,
        text: rawLine.slice(1),
      });
    }
  }
  return hunks;
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: MAX_GIT_BUFFER,
      env: { ...gitSpawnEnv(), GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', LC_ALL: 'C' },
    });
    return { ok: true, stdout: result.stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

function truncateUtf8(value: string, bytes: number): string {
  return Buffer.from(value).subarray(0, Math.max(0, bytes)).toString('utf8');
}
