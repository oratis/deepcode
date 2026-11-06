import { type FileContract } from '../config/file-contract.js';
import type { StoredMessage } from '../types.js';
export interface DistilledSkill {
    /** Directory-safe skill name. */
    name: string;
    /** Full SKILL.md contents, frontmatter included. */
    content: string;
    /** Tools the thread actually called — the derived least-privilege set. */
    allowedTools: string[];
    /** Paths mentioned, after contract and secret filtering. */
    paths: string[];
    /** Anything removed, so the user learns what was withheld. */
    redactions: string[];
}
export interface DistillOpts {
    history: StoredMessage[];
    /** Skill name; derived from the first request when absent. */
    name?: string;
    cwd: string;
    /** Contract used to exclude paths the agent may not read. */
    contract?: FileContract;
    model?: string;
    effort?: string;
    /** Optional prose from a model; a deterministic fallback is used without it. */
    prose?: {
        description?: string;
        body?: string;
    };
}
/**
 * Distil a thread into a SKILL.md draft.
 *
 * Pure: no filesystem, no network. The caller writes the file, and only after
 * the user has seen it.
 */
export declare function distillSkill(opts: DistillOpts): DistilledSkill;
/** Replace anything credential-shaped, recording what was removed. */
export declare function redact(text: string, redactions: string[]): string;
export declare function sanitizeName(name: string): string;
//# sourceMappingURL=distill.d.ts.map