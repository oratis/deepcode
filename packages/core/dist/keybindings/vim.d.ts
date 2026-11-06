export interface KeyBinding {
    /** Whitespace-separated chord sequence (e.g. "ctrl+a" or "esc esc"). */
    key: string;
    /** Action — slash command, "insert:<text>", or a built-in action name. */
    action: string;
    /** Optional Vim-mode restriction: NORMAL | INSERT | VISUAL. Falsy = all modes. */
    when?: 'NORMAL' | 'INSERT' | 'VISUAL';
    /** Free-text description shown in /keybindings. */
    description?: string;
}
export interface KeybindingsConfig {
    /** Top-level on/off. */
    enabled?: boolean;
    /** Whether Vim mode is active. */
    vim?: boolean;
    /** Custom bindings; merged after defaults. */
    bindings?: KeyBinding[];
}
export declare const DEFAULT_KEYBINDINGS: KeyBinding[];
export interface KeyResolveOpts {
    /** Current Vim mode (when vim is enabled). */
    vimMode?: 'NORMAL' | 'INSERT' | 'VISUAL';
    /** Whether vim mode is enabled at all. */
    vim?: boolean;
}
/**
 * Look up the action for a chord. Returns undefined if no binding matches.
 * When vim mode is on, `when` restrictions apply; later entries override
 * earlier on identical chord+restriction.
 */
export declare function resolveKeyAction(chord: string, bindings: KeyBinding[], opts?: KeyResolveOpts): KeyBinding | undefined;
export declare function normalizeChord(chord: string): string;
export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL';
export declare class VimState {
    mode: VimMode;
    /** Buffer of pending chord chars (for multi-char NORMAL sequences like `gg`). */
    pending: string;
    /** Most recently yanked text. */
    yanked: string;
    /**
     * Feed one key event; return the resolved action label (or undefined if
     * still accumulating). Pure function over (state, input).
     */
    feed(chord: string, bindings: KeyBinding[]): string | undefined;
    private applyAction;
}
//# sourceMappingURL=vim.d.ts.map