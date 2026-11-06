import type { SpillStore } from './types.js';
/**
 * Create a spill store writing under `<dir>/spill/`.
 *
 * @param dir Session directory. Created on first save.
 * @returns A store that persists text as UTF-8 files.
 */
export declare function createLocalSpillStore(dir: string): SpillStore;
//# sourceMappingURL=local.d.ts.map