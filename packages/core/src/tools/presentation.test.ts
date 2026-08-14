import { describe, it, expect } from 'vitest';
import { BUILTIN_TOOLS } from './registry.js';
import {
  BUILTIN_RENDER_INTENTS,
  pickTarget,
  presentToolCall,
  type ToolRenderKind,
} from './presentation.js';

describe('presentToolCall', () => {
  it('defaults an unknown tool to generic', () => {
    expect(presentToolCall('Whatever', { x: 1 })).toEqual({ kind: 'generic', target: undefined });
  });

  it('reads the intent a tool declared', () => {
    const p = presentToolCall('Anything', { command: 'ls' }, 'terminal');
    expect(p.kind).toBe('terminal');
    expect(p.command).toBe('ls');
  });

  it('renders Bash as a terminal transcript', () => {
    const p = presentToolCall('Bash', { command: 'pnpm test' });
    expect(p).toEqual({ kind: 'terminal', target: 'pnpm test', command: 'pnpm test' });
  });

  it('renders Edit as a two-sided diff', () => {
    const p = presentToolCall('Edit', {
      file_path: '/a/b.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });
    expect(p.kind).toBe('diff');
    expect(p.diff).toEqual({ path: '/a/b.ts', before: 'const x = 1;', after: 'const x = 2;' });
  });

  it('renders Write as wholly added, since its arguments do not say what was there', () => {
    const p = presentToolCall('Write', { file_path: '/a/b.ts', content: 'hello' });
    expect(p.diff).toEqual({ path: '/a/b.ts', before: '', after: 'hello' });
  });

  it('falls back to generic rather than rendering an empty diff', () => {
    // A declared intent is a request, not a guarantee — a client should never be
    // handed a diff with nothing in it.
    expect(presentToolCall('Edit', { old_string: 'a', new_string: 'b' }).kind).toBe('generic');
    expect(presentToolCall('Write', { file_path: '/a/b.ts' }).kind).toBe('generic');
    expect(presentToolCall('Bash', {}).kind).toBe('generic');
  });

  it('depends only on the arguments', () => {
    // Purity is what makes a replayed session render like the live one, so a
    // second call on the same input must be indistinguishable from the first.
    const input = { file_path: '/a/b.ts', old_string: 'a', new_string: 'b' };
    expect(presentToolCall('Edit', input)).toEqual(presentToolCall('Edit', input));
  });

  it('ignores non-string arguments where it expects text', () => {
    expect(presentToolCall('Bash', { command: 42 }).kind).toBe('generic');
    expect(presentToolCall('Edit', { file_path: '/a', old_string: 1, new_string: 2 }).kind).toBe(
      'generic',
    );
  });
});

describe('pickTarget', () => {
  it('prefers the most specific argument available', () => {
    expect(pickTarget({ file_path: '/a/b.ts', command: 'ls' })).toBe('/a/b.ts');
    expect(pickTarget({ command: 'ls', pattern: 'x' })).toBe('ls');
  });

  it('returns nothing when no argument makes a useful label', () => {
    expect(pickTarget({ replace_all: true })).toBeUndefined();
  });
});

describe('BUILTIN_RENDER_INTENTS', () => {
  it('agrees with what each built-in tool declares', () => {
    // The table is what clients read when they hold only a name; the definition
    // is what the loop reads. They must not drift apart.
    for (const tool of BUILTIN_TOOLS) {
      const declared = tool.definition.render as ToolRenderKind | undefined;
      expect([declared, tool.name]).toEqual([BUILTIN_RENDER_INTENTS[tool.name], tool.name]);
    }
  });
});
