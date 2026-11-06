/** Slugify an absolute project path into a stable per-repo key (mirrors the
 *  harness layout `~/.deepcode/projects/<key>/memory/MEMORY.md`). */
export declare function projectMemoryKey(cwd: string): string;
/** Path to the agent/user-written project memory file for `cwd`. */
export declare function projectMemoryPath(home: string, cwd: string): string;
/**
 * Append a remembered fact to the project memory file (the `#` store). Creates
 * the file with a header on first write. Returns the file path.
 */
export declare function rememberFact(cwd: string, fact: string, home?: string): Promise<string>;
export interface MemorySource {
    /** Where the content came from (label only — not for matching). */
    label: string;
    /** Absolute path. */
    path: string;
    /** Raw content. */
    content: string;
}
export interface LoadedMemory {
    sources: MemorySource[];
    /** Concatenated markdown ready to inject into system prompt. */
    text: string;
    /** Cumulative byte size for budget tracking. */
    bytes: number;
    /** Files referenced via @-import that could not be resolved. */
    unresolvedImports: string[];
}
export interface LoadMemoryOpts {
    cwd: string;
    /** Override $HOME for tests. */
    home?: string;
    /** Direct DeepCode data directory (contains DEEPCODE.md and projects/). */
    directory?: string;
    /** Max bytes total (caller can use this to enforce settings.memoryLoadCapKB). */
    maxBytes?: number;
    /** Max depth for @-import recursion. */
    maxImportDepth?: number;
}
export declare function loadMemory(opts: LoadMemoryOpts): Promise<LoadedMemory>;
/**
 * Walk from `start` up to (but not including) `boundary`.
 * If start is outside boundary, returns just [start].
 */
export declare function walkUpwards(start: string, boundary: string): string[];
//# sourceMappingURL=loader.d.ts.map