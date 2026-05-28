import { describe, expect, it } from 'vitest';
import { newQuestionId, newTurnId } from './protocol.js';

describe('newTurnId', () => {
  it('returns turn-<base36 ts>-<random>', () => {
    const id = newTurnId();
    expect(id).toMatch(/^turn-[0-9a-z]+-[0-9a-z]+$/);
  });
  it('produces unique ids across rapid calls', () => {
    const set = new Set(Array.from({ length: 50 }, newTurnId));
    expect(set.size).toBe(50);
  });
});

describe('newQuestionId', () => {
  it('returns q-<base36 ts>-<random>', () => {
    const id = newQuestionId();
    expect(id).toMatch(/^q-[0-9a-z]+-[0-9a-z]+$/);
  });
  it('produces unique ids', () => {
    const set = new Set(Array.from({ length: 50 }, newQuestionId));
    expect(set.size).toBe(50);
  });
});
