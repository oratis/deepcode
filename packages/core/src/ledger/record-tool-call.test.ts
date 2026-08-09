import { describe, expect, it } from 'vitest';
import { buildToolCallRecord, readPathFor } from './record-tool-call.js';

// Provenance: what a change was derived from, so a wrong generated file leads
// back to the input that produced it.
describe('derivedFrom', () => {
  const base = { cwd: '/work/repo', intent: 'regenerate the client' };

  it('records the reads that preceded the write', () => {
    const record = buildToolCallRecord({
      ...base,
      tool: 'Write',
      input: { file_path: '/work/repo/src/client.ts', content: '…' },
      readPaths: ['/work/repo/schema.json', '/work/repo/config/gen.yaml'],
    });
    expect(record?.derivedFrom).toEqual(['config/gen.yaml', 'schema.json']);
  });

  it('is absent when the turn read nothing', () => {
    // Not an empty array: a field that is always present is a field that stops
    // being read.
    const record = buildToolCallRecord({
      ...base,
      tool: 'Write',
      input: { file_path: 'a.ts', content: 'x' },
    });
    expect(record?.derivedFrom).toBeUndefined();
  });

  it('excludes the file being written', () => {
    // Edit reads its own target by construction; listing it would make every
    // edit look self-derived.
    const record = buildToolCallRecord({
      ...base,
      tool: 'Edit',
      input: { file_path: '/work/repo/src/a.ts', old_string: 'x', new_string: 'y' },
      readPaths: ['/work/repo/src/a.ts', '/work/repo/schema.json'],
    });
    expect(record?.derivedFrom).toEqual(['schema.json']);
  });

  it('normalizes to workspace-relative and dedupes', () => {
    const record = buildToolCallRecord({
      ...base,
      tool: 'Write',
      input: { file_path: 'out.ts', content: 'x' },
      readPaths: ['/work/repo/schema.json', 'schema.json', '/work/repo/./schema.json'],
    });
    expect(record?.derivedFrom).toEqual(['schema.json']);
  });

  it('attaches to Bash too — a command has inputs even without a declarable output', () => {
    const record = buildToolCallRecord({
      ...base,
      tool: 'Bash',
      input: { command: 'make generate' },
      readPaths: ['/work/repo/Makefile'],
    });
    expect(record?.derivedFrom).toEqual(['Makefile']);
  });
});

describe('readPathFor', () => {
  it('reports a Read', () => {
    expect(readPathFor('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
  });

  it('ignores Grep and Glob', () => {
    // They take a search *root* and return many paths. Calling the root an
    // input claims a derivation the turn did not make; enumerating every hit
    // drowns the real inputs in whatever the search swept up.
    expect(readPathFor('Grep', { path: '/a' })).toBeUndefined();
    expect(readPathFor('Glob', { path: '/a' })).toBeUndefined();
  });

  it('ignores writes and anything without a path', () => {
    expect(readPathFor('Write', { file_path: '/a' })).toBeUndefined();
    expect(readPathFor('Read', {})).toBeUndefined();
  });
});
