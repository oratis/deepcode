import type { DeepCodeSettings } from './types.js';
export type SettingsLayerName = 'user' | 'project' | 'local' | 'override';
export interface SettingsValueSource {
    layer: SettingsLayerName;
    path: string;
}
export interface LoadedSettings {
    merged: DeepCodeSettings;
    layers: {
        user?: DeepCodeSettings;
        project?: DeepCodeSettings;
        local?: DeepCodeSettings;
        /** `--settings <file>` override — highest precedence, treated as trusted. */
        override?: DeepCodeSettings;
    };
    sources: {
        userPath: string;
        projectPath: string;
        localPath: string;
        overridePath?: string;
    };
    /** Winning source for each leaf setting, keyed by RFC 6901 JSON pointer. */
    provenance: Record<string, SettingsValueSource>;
}
export interface LoadSettingsOpts {
    cwd: string;
    /** Override $HOME for tests. */
    home?: string;
    /** Direct DeepCode data directory override (contains settings.json). */
    directory?: string;
    /** `--settings <file>`: a settings file that wins over all discovered layers. */
    settingsPath?: string;
}
export declare function settingsPaths(opts: LoadSettingsOpts): LoadedSettings['sources'];
/**
 * Where the user layer comes from when DeepCode has no settings of its own.
 *
 * A Claude Code user's `~/.claude/settings.json` is read in place rather than
 * requiring `mv ~/.claude/settings.json ~/.deepcode/settings.json`. It is a
 * *fallback*, not an extra layer: the moment `~/.deepcode/settings.json`
 * exists it wins outright, so provenance keeps naming one real file and the
 * trust gate keeps seeing exactly the layers it already knows about.
 *
 * User-level only. A project's `.claude/settings.json` is not read: project
 * settings pass through the directory-trust gate, and quietly widening what
 * that gate covers is not a change to make in passing.
 */
export declare function resolveUserSettingsPath(opts: LoadSettingsOpts): Promise<string>;
export declare function loadSettings(opts: LoadSettingsOpts): Promise<LoadedSettings>;
/**
 * Deep-merge: objects merged recursively; arrays/scalars in later overwrite earlier.
 * (Arrays are NOT concatenated — settings semantics are "later replaces earlier".)
 */
export declare function deepMerge<T extends Record<string, unknown>>(a: T, b: T): T;
export declare function writeSettings(path: string, settings: DeepCodeSettings): Promise<void>;
/**
 * Append a single matcher to `permissions.allow[]` inside the settings file
 * at `path` (creating the file if it doesn't exist). Idempotent — does
 * nothing if the matcher is already present.
 *
 * Used by the approval flow: when the user clicks "Always allow", the host
 * calls this against the project-local settings.local.json so the rule
 * survives across sessions.
 */
export declare function appendAllowMatcher(path: string, matcher: string): Promise<void>;
//# sourceMappingURL=loader.d.ts.map