import type { Writable } from 'node:stream';
export interface ListCmdDeps {
    cwd: string;
    home?: string;
    output?: Writable;
    errOutput?: Writable;
    /** Emit machine-readable JSON instead of the human table. */
    json?: boolean;
}
interface PluginRow {
    name: string;
    version: string;
    description?: string;
    enabled: boolean;
    path: string;
}
interface SkillRow {
    name: string;
    description?: string;
    source: string;
    path: string;
}
export interface PluginsListing {
    rows: PluginRow[];
    /** Installed-but-not-loaded plugins (untrusted or hash-drift), as messages. */
    issues: string[];
}
export declare function listPlugins(deps: ListCmdDeps): Promise<PluginsListing>;
export declare function listSkills(deps: ListCmdDeps): Promise<SkillRow[]>;
export declare function runPluginsCommand(sub: string[], deps: ListCmdDeps): Promise<number>;
export declare function runSkillsCommand(sub: string[], deps: ListCmdDeps): Promise<number>;
export {};
//# sourceMappingURL=list-cmd.d.ts.map