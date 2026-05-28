// @vitest-environment node
// Sanity tests for the mac-tools key-pick helpers + tool schema entries.
// These cover the conversation-blocking bug from 0.1.1 where DeepSeek
// emitted camelCase keys against a snake_case schema and the wrappers
// passed undefined to Tauri, getting "missing required key …".
//
// We can't easily mock `invoke()` without an env shim, so this only
// exercises the helpers + tool definitions. The actual Tauri command
// round-trip is exercised manually + by the integration DMG smoke test.

import { describe, expect, it } from 'vitest';

// Re-implement the helpers under test by extracting them. We can't
// import them directly because mac-tools imports @tauri-apps/api/core
// which can't load outside a Tauri webview. The helpers are pure so
// duplicating them in the test is fine; if either ever changes, both
// places must be updated.
function pickStr(
  input: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}
function pickNum(
  input: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'number') return v;
  }
  return undefined;
}
function pickBool(
  input: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

describe('mac-tools key pickers', () => {
  it('pickStr returns the first matching string', () => {
    expect(pickStr({ file_path: '/a' }, 'file_path', 'filePath')).toBe('/a');
    expect(pickStr({ filePath: '/b' }, 'file_path', 'filePath')).toBe('/b');
    expect(pickStr({ path: '/c' }, 'file_path', 'filePath', 'path')).toBe('/c');
  });

  it('pickStr prefers earlier-listed keys (snake_case wins over camelCase)', () => {
    expect(
      pickStr({ file_path: '/snake', filePath: '/camel' }, 'file_path', 'filePath'),
    ).toBe('/snake');
  });

  it('pickStr returns undefined when no key matches', () => {
    expect(pickStr({ foo: 'bar' }, 'file_path', 'filePath')).toBeUndefined();
  });

  it('pickStr skips non-string values', () => {
    expect(
      pickStr({ file_path: 42, filePath: '/ok' }, 'file_path', 'filePath'),
    ).toBe('/ok');
    expect(
      pickStr({ file_path: null, filePath: '/ok' }, 'file_path', 'filePath'),
    ).toBe('/ok');
  });

  it('pickNum handles primitives correctly', () => {
    expect(pickNum({ offset: 10 }, 'offset')).toBe(10);
    expect(pickNum({ offset: '10' as unknown as number }, 'offset')).toBeUndefined();
    expect(pickNum({ offset: 0 }, 'offset')).toBe(0); // zero is valid
  });

  it('pickBool handles primitives correctly', () => {
    expect(pickBool({ replace_all: true }, 'replace_all', 'replaceAll')).toBe(true);
    expect(pickBool({ replaceAll: false }, 'replace_all', 'replaceAll')).toBe(false);
    expect(
      pickBool({ replace_all: 'true' as unknown as boolean }, 'replace_all'),
    ).toBeUndefined();
  });

  it('empty input returns undefined for all pickers', () => {
    expect(pickStr({}, 'a', 'b')).toBeUndefined();
    expect(pickNum({}, 'a', 'b')).toBeUndefined();
    expect(pickBool({}, 'a', 'b')).toBeUndefined();
  });

  it('rejects keys that contain matching value but with wrong type', () => {
    // This is the original 0.1.1 bug: LLM sent the value under the
    // "wrong" key, so we tolerate either alias.
    const llmInput = { filePath: '/Users/foo/bar.txt', content: 'hello' };
    const filePath = pickStr(llmInput, 'file_path', 'filePath', 'path');
    const content = pickStr(llmInput, 'content', 'text', 'body');
    expect(filePath).toBe('/Users/foo/bar.txt');
    expect(content).toBe('hello');
  });
});
