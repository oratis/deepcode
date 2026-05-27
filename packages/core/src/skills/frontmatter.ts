// YAML frontmatter parser — minimal, handles the subset needed for
// SKILL.md / sub-agent .md / output-style .md files.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13 / §3.13a / §3.13b
//
// We don't pull in a full YAML lib — frontmatter for these files is restricted
// to: strings, numbers, booleans, string arrays, simple objects. This keeps
// dependencies zero and behavior predictable.

export interface Frontmatter {
  /** All parsed key-value pairs (strings, arrays, booleans). */
  fields: Record<string, unknown>;
  /** Markdown body after the frontmatter. */
  body: string;
}

export function parseFrontmatter(raw: string): Frontmatter {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { fields: {}, body: raw };
  }
  // Locate the closing `---`
  const lines = raw.split(/\r?\n/);
  // First line is "---"
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { fields: {}, body: raw };

  const yamlLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n');
  return { fields: parseSimpleYaml(yamlLines), body };
}

/**
 * Parse a small subset of YAML. Supports:
 *   key: "string"
 *   key: bare-string
 *   key: 42
 *   key: true / false
 *   key: ["a", "b", "c"]   (flow-style array)
 *   key:                    (block-style array)
 *     - item1
 *     - item2
 *   key:                    (object — single level)
 *     subkey: value
 */
export function parseSimpleYaml(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const [, key, value] = m;
    const k = key!;
    const v = (value ?? '').trim();
    if (v === '') {
      // Possibly block-style array or object
      const next: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+/.test(lines[j]!)) {
        next.push(lines[j]!);
        j++;
      }
      out[k] = parseBlock(next);
      i = j;
      continue;
    }
    out[k] = parseScalar(v);
    i++;
  }
  return out;
}

function parseScalar(v: string): unknown {
  // Strip optional quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
  // Flow-style array
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseScalar(s.trim()));
  }
  return v;
}

function parseBlock(lines: string[]): unknown {
  if (lines.length === 0) return {};
  // Detect array form
  const arrayItem = /^\s*-\s+(.+)$/;
  if (lines.every((l) => arrayItem.test(l) || l.trim() === '')) {
    return lines
      .map((l) => arrayItem.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => parseScalar(m[1]!.trim()));
  }
  // Otherwise treat as object
  return parseSimpleYaml(lines.map((l) => l.replace(/^\s+/, '')));
}
