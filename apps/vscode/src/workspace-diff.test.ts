import type { WorkspaceDiffResult } from '@deepcode/protocol';
import { describe, expect, it } from 'vitest';

import { formatWorkspaceDiffForReview } from './workspace-diff.js';

describe('formatWorkspaceDiffForReview', () => {
  it('renders the canonical DTO without invoking git', () => {
    const diff: WorkspaceDiffResult = {
      repository: true,
      base: 'HEAD',
      truncated: false,
      files: [
        {
          path: 'src/a.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          binary: false,
          truncated: false,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: [
                { kind: 'deletion', oldLine: 1, text: 'old' },
                { kind: 'addition', newLine: 1, text: 'new' },
              ],
            },
          ],
        },
      ],
    };
    expect(formatWorkspaceDiffForReview(diff)).toContain(
      'diff -- modified "src/a.ts"\n@@ -1,1 +1,1 @@\n-old\n+new',
    );
  });
});
