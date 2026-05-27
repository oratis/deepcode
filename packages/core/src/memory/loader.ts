// Memory loader — assembles the system-prompt-relevant context from:
//   1. DEEPCODE.md (project-root + parent dirs walking upward)
//   2. ~/.deepcode/DEEPCODE.md (user-level)
//   3. AGENTS.md (auto-imported at top of merged DEEPCODE.md)
//   4. @-import expansion (recursive, max 4 hops with cycle detection)
//   5. .deepcode/rules/*.md with optional path frontmatter
//
// Spec: docs/DEVELOPMENT_PLAN.md §3.6a

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export interface MemorySource {
  /** Where the content came from (label only — not for matching). */
  label: string;
  /** Absolute path. */
  path: string;
  /** Raw content. */
  content: string;
}

export interface LoadedMemory {
  sources: MemorySource[];
  /** Concatenated markdown ready to inject into system prompt. */
  text: string;
  /** Cumulative byte size for budget tracking. */
  bytes: number;
  /** Files referenced via @-import that could not be resolved. */
  unresolvedImports: string[];
}

export interface LoadMemoryOpts {
  cwd: string;
  /** Override $HOME for tests. */
  home?: string;
  /** Max bytes total (caller can use this to enforce settings.memoryLoadCapKB). */
  maxBytes?: number;
  /** Max depth for @-import recursion. */
  maxImportDepth?: number;
}

const DEFAULT_MAX_BYTES = 100 * 1024;
const DEFAULT_MAX_DEPTH = 4;

export async function loadMemory(opts: LoadMemoryOpts): Promise<LoadedMemory> {
  const home = opts.home ?? homedir();
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = opts.maxImportDepth ?? DEFAULT_MAX_DEPTH;

  const sources: MemorySource[] = [];
  const unresolvedImports: string[] = [];
  const visited = new Set<string>();
  let bytes = 0;

  const addFile = async (path: string, label: string, depth: number): Promise<void> => {
    const abs = resolve(path);
    if (visited.has(abs)) return; // cycle
    visited.add(abs);

    const raw = await readMaybe(abs);
    if (raw === null) return;

    const expanded =
      depth < maxDepth ? await expandImports(raw, abs, depth + 1, addFile, unresolvedImports) : raw;

    if (bytes + expanded.length > maxBytes) {
      const remaining = Math.max(0, maxBytes - bytes);
      const truncated = expanded.slice(0, remaining) + '\n... [truncated by memoryLoadCapKB]';
      sources.push({ label, path: abs, content: truncated });
      bytes += truncated.length;
      return;
    }
    sources.push({ label, path: abs, content: expanded });
    bytes += expanded.length;
  };

  // 1. ~/.deepcode/DEEPCODE.md (user-level)
  await addFile(join(home, '.deepcode', 'DEEPCODE.md'), 'user memory', 0);

  // 2. DEEPCODE.md walking from cwd → root, deepest first
  const upwards = walkUpwards(opts.cwd, home);
  // Reverse so root-most first, deepest last (later overrides via concat — Claude Code semantics)
  for (const dir of upwards.reverse()) {
    await addFile(join(dir, 'DEEPCODE.md'), `${dir}/DEEPCODE.md`, 0);
  }

  // 3. AGENTS.md (project root only — co-located with DEEPCODE.md)
  await addFile(join(opts.cwd, 'AGENTS.md'), 'AGENTS.md (cross-tool)', 0);

  // 4. .deepcode/rules/*.md (path-scoped frontmatter — M3 loads all; gating M4)
  const rulesDir = join(opts.cwd, '.deepcode', 'rules');
  try {
    const entries = await fs.readdir(rulesDir);
    for (const e of entries.sort()) {
      if (e.endsWith('.md')) await addFile(join(rulesDir, e), `rule: ${e}`, 0);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const text = sources.map((s) => `# ${s.label}\n\n${s.content}`).join('\n\n---\n\n');

  return { sources, text, bytes, unresolvedImports };
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Walk from `start` up to (but not including) `boundary`.
 * If start is outside boundary, returns just [start].
 */
export function walkUpwards(start: string, boundary: string): string[] {
  const out: string[] = [];
  let cur = resolve(start);
  const boundaryAbs = resolve(boundary);
  const root = sep; // '/' on POSIX
  // include boundary itself? we exclude $HOME because user-level loaded separately
  while (true) {
    out.push(cur);
    if (cur === boundaryAbs) break;
    if (cur === root) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

/**
 * Expand `@<path>` references in markdown. Paths are resolved relative to the
 * file containing the @-import. Supports `@~/path` (home-relative) and absolute.
 */
async function expandImports(
  content: string,
  sourcePath: string,
  depth: number,
  addFile: (path: string, label: string, depth: number) => Promise<void>,
  unresolved: string[],
): Promise<string> {
  // Match @<path>  where <path> doesn't contain whitespace
  const importPattern = /(^|\s)@([\w./~-]+(?:\.md|\.txt)?)/g;
  const matches = [...content.matchAll(importPattern)];
  if (matches.length === 0) return content;

  // Use the FIRST import recursively (then we drop the @-import line from output)
  for (const m of matches) {
    const ref = m[2]!;
    const target = resolveImportPath(ref, sourcePath);
    const exists = await fileExists(target);
    if (!exists) {
      unresolved.push(`${sourcePath}: @${ref}`);
      continue;
    }
    await addFile(target, `@${ref} (from ${sourcePath})`, depth);
  }

  // Strip @-import markers from the inlined content (they're handled separately)
  return content.replace(importPattern, (_full, lead) => lead);
}

function resolveImportPath(ref: string, sourcePath: string): string {
  if (ref.startsWith('~/')) {
    return join(homedir(), ref.slice(2));
  }
  if (isAbsolute(ref)) return ref;
  return join(dirname(sourcePath), ref);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
