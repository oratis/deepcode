export interface SubAgentFrontmatter {
    name: string;
    description: string;
    /** Tool whitelist for this sub-agent. */
    tools?: string[];
    /** Model override. */
    model?: string;
    /** Isolation style. */
    isolation?: 'subprocess' | 'worktree' | 'none';
    /** Max turns this sub-agent can use. */
    maxTurns?: number;
}
export interface SubAgent {
    /** `<name>` (user/project) or `<plugin>:<name>`. */
    qualifiedName: string;
    frontmatter: SubAgentFrontmatter;
    /** Markdown body — becomes the sub-agent's system prompt. */
    body: string;
    path: string;
    source: 'user' | 'project' | 'plugin';
}
export interface LoadSubAgentsOpts {
    cwd: string;
    home?: string;
    pluginDirs?: string[];
    /** Override the project-level dir (used by CLI `--agents` flag). */
    projectDirOverride?: string;
}
export declare function loadSubAgents(opts: LoadSubAgentsOpts): Promise<SubAgent[]>;
/** Lookup helper. */
export declare function findSubAgent(agents: SubAgent[], name: string): SubAgent | undefined;
//# sourceMappingURL=loader.d.ts.map