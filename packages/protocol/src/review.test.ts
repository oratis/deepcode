import { describe, expect, it } from 'vitest';

import { reviewApplyPrompt } from './review.js';

describe('reviewApplyPrompt', () => {
  it('creates a verification-first turn prompt with the exact finding identity', () => {
    const prompt = reviewApplyPrompt({
      findingId: 'finding-1',
      title: 'Null crash',
      body: 'The branch dereferences null.',
      path: 'src/a.ts',
      startLine: 4,
      endLine: 4,
      priority: 1,
      replacement: 'if (value === null) return;',
    });
    expect(prompt).toContain('Apply review finding finding-1');
    expect(prompt).toContain('Re-read the file and verify');
    expect(prompt).toContain('normal editing tools');
  });

  it('rejects malformed external command payloads', () => {
    expect(() => reviewApplyPrompt({} as never)).toThrow('valid review finding');
    expect(() =>
      reviewApplyPrompt({
        findingId: 'finding-1',
        title: 'unsafe',
        body: 'unsafe path',
        path: '../outside',
        startLine: 1,
        endLine: 1,
        priority: 1,
      }),
    ).toThrow('valid review finding');
  });
});
