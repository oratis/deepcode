import { type InstalledPlugin } from './manifest.js';
export interface RemoteInstallOpts {
    /** Override HOME for tests. */
    home?: string;
    /** Override the parent dir for staging clones. */
    stagingDir?: string;
    /** Trust origin label — recorded in plugins-trust.json. */
    trustedBy?: 'user' | 'marketplace' | 'official';
}
/**
 * Install from a GitHub repo (`gh:owner/repo` or `gh:owner/repo@ref`).
 * Steps:
 *   1. git clone --depth 1 [--branch <ref>] into staging dir
 *   2. installLocal(staging) → copies to ~/.deepcode/plugins/<name>/
 *   3. Remove staging dir
 */
export declare function installFromGithub(spec: string, opts?: RemoteInstallOpts): Promise<InstalledPlugin>;
/**
 * Install from an npm package (`<name>@npm` or `<name>@<version>@npm`).
 * Uses `npm pack <name>` to produce a tarball, extracts it, and runs the
 * local install flow. Doesn't write to the global npm registry.
 */
export declare function installFromNpm(spec: string, opts?: RemoteInstallOpts): Promise<InstalledPlugin>;
/**
 * Polymorphic entry point: detects spec format and dispatches.
 */
export declare function installFromSpec(spec: string, opts?: RemoteInstallOpts): Promise<InstalledPlugin>;
/**
 * Uninstall — remove the plugin dir from ~/.deepcode/plugins/<name>/
 * and the trust manifest entry. Idempotent.
 */
export declare function uninstallPlugin(name: string, home?: string): Promise<boolean>;
//# sourceMappingURL=install.d.ts.map