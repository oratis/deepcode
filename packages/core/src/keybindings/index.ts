// Keybindings — ~/.deepcode/keybindings.json schema + loader + lookup.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M8)
//
// Each entry maps a key chord to an action. Actions can be:
//   · A slash command (`"action": "/help"`)
//   · A literal string insertion (`"action": "insert:hello"`)
//   · A built-in action name (`"action": "clear-input"`)
//
// Key chord syntax: modifiers separated by `+`, key last. Examples:
//   "ctrl+a"       (start of line)
//   "ctrl+shift+t" (open in new tab)
//   "esc esc"      (sequence — two escapes)
//   "g g"          (Vim — two g's; vim-mode only)
//
// We don't enforce uniqueness — the most-specific match wins, with later
// entries overriding earlier on tie.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface KeyBinding {
  /** Whitespace-separated chord sequence (e.g. "ctrl+a" or "esc esc"). */
  key: string;
  /** Action — see header for the 3 forms. */
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

export function keybindingsPath(home: string): string {
  return join(home, '.deepcode', 'keybindings.json');
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
  { key: 'a', action: 'vim-append-mode', when: 'NORMAL', description: 'Append (insert after cursor).' },
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

export async function loadKeybindings(home: string = homedir()): Promise<{
  config: KeybindingsConfig;
  bindings: KeyBinding[];
}> {
  let user: KeybindingsConfig = {};
  try {
    const raw = await fs.readFile(keybindingsPath(home), 'utf8');
    user = JSON.parse(raw) as KeybindingsConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  const bindings = [...DEFAULT_KEYBINDINGS, ...(user.bindings ?? [])];
  return {
    config: { enabled: user.enabled ?? true, vim: user.vim ?? false, bindings: user.bindings },
    bindings,
  };
}

export async function saveKeybindings(
  config: KeybindingsConfig,
  home: string = homedir(),
): Promise<void> {
  const path = keybindingsPath(home);
  await fs.mkdir(join(home, '.deepcode'), { recursive: true });
  await fs.writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

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
