// Pure (no node:fs) parts of the keybindings module — types,
// DEFAULT_KEYBINDINGS, resolveKeyAction, normalizeChord, VimState.
//
// This file is safe to import from browser-like environments (the Tauri
// renderer), which is why we split it out from `index.ts`. The IO half
// (loadKeybindings / saveKeybindings) imports from here.

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

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
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
export function resolveKeyAction(
  chord: string,
  bindings: KeyBinding[],
  opts: KeyResolveOpts = {},
): KeyBinding | undefined {
  const norm = normalizeChord(chord);
  let match: KeyBinding | undefined;
  for (const b of bindings) {
    if (normalizeChord(b.key) !== norm) continue;
    if (b.when && (!opts.vim || b.when !== opts.vimMode)) continue;
    match = b; // later wins
  }
  return match;
}

export function normalizeChord(chord: string): string {
  return chord
    .trim()
    .split(/\s+/)
    .map((part) =>
      part
        .toLowerCase()
        .split('+')
        .map((s) => s.trim())
        .sort((a, b) => modOrder(a) - modOrder(b))
        .join('+'),
    )
    .join(' ');
}

function modOrder(s: string): number {
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

// ──────────────────────────────────────────────────────────────────────────
// Vim mode state machine — minimal NORMAL / INSERT / VISUAL
// ──────────────────────────────────────────────────────────────────────────

export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL';

export class VimState {
  mode: VimMode = 'INSERT';
  /** Buffer of pending chord chars (for multi-char NORMAL sequences like `gg`). */
  pending = '';
  /** Most recently yanked text. */
  yanked = '';

  /**
   * Feed one key event; return the resolved action label (or undefined if
   * still accumulating). Pure function over (state, input).
   */
  feed(chord: string, bindings: KeyBinding[]): string | undefined {
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
    const prefix = bindings.some(
      (b) =>
        b.when === this.mode && normalizeChord(b.key).startsWith(normalizeChord(combined) + ' '),
    );
    if (prefix) {
      this.pending = combined;
      return undefined;
    }
    this.pending = '';
    return undefined;
  }

  private applyAction(action: string): void {
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
