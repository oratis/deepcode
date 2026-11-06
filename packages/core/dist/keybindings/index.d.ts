import type { KeybindingsConfig, KeyBinding } from './vim.js';
export { DEFAULT_KEYBINDINGS, VimState, normalizeChord, resolveKeyAction, type KeyBinding, type KeybindingsConfig, type KeyResolveOpts, type VimMode, } from './vim.js';
export declare function keybindingsPath(home: string): string;
export declare function loadKeybindings(home?: string): Promise<{
    config: KeybindingsConfig;
    bindings: KeyBinding[];
}>;
export declare function saveKeybindings(config: KeybindingsConfig, home?: string): Promise<void>;
//# sourceMappingURL=index.d.ts.map