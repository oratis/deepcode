import { PersistentShell, type ShellSessionOptions } from './session.js';
/** An open shell and what a caller is allowed to know about it. */
export interface ShellInfo {
    id: string;
    /** Directory it started in. */
    cwd: string;
    /** ISO timestamp of the last command run in it. */
    lastUsedAt: string;
    busy: boolean;
}
export interface ShellRegistryOptions {
    /** Close a shell after this long without a command. Defaults to 30 minutes. */
    idleTimeoutMs?: number;
    /** Maximum shells open at once. Defaults to 8. */
    maxShells?: number;
}
/** Every shell open for one agent session. */
export declare class ShellRegistry {
    #private;
    /**
     * @param opts Idle timeout and concurrency cap.
     */
    constructor(opts?: ShellRegistryOptions);
    /**
     * Open a shell.
     *
     * @param opts Where to start it and under what confinement.
     * @returns The new shell's id.
     * @throws When the concurrency cap is already reached.
     */
    open(opts: ShellSessionOptions): Promise<string>;
    /**
     * Look up a live shell.
     *
     * @param id Shell id.
     * @returns The shell, or undefined when it is unknown or already gone.
     */
    get(id: string): PersistentShell | undefined;
    /** Record activity on a shell and restart its idle countdown. */
    touch(id: string): void;
    /** Every open shell, oldest first. */
    list(): ShellInfo[];
    /**
     * Close one shell.
     *
     * @param id Shell id.
     * @returns True when a shell was closed, false when the id was unknown.
     */
    close(id: string): Promise<boolean>;
    /** Close everything. Called when the owning run or session ends. */
    closeAll(): Promise<void>;
}
//# sourceMappingURL=registry.d.ts.map