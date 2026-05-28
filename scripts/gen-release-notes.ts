#!/usr/bin/env node
// gen-release-notes — generate release notes by walking commits between two refs.
// Spec: docs/DEVELOPMENT_PLAN.md §9 (M9 release pipeline)
//
// Usage:
//   tsx scripts/gen-release-notes.ts <from-ref> <to-ref>           # write to stdout
//   tsx scripts/gen-release-notes.ts <from-ref> <to-ref> > NOTES.md
//
// Output buckets commits by conventional-commit type:
//   feat:      → ✨ New
//   fix:       → 🐛 Fixes
//   perf:      → ⚡ Performance
//   refactor:  → ♻️ Refactor
//   docs:      → 📝 Docs
//   test:      → 🧪 Tests
//   chore:     → 🔧 Chore
//   anything else → 📦 Other

import { spawnSync } from 'node:child_process';

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

function main(): void {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    process.stderr.write('Usage: gen-release-notes <from-ref> <to-ref>\n');
    process.exit(2);
  }
  const commits = gitLog(from, to);
  const buckets = bucketCommits(commits);
  process.stdout.write(renderMarkdown(from, to, buckets) + '\n');
}

// Expose for tests
export { gitLog, bucketCommits, classify, renderMarkdown, strip };

// CLI entry — only run if invoked directly
const invoked = process.argv[1] ?? '';
if (invoked.includes('gen-release-notes')) {
  main();
}
