import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseSimpleYaml } from './frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns body unchanged when no frontmatter', () => {
    expect(parseFrontmatter('hello')).toEqual({ fields: {}, body: 'hello' });
  });

  it('parses simple frontmatter', () => {
    const r = parseFrontmatter('---\nname: foo\ndescription: bar\n---\nbody here');
    expect(r.fields.name).toBe('foo');
    expect(r.fields.description).toBe('bar');
    expect(r.body).toBe('body here');
  });

  it('parses quoted strings', () => {
    const r = parseFrontmatter('---\nname: "with: colon"\n---\n');
    expect(r.fields.name).toBe('with: colon');
  });

  it('parses booleans', () => {
    const r = parseFrontmatter('---\nfoo: true\nbar: false\n---\n');
    expect(r.fields.foo).toBe(true);
    expect(r.fields.bar).toBe(false);
  });

  it('parses numbers', () => {
    const r = parseFrontmatter('---\nmax: 42\nratio: 3.14\n---\n');
    expect(r.fields.max).toBe(42);
    expect(r.fields.ratio).toBe(3.14);
  });

  it('parses flow-style arrays', () => {
    const r = parseFrontmatter('---\ntools: ["Read", "Write"]\n---\n');
    expect(r.fields.tools).toEqual(['Read', 'Write']);
  });

  it('parses block-style arrays', () => {
    const r = parseFrontmatter('---\ntools:\n  - Read\n  - Write\n  - Edit\n---\n');
    expect(r.fields.tools).toEqual(['Read', 'Write', 'Edit']);
  });

  it('parses block-style objects', () => {
    const r = parseFrontmatter('---\nlimits:\n  max: 10\n  min: 1\n---\n');
    expect(r.fields.limits).toEqual({ max: 10, min: 1 });
  });

  it('handles missing closing ---', () => {
    const raw = '---\nname: foo\nbody here';
    expect(parseFrontmatter(raw)).toEqual({ fields: {}, body: raw });
  });

  it('skips comments and empty lines', () => {
    const r = parseSimpleYaml(['# comment', '', 'name: x', '# another', 'value: 1']);
    expect(r).toEqual({ name: 'x', value: 1 });
  });
});
