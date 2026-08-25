// Local spill backend — session-scoped files under `<sessionDir>/spill/`.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.1
//
// Spilled output lives beside the session's snapshots so both are covered by
// whatever retention policy the session directory eventually gets, rather than
// accumulating somewhere nobody thinks to clean.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { SaveTextRequest, SpillRef, SpillStore } from './types.js';

/** Reduce an arbitrary label to one safe path segment. */
function segment(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '');
  return cleaned.slice(0, 64) || 'spill';
}

/**
 * Create a spill store writing under `<dir>/spill/`.
 *
 * @param dir Session directory. Created on first save.
 * @returns A store that persists text as UTF-8 files.
 */
export function createLocalSpillStore(dir: string): SpillStore {
  const root = join(dir, 'spill');
  return {
    async saveText(req: SaveTextRequest): Promise<SpillRef> {
      await fs.mkdir(root, { recursive: true });
      const base = `${segment(req.source.toolName)}-${segment(req.source.callId)}-${segment(req.source.label)}`;
      // `wx` rather than a plain write: sanitizing can collapse two distinct
      // call ids onto one name, and silently overwriting the earlier artifact
      // would hand the model a locator pointing at someone else's output.
      let path = join(root, `${base}.txt`);
      for (let n = 2; ; n++) {
        try {
          await fs.writeFile(path, req.content, { encoding: 'utf8', flag: 'wx' });
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
          path = join(root, `${base}-${n}.txt`);
        }
      }
      return {
        locator: path,
        bytes: Buffer.byteLength(req.content, 'utf8'),
        retrievalHint: 'Read that file to see it in full; use offset/limit to page through it.',
      };
    },
  };
}
