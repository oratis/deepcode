// Combo — turn a finished thread into a reusable SKILL.md draft.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.D
//
// The skill loader, its frontmatter schema, and the three source layers all
// already exist. What was missing is the generating end: every SKILL.md had to
// be written by hand, up front, before anyone knew what the work involved.
//
// Floatboat's insight is that the automation should be extracted *after* the
// work, not configured before it — the moment someone finishes a task is the
// moment they understand it best.
//
// The security angle, which Floatboat does not advertise: deriving
// `allowed-tools` from what the thread actually used yields a least-privilege
// set for free. Hand-written skills are almost always broader than needed,
// because guessing generously is easier than auditing.

import { normalizeContractPath, type FileContract } from '../config/file-contract.js';
import { evaluatePath } from '../config/file-contract.js';
import type { StoredMessage, ToolUseBlock } from '../types.js';

export interface DistilledSkill {
  /** Directory-safe skill name. */
  name: string;
  /** Full SKILL.md contents, frontmatter included. */
  content: string;
  /** Tools the thread actually called — the derived least-privilege set. */
  allowedTools: string[];
  /** Paths mentioned, after contract and secret filtering. */
  paths: string[];
  /** Anything removed, so the user learns what was withheld. */
  redactions: string[];
}

export interface DistillOpts {
  history: StoredMessage[];
  /** Skill name; derived from the first request when absent. */
  name?: string;
  cwd: string;
  /** Contract used to exclude paths the agent may not read. */
  contract?: FileContract;
  model?: string;
  effort?: string;
  /** Optional prose from a model; a deterministic fallback is used without it. */
  prose?: { description?: string; body?: string };
}

/** Values that look like credentials and must never reach a shareable file. */
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, label: 'API key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, label: 'GitHub token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS access key id' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: 'JWT' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: 'private key' },
  {
    re: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
    label: 'credential assignment',
  },
];

/**
 * Distil a thread into a SKILL.md draft.
 *
 * Pure: no filesystem, no network. The caller writes the file, and only after
 * the user has seen it.
 */
export function distillSkill(opts: DistillOpts): DistilledSkill {
  const redactions: string[] = [];
  const firstRequest = firstUserText(opts.history);
  const name = sanitizeName(opts.name ?? deriveName(firstRequest));

  const toolUses = collectToolUses(opts.history);
  const allowedTools = [...new Set(toolUses.map((t) => t.name))].sort();
  const paths = collectPaths(toolUses, opts, redactions);

  const description = redact(
    opts.prose?.description ?? deriveDescription(firstRequest),
    redactions,
  );
  const body = redact(opts.prose?.body ?? deriveBody(firstRequest, toolUses, paths), redactions);

  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    // Derived from actual use, which is narrower than anyone writes by hand.
    `allowed-tools: [${allowedTools.map((t) => JSON.stringify(t)).join(', ')}]`,
    ...(opts.model ? [`model: ${opts.model}`] : []),
    ...(opts.effort ? [`effort: ${opts.effort}`] : []),
    '---',
  ].join('\n');

  const content = `${frontmatter}\n\n# TODO: review before use — generated from a thread by \`/combo\`.\n\n${body}\n`;

  return { name, content, allowedTools, paths, redactions };
}

function firstUserText(history: StoredMessage[]): string {
  for (const message of history) {
    if (message.role !== 'user') continue;
    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim()) return block.text.trim();
    }
  }
  return '';
}

function collectToolUses(history: StoredMessage[]): ToolUseBlock[] {
  const out: ToolUseBlock[] = [];
  for (const message of history) {
    for (const block of message.content) {
      if (block.type === 'tool_use') out.push(block);
    }
  }
  return out;
}

/**
 * Paths the thread touched, minus anything the contract forbids reading.
 *
 * A skill is a shareable artifact. Naming a file the agent was not allowed to
 * read would leak through the filename alone, so the contract's `deny` has to
 * apply here too — a rule that stops at the tool call but not at the export is
 * not much of a rule.
 */
function collectPaths(toolUses: ToolUseBlock[], opts: DistillOpts, redactions: string[]): string[] {
  const seen = new Set<string>();
  for (const use of toolUses) {
    for (const field of ['file_path', 'notebook_path', 'path']) {
      const raw = (use.input as Record<string, unknown>)[field];
      if (typeof raw !== 'string' || !raw) continue;
      const rel = normalizeContractPath(opts.cwd, raw);
      if (rel === null) continue;
      if (opts.contract) {
        const verdict = evaluatePath(opts.contract, { path: rel, action: 'read' }).verdict;
        if (verdict === 'deny') {
          redactions.push(`path excluded by file contract: ${rel}`);
          continue;
        }
      }
      seen.add(rel);
    }
  }
  return [...seen].sort();
}

/** Replace anything credential-shaped, recording what was removed. */
export function redact(text: string, redactions: string[]): string {
  let out = text;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      redactions.push(`redacted ${label}`);
      return '[REDACTED]';
    });
  }
  return out;
}

function deriveName(request: string): string {
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  return words.length > 0 ? words.join('-') : 'untitled-combo';
}

export function sanitizeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'untitled-combo';
}

function deriveDescription(request: string): string {
  if (!request) return 'Distilled from a DeepCode thread.';
  const firstLine = request.split('\n')[0]!.trim();
  return firstLine.length > 180 ? `${firstLine.slice(0, 179)}…` : firstLine;
}

/**
 * The deterministic draft body.
 *
 * Used verbatim when no model prose is supplied, and it is a real fallback
 * rather than a placeholder: the tool sequence and touched files are the parts
 * a reader most needs, and they are recoverable exactly. Only the prose
 * benefits from a model.
 */
function deriveBody(request: string, toolUses: ToolUseBlock[], paths: string[]): string {
  const lines: string[] = [];
  if (request) {
    lines.push('## What this does', '', request, '');
  }
  if (toolUses.length > 0) {
    lines.push('## Steps taken', '');
    const counts = new Map<string, number>();
    for (const use of toolUses) counts.set(use.name, (counts.get(use.name) ?? 0) + 1);
    for (const [tool, count] of counts) {
      lines.push(`- ${tool}${count > 1 ? ` ×${count}` : ''}`);
    }
    lines.push('');
  }
  if (paths.length > 0) {
    lines.push('## Files involved', '', ...paths.map((p) => `- \`${p}\``), '');
  }
  return lines.join('\n').trim() || 'No recorded activity to distil.';
}
