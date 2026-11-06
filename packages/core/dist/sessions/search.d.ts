/** Which sessions a search may look at. */
export type SessionSearchScope = 
/** Sessions recorded in the current workspace. The default. */
'workspace'
/** Every session on this machine. User-set only. */
 | 'all';
export interface SessionSearchOptions {
    /** Sessions directory to scan. */
    root: string;
    /** Text to look for, matched case-insensitively. */
    query: string;
    /** Current working directory — defines the workspace when scope is `workspace`. */
    cwd: string;
    /** Defaults to `workspace`. */
    scope?: SessionSearchScope;
    /** Maximum hits to return across all sessions. Defaults to 20. */
    limit?: number;
    /** Characters of surrounding text kept around each hit. Defaults to 200. */
    contextChars?: number;
    /** Exclude the session currently running, which the agent can already see. */
    excludeSessionId?: string;
}
/** One matching message. */
export interface SessionSearchHit {
    sessionId: string;
    /** Session title, when it has one. */
    title?: string;
    /** Workspace the session ran in. */
    cwd: string;
    /** Message timestamp, when the record carried one. */
    timestamp?: string;
    role: 'user' | 'assistant';
    /** Index of the message within the session, for retrieval. */
    messageIndex: number;
    /** The match with surrounding text, elided at both ends. */
    excerpt: string;
}
export interface SessionSearchResult {
    hits: SessionSearchHit[];
    /** Sessions actually read. */
    sessionsSearched: number;
    /** True when `limit` cut the results short. */
    truncated: boolean;
}
/**
 * Whether a session belongs to the workspace rooted at `cwd`.
 *
 * Compared as resolved path prefixes on a separator boundary, so `/a/project`
 * does not capture `/a/project-two`.
 *
 * @param sessionCwd The session's recorded working directory.
 * @param cwd The workspace root.
 * @returns True when the session ran in that workspace or below it.
 */
export declare function inWorkspace(sessionCwd: string, cwd: string): boolean;
/**
 * Cut an excerpt around a match, marking each end that was cut.
 *
 * @param text Full text the match was found in.
 * @param at Index the match starts at.
 * @param queryLength Length of the match.
 * @param contextChars Characters to keep on each side.
 * @returns The excerpt, with `…` where text was removed.
 */
export declare function excerptAround(text: string, at: number, queryLength: number, contextChars: number): string;
/**
 * Search past sessions for text.
 *
 * Newest sessions are read first, so a `limit` that cuts the search short keeps
 * the most recent matches rather than an arbitrary set.
 *
 * @param opts Where to search, for what, and how much to return.
 * @returns Matching excerpts, plus how many sessions were read.
 */
export declare function searchSessions(opts: SessionSearchOptions): Promise<SessionSearchResult>;
//# sourceMappingURL=search.d.ts.map