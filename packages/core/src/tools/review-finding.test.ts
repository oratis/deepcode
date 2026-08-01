import { describe, expect, it } from 'vitest';

import { SubmitReviewFindingTool } from './review-finding.js';

describe('SubmitReviewFindingTool', () => {
  it('returns a structured line-addressable finding', async () => {
    const result = await SubmitReviewFindingTool.execute(
      {
        title: 'Handle the null branch',
        body: 'The value can be null and crashes this path.',
        path: 'src/a.ts',
        startLine: 10,
        endLine: 11,
        priority: 1,
        replacement: 'if (value === null) return;',
      },
      { cwd: '/workspace' },
    );
    expect(result).toEqual(
      expect.objectContaining({
        data: {
          finding: expect.objectContaining({ path: 'src/a.ts', startLine: 10, priority: 1 }),
        },
      }),
    );
  });

  it.each(['../secret', '/etc/passwd', 'C:\\secret.txt', 'src//a.ts'])(
    'rejects unsafe path %s',
    async (path) => {
      const result = await SubmitReviewFindingTool.execute(
        { title: 'x', body: 'y', path, startLine: 1, endLine: 1, priority: 2 },
        { cwd: '/workspace' },
      );
      expect(result.isError).toBe(true);
    },
  );
});
