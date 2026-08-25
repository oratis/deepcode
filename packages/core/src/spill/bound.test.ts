import { describe, it, expect } from 'vitest';
import { boundText, BoundedCapture } from './bound.js';

describe('boundText', () => {
  it('returns the whole string when it fits', () => {
    expect(boundText('hello', 10, 10)).toEqual({ head: 'hello', tail: '', omitted: 0 });
  });

  it('keeps both ends and reports the gap', () => {
    const r = boundText('abcdefghij', 3, 2);
    expect(r.head).toBe('abc');
    expect(r.tail).toBe('ij');
    expect(r.omitted).toBe(5);
  });

  it('accounts for every character', () => {
    const text = 'x'.repeat(1000);
    const r = boundText(text, 100, 250);
    expect(r.head.length + r.tail.length + r.omitted).toBe(text.length);
  });

  it('never splits a surrogate pair', () => {
    // Each emoji is two UTF-16 code units; cutting at an odd index would leave
    // a lone surrogate that renders as a replacement character.
    const text = '😀'.repeat(20);
    const r = boundText(text, 3, 3);
    expect(r.head).toBe('😀');
    expect(r.tail).toBe('😀');
    expect([...r.head].every((c) => c === '😀')).toBe(true);
    expect([...r.tail].every((c) => c === '😀')).toBe(true);
  });

  it('supports a zero-length tail', () => {
    const r = boundText('abcdef', 2, 0);
    expect(r).toEqual({ head: 'ab', tail: '', omitted: 4 });
  });
});

describe('BoundedCapture', () => {
  it('reproduces the input exactly when under the limits', () => {
    const c = new BoundedCapture(10, 10);
    c.push('abc');
    c.push('def');
    expect(c.text()).toBe('abcdef');
    expect(c.omitted).toBe(0);
    expect(c.total).toBe(6);
  });

  it('keeps the head and the tail once it overflows', () => {
    const c = new BoundedCapture(3, 3);
    for (const ch of 'abcdefghijklmnop') c.push(ch);
    expect(c.total).toBe(16);
    expect(c.omitted).toBe(10);
    const text = c.text();
    expect(text.startsWith('abc')).toBe(true);
    expect(text.endsWith('nop')).toBe(true);
    expect(text).toContain('10 characters not captured');
  });

  it('bounds memory regardless of how much is pushed', () => {
    const c = new BoundedCapture(100, 100);
    for (let i = 0; i < 500; i++) c.push('y'.repeat(1000));
    expect(c.total).toBe(500_000);
    // Retained text is the two ends plus one marker line, not the 500 KB pushed.
    expect(c.text().length).toBeLessThan(400);
  });

  it('splits a chunk that straddles the head boundary', () => {
    const c = new BoundedCapture(4, 4);
    c.push('abcdefghij');
    expect(c.text().startsWith('abcd')).toBe(true);
    expect(c.text().endsWith('ghij')).toBe(true);
    expect(c.omitted).toBe(2);
  });
});
