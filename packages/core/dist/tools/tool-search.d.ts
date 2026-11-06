import type { ToolHandler } from '../types.js';
export interface DeferredToolEntry {
    name: string;
    description: string;
    /** Lazily produce the full ToolHandler when the tool is "expanded". */
    expand: () => Promise<ToolHandler> | ToolHandler;
}
export interface DeferredToolStore {
    /** Returns all deferred entries (for keyword search). */
    list(): DeferredToolEntry[];
    /** Expand and register an entry; idempotent on already-registered names. */
    expand(name: string): Promise<ToolHandler | undefined>;
}
export declare function makeToolSearchTool(store: DeferredToolStore): ToolHandler;
/**
 * Default DeferredToolStore backed by a ToolRegistry. Builds an internal map
 * of name → entry on construction; expand() calls registry.register().
 */
/** Minimal registry surface installToolSearch needs. */
export interface ToolSearchRegistry {
    register: (h: ToolHandler) => void;
    get: (name: string) => ToolHandler | undefined;
}
/**
 * Wire a set of deferred tools behind a ToolSearch tool registered into
 * `registry`. The deferred tools are NOT in the registry until the agent loads
 * them via ToolSearch (`select:Name` or keyword search). No-op (returns []) when
 * `deferred` is empty — there's nothing to search, so ToolSearch isn't added.
 * Returns the deferred tool names (for surfacing to the user/model).
 */
export declare function installToolSearch(registry: ToolSearchRegistry, deferred: DeferredToolEntry[]): string[];
export declare class RegistryDeferredStore implements DeferredToolStore {
    private readonly registry;
    private readonly entries;
    constructor(registry: {
        register: (h: ToolHandler) => void;
        get: (name: string) => ToolHandler | undefined;
    }, entries: DeferredToolEntry[]);
    list(): DeferredToolEntry[];
    expand(name: string): Promise<ToolHandler | undefined>;
}
//# sourceMappingURL=tool-search.d.ts.map