#!/usr/bin/env node
// gen-release-notes — the body of a GitHub Release.
// Spec: docs/DEVELOPMENT_PLAN.md §9 (M9 release pipeline)
//
// Usage:
//   tsx scripts/gen-release-notes.ts <from-ref> <to-ref>
//   tsx scripts/gen-release-notes.ts <from-ref> <to-ref> --version 0.3.1
//
// With `--version`, CHANGELOG.md's entry for that version is the release body.
// It is written deliberately, for humans, and already groups changes by what
// they mean rather than by the verb the commit happened to start with. A list of
// commit subjects is what you write when nobody wrote anything better.
//
// Without a matching entry it falls back to walking the commit range and says
// so in the output, bucketed by conventional-commit type:
//   feat: → ✨ New · fix: → 🐛 Fixes · perf: → ⚡ Performance
//   refactor: → ♻️ Refactor · docs: → 📝 Docs · test: → 🧪 Tests
//   chore: → 🔧 Chore · anything else → 📦 Other

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Strip inherited `GIT_*` so a leaked `GIT_DIR` cannot point these commands at
 * another repository.
 *
 * Duplicated from `packages/core/src/util/git-env.ts` rather than imported: the
 * release job runs this with `npx tsx` after `pnpm install` but before any
 * build, so `@deepcode/core`'s `dist/` does not exist yet. Six lines beats
 * adding a build step to a job that needs nothing else from the workspace.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
}

interface Commit {
  hash: string;
  subject: string;
  body: string;
}

interface Bucket {
  label: string;
  emoji: string;
  commits: Commit[];
}

const BUCKETS: Record<string, { label: string; emoji: string }> = {
  feat: { label: 'New', emoji: '✨' },
  fix: { label: 'Fixes', emoji: '🐛' },
  perf: { label: 'Performance', emoji: '⚡' },
  refactor: { label: 'Refactor', emoji: '♻️' },
  docs: { label: 'Docs', emoji: '📝' },
  test: { label: 'Tests', emoji: '🧪' },
  chore: { label: 'Chore', emoji: '🔧' },
  other: { label: 'Other', emoji: '📦' },
};

const BUCKET_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'other'];

function gitLog(fromRef: string, toRef: string): Commit[] {
  // %H = full hash, %s = subject, %b = body — separated by NUL for safety
  const sep = '__DEEPCODE_SEP__';
  const recordSep = '__DEEPCODE_RECORD__';
  const fmt = `%H${sep}%s${sep}%b${recordSep}`;
  const r = spawnSync('git', ['log', `--pretty=format:${fmt}`, `${fromRef}..${toRef}`], {
    encoding: 'utf8',
    env: gitEnv(),
  });
  if (r.status !== 0) {
    process.stderr.write(`git log failed: ${r.stderr}\n`);
    process.exit(2);
  }
  return r.stdout
    .split(recordSep)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [hash = '', subject = '', body = ''] = s.split(sep);
      return { hash, subject, body };
    });
}

function classify(commit: Commit): string {
  const m = /^([a-z]+)(?:\([^)]+\))?(?:!)?:/.exec(commit.subject);
  if (!m) return 'other';
  const type = m[1]!.toLowerCase();
  return BUCKETS[type] ? type : 'other';
}

function bucketCommits(commits: Commit[]): Record<string, Bucket> {
  const out: Record<string, Bucket> = {};
  for (const key of BUCKET_ORDER) {
    out[key] = { label: BUCKETS[key]!.label, emoji: BUCKETS[key]!.emoji, commits: [] };
  }
  for (const c of commits) {
    out[classify(c)]!.commits.push(c);
  }
  return out;
}

function strip(s: string): string {
  // Drop the "type(scope): " prefix and any Co-Authored-By trailer
  return s
    .replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/, '')
    .split('\n')
    .filter((l) => !/^Co-Authored-By:/.test(l))
    .join('\n')
    .trim();
}

function renderMarkdown(fromRef: string, toRef: string, buckets: Record<string, Bucket>): string {
  const lines: string[] = [];
  lines.push(`# Release notes (${fromRef}…${toRef})`);
  lines.push('');
  for (const key of BUCKET_ORDER) {
    const b = buckets[key]!;
    if (b.commits.length === 0) continue;
    lines.push(`## ${b.emoji} ${b.label}`);
    lines.push('');
    for (const c of b.commits) {
      const subject = strip(c.subject);
      const short = c.hash.slice(0, 7);
      lines.push(`- ${subject} (${short})`);
    }
    lines.push('');
  }
  const total = Object.values(buckets).reduce((n, b) => n + b.commits.length, 0);
  lines.push(`---`);
  lines.push(`${total} commits.`);
  return lines.join('\n');
}

/**
 * The body of one CHANGELOG version section, heading excluded.
 *
 * The heading is dropped because the release page already carries the version
 * as its title, and repeating it reads as a mistake. `[Unreleased]` can never
 * match: the pattern requires the exact version, and a release that shipped
 * whatever happened to be sitting under "Unreleased" would be lying about its
 * own contents.
 */
export function changelogEntry(changelog: string, version: string): string | undefined {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `## [0.3.1]` optionally followed by a date. Anchored at line start so a
  // version mentioned inside prose cannot be mistaken for a section.
  const start = new RegExp(`^## \\[${escaped}\\][^\\n]*$`, 'm').exec(changelog);
  if (!start) return undefined;

  const after = changelog.slice(start.index + start[0].length);
  const next = /^## /m.exec(after);
  const body = (next ? after.slice(0, next.index) : after).trim();
  return body === '' ? undefined : body;
}

/**
 * Rewrite repo-relative links to absolute URLs pinned at `ref`.
 *
 * A release body is not rendered inside the repository, so `docs/file-contract.md`
 * resolves against nothing and 404s. Pinning at the tag rather than the default
 * branch also means a link in the v0.3.0 notes keeps pointing at the v0.3.0
 * document after the file moves.
 *
 * Absolute URLs, in-page anchors, and mail links are left alone.
 */
export function absoluteLinks(markdown: string, repo: string, ref: string): string {
  return markdown.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return whole;
    const [path, anchor] = target.split('#');
    if (!path) return whole;
    const clean = path.replace(/^\.\//, '');
    return `](https://github.com/${repo}/blob/${ref}/${clean}${anchor ? `#${anchor}` : ''})`;
  });
}

/** `owner/name`, from the flag, the Actions environment, or the origin remote. */
export function resolveRepo(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', env: gitEnv() });
  if (r.status !== 0) return undefined;
  const m = /github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(r.stdout);
  return m?.[1];
}

interface Args {
  from?: string;
  to?: string;
  version?: string;
  changelog: string;
  repo?: string;
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) flags[arg.slice(2)] = argv[++i] ?? '';
    else positional.push(arg);
  }
  return {
    from: positional[0],
    to: positional[1],
    version: flags.version,
    changelog: flags.changelog ?? 'CHANGELOG.md',
    repo: flags.repo,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    let changelog: string | undefined;
    try {
      changelog = readFileSync(args.changelog, 'utf8');
    } catch {
      process.stderr.write(`note: ${args.changelog} not readable; falling back to commits\n`);
    }
    const entry = changelog ? changelogEntry(changelog, args.version) : undefined;
    if (entry) {
      const repo = resolveRepo(args.repo);
      process.stdout.write((repo ? absoluteLinks(entry, repo, `v${args.version}`) : entry) + '\n');
      return;
    }
    // Loud, on stderr and in the body. A release whose notes were generated
    // because nobody wrote a changelog entry should not look like one where
    // somebody did.
    process.stderr.write(
      `warning: ${args.changelog} has no entry for ${args.version}; using the commit log\n`,
    );
  }

  const { from, to } = args;
  if (!from || !to) {
    process.stderr.write('Usage: gen-release-notes <from-ref> <to-ref> [--version <x.y.z>]\n');
    process.exit(2);
  }
  const buckets = bucketCommits(gitLog(from, to));
  let body = renderMarkdown(from, to, buckets);
  if (args.version) {
    body += `\n\n> Generated from the commit log: CHANGELOG.md has no \`[${args.version}]\` entry.`;
  }
  process.stdout.write(body + '\n');
}

// Expose for tests
export { gitLog, bucketCommits, classify, renderMarkdown, strip };

// CLI entry — only run if invoked directly
const invoked = process.argv[1] ?? '';
if (invoked.includes('gen-release-notes')) {
  main();
}
