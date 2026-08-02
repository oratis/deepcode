import { describe, expect, it } from 'vitest';

import { reviewApplyManyPrompt, reviewApplyPrompt, reviewRevertPrompt } from './review.js';

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

  it('builds bounded batch prompts and rejects duplicate finding ids', () => {
    const finding = {
      findingId: 'finding-1',
      title: 'Null crash',
      body: 'The branch dereferences null.',
      path: 'src/a.ts',
      startLine: 4,
      endLine: 4,
      priority: 1 as const,
    };
    const prompt = reviewApplyManyPrompt([
      finding,
      { ...finding, findingId: 'finding-2', path: 'src/b.ts' },
    ]);
    expect(prompt).toContain('Apply these 2 review findings');
    expect(prompt).toContain('Review finding finding-2');
    expect(() => reviewApplyManyPrompt([finding, finding])).toThrow('unique');
    expect(() => reviewApplyManyPrompt([{ ...finding, findingId: 'unsafe\nid' }])).toThrow(
      'valid review finding',
    );
    expect(() => reviewApplyManyPrompt([{ ...finding, title: 'unsafe\ntitle' }])).toThrow(
      'valid review finding',
    );
    expect(() => reviewApplyManyPrompt([{ ...finding, endLine: 205 }])).toThrow(
      'valid review finding',
    );
  });

  it('builds a tool-constrained conflict-safe revert prompt', () => {
    const prompt = reviewRevertPrompt('turn-apply', ['finding-1']);
    expect(prompt).toContain('RestoreReviewAction exactly once');
    expect(prompt).toContain('Do not use Edit, Write, Bash');
    expect(() => reviewRevertPrompt('../unsafe', ['finding-1'])).toThrow('valid review action');
  });
});
