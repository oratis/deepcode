// Pure (no node:fs) parts of the keybindings module — types,
// DEFAULT_KEYBINDINGS, resolveKeyAction, normalizeChord, VimState.
//
// This file is safe to import from browser-like environments (the Tauri
// renderer), which is why we split it out from `index.ts`. The IO half
// (loadKeybindings / saveKeybindings) imports from here.
export const DEFAULT_KEYBINDINGS = [
    { key: 'ctrl+a', action: 'cursor-line-start', description: 'Move to start of line.' },
    { key: 'ctrl+e', action: 'cursor-line-end', description: 'Move to end of line.' },
    { key: 'ctrl+k', action: 'kill-to-end', description: 'Kill from cursor to line end.' },
    { key: 'ctrl+u', action: 'kill-to-start', description: 'Kill from cursor to line start.' },
    { key: 'ctrl+l', action: '/clear', description: 'Clear conversation history.' },
    { key: 'esc esc', action: '/rewind', description: 'Open rewind picker.' },
    // Vim defaults (only fire when vim:true)
    { key: 'esc', action: 'vim-normal-mode', when: 'INSERT', description: 'Switch to NORMAL mode.' },
    { key: 'i', action: 'vim-insert-mode', when: 'NORMAL', description: 'Switch to INSERT mode.' },
    {
        key: 'a',
        action: 'vim-append-mode',
        when: 'NORMAL',
        description: 'Append (insert after cursor).',
    },
    { key: 'v', action: 'vim-visual-mode', when: 'NORMAL', description: 'Enter VISUAL mode.' },
    { key: '0', action: 'cursor-line-start', when: 'NORMAL' },
    { key: '$', action: 'cursor-line-end', when: 'NORMAL' },
    { key: 'g g', action: 'cursor-buffer-start', when: 'NORMAL' },
    { key: 'shift+g', action: 'cursor-buffer-end', when: 'NORMAL' },
    { key: 'd d', action: 'kill-line', when: 'NORMAL' },
    { key: 'y y', action: 'yank-line', when: 'NORMAL' },
    { key: 'p', action: 'paste-after', when: 'NORMAL' },
    { key: 'u', action: 'undo', when: 'NORMAL' },
];
/**
 * Look up the action for a chord. Returns undefined if no binding matches.
 * When vim mode is on, `when` restrictions apply; later entries override
 * earlier on identical chord+restriction.
 */
export function resolveKeyAction(chord, bindings, opts = {}) {
    const norm = normalizeChord(chord);
    let match;
    for (const b of bindings) {
        if (normalizeChord(b.key) !== norm)
            continue;
        if (b.when && (!opts.vim || b.when !== opts.vimMode))
            continue;
        match = b; // later wins
    }
    return match;
}
export function normalizeChord(chord) {
    return chord
        .trim()
        .split(/\s+/)
        .map((part) => part
        .toLowerCase()
        .split('+')
        .map((s) => s.trim())
        .sort((a, b) => modOrder(a) - modOrder(b))
        .join('+'))
        .join(' ');
}
function modOrder(s) {
    // Modifiers first (sorted), then the key
    switch (s) {
        case 'ctrl':
            return 0;
        case 'shift':
            return 1;
        case 'alt':
            return 2;
        case 'meta':
            return 3;
        default:
            return 10;
    }
}
export class VimState {
    mode = 'INSERT';
    /** Buffer of pending chord chars (for multi-char NORMAL sequences like `gg`). */
    pending = '';
    /** Most recently yanked text. */
    yanked = '';
    /**
     * Feed one key event; return the resolved action label (or undefined if
     * still accumulating). Pure function over (state, input).
     */
    feed(chord, bindings) {
        if (this.mode === 'INSERT') {
            // INSERT mode only accepts the esc binding from defaults
            const bind = resolveKeyAction(chord, bindings, { vim: true, vimMode: 'INSERT' });
            if (bind) {
                this.applyAction(bind.action);
                return bind.action;
            }
            return undefined;
        }
        // NORMAL or VISUAL — possibly multi-char chord
        const combined = this.pending ? `${this.pending} ${chord}` : chord;
        const bind = resolveKeyAction(combined, bindings, {
            vim: true,
            vimMode: this.mode,
        });
        if (bind) {
            this.pending = '';
            this.applyAction(bind.action);
            return bind.action;
        }
        // No exact match — see if this is a prefix of any binding
        const prefix = bindings.some((b) => b.when === this.mode && normalizeChord(b.key).startsWith(normalizeChord(combined) + ' '));
        if (prefix) {
            this.pending = combined;
            return undefined;
        }
        this.pending = '';
        return undefined;
    }
    applyAction(action) {
        switch (action) {
            case 'vim-normal-mode':
                this.mode = 'NORMAL';
                break;
            case 'vim-insert-mode':
                this.mode = 'INSERT';
                break;
            case 'vim-append-mode':
                this.mode = 'INSERT';
                break;
            case 'vim-visual-mode':
                this.mode = 'VISUAL';
                break;
            // Other actions don't change mode here; the host applies them.
        }
    }
}
//# sourceMappingURL=vim.js.map