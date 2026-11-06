export declare const LAUNCHD_LABEL = "dev.deepcode.scheduler";
export interface LaunchdInstallOpts {
    /** Override HOME for tests. */
    home?: string;
    /** Path to the deepcode binary (absolute). */
    binPath: string;
    /** Subcommand to invoke (default: "scheduler run"). */
    subcommand?: string;
    /**
     * Explicit ProgramArguments, used verbatim (NOT space-split). Takes
     * precedence over binPath+subcommand. Use this when the launcher path or
     * any argument may contain spaces — e.g. `[node, "/path with space/cli.js",
     * "scheduler", "run"]`.
     */
    programArgs?: string[];
    /** Run interval in seconds — default 60. */
    intervalSec?: number;
}
export declare function launchdPlistPath(home?: string): string;
/**
 * Generate the plist XML body (pure — easy to test). The real install/uninstall
 * also writes the file and `launchctl load`s it.
 */
export declare function buildPlist(opts: LaunchdInstallOpts): string;
/**
 * Write the plist to ~/Library/LaunchAgents/. Caller is responsible for
 * `launchctl load -w <path>` (we don't shell out from a pure module).
 * Returns the absolute path of the written plist.
 */
export declare function installPlist(opts: LaunchdInstallOpts): Promise<string>;
/**
 * Remove the plist. Idempotent.
 */
export declare function uninstallPlist(home?: string): Promise<boolean>;
//# sourceMappingURL=index.d.ts.map