export interface CustomCommand {
    /** Invocation name including the leading slash, e.g. `/review`. */
    name: string;
    description: string;
    /** Prompt template (the markdown body). */
    body: string;
    /** Hint shown in help, e.g. "<file>". */
    argumentHint?: string;
    source: 'user' | 'project' | 'plugin';
    path: string;
}
export interface LoadSlashCommandsOpts {
    cwd: string;
    /** Override HOME (tests). */
    home?: string;
    /** Installed-plugin directories; each contributes `<dir>/commands/*.md`. */
    pluginDirs?: string[];
}
/**
 * Load custom commands from plugin `<dir>/commands/*.md`, then
 * `~/.deepcode/commands/*.md` (user), then `<cwd>/.deepcode/commands/*.md`
 * (project). Precedence ascends plugin → user → project (later wins on a name
 * clash) so a user/project command can override a plugin's.
 */
export declare function loadSlashCommands(opts: LoadSlashCommandsOpts): Promise<CustomCommand[]>;
/** Find a loaded command by its invocation name (e.g. `/review`). */
export declare function findCustomCommand(cmds: CustomCommand[], name: string): CustomCommand | undefined;
/**
 * Expand a command body with positional + joined arguments:
 *   `$ARGUMENTS` → all args joined by spaces
 *   `$1`, `$2`, … → individual positional args (empty string if absent)
 */
export declare function expandCommandBody(body: string, args: string[]): string;
//# sourceMappingURL=index.d.ts.map