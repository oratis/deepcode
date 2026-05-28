import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  loadKeybindings,
  normalizeChord,
  resolveKeyAction,
  saveKeybindings,
  VimState,
} from './index.js';

describe('normalizeChord', () => {
  it('sorts modifiers consistently', () => {
    expect(normalizeChord('Shift+Ctrl+A')).toBe(normalizeChord('ctrl+shift+a'));
    expect(normalizeChord('Alt+Ctrl+Shift+B')).toBe(normalizeChord('ctrl+shift+alt+b'));
  });
  it('preserves multi-chord sequences', () => {
    expect(normalizeChord('esc esc')).toBe('esc esc');
    expect(normalizeChord('g g')).toBe('g g');
  });
});

describe('resolveKeyAction', () => {
  it('finds default ctrl+a', () => {
    const b = resolveKeyAction('ctrl+a', DEFAULT_KEYBINDINGS);
    expect(b?.action).toBe('cursor-line-start');
  });
  it('finds esc esc multi-chord', () => {
    const b = resolveKeyAction('esc esc', DEFAULT_KEYBINDINGS);
    expect(b?.action).toBe('/rewind');
  });
  it('respects vim `when` restriction', () => {
    // `i` is INSERT-vim only when vim is enabled and mode is NORMAL
    expect(resolveKeyAction('i', DEFAULT_KEYBINDINGS)).toBeUndefined();
    const b = resolveKeyAction('i', DEFAULT_KEYBINDINGS, { vim: true, vimMode: 'NORMAL' });
    expect(b?.action).toBe('vim-insert-mode');
  });
  it('returns undefined for unknown chord', () => {
    expect(resolveKeyAction('ctrl+xyz', DEFAULT_KEYBINDINGS)).toBeUndefined();
  });
  it('later entries override earlier on conflict', () => {
    const custom = [
      { key: 'ctrl+a', action: 'orig' },
      { key: 'ctrl+a', action: 'override' },
    ];
    expect(resolveKeyAction('ctrl+a', custom)?.action).toBe('override');
  });
});

describe('loadKeybindings / saveKeybindings', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-kb-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('returns defaults when no file exists', async () => {
    const { bindings, config } = await loadKeybindings(home);
    expect(config.enabled).toBe(true);
    expect(config.vim).toBe(false);
    expect(bindings).toContain(DEFAULT_KEYBINDINGS[0]);
  });

  it('merges user bindings after defaults', async () => {
    await fs.mkdir(join(home, '.deepcode'), { recursive: true });
    await saveKeybindings(
      { enabled: true, vim: true, bindings: [{ key: 'ctrl+m', action: '/mode' }] },
      home,
    );
    const { config, bindings } = await loadKeybindings(home);
    expect(config.vim).toBe(true);
    expect(resolveKeyAction('ctrl+m', bindings)?.action).toBe('/mode');
  });

  it('rethrows on malformed JSON', async () => {
    await fs.mkdir(join(home, '.deepcode'), { recursive: true });
    await fs.writeFile(join(home, '.deepcode', 'keybindings.json'), '{ broken', 'utf8');
    await expect(loadKeybindings(home)).rejects.toThrow();
  });
});

describe('VimState', () => {
  it('starts in INSERT mode', () => {
    expect(new VimState().mode).toBe('INSERT');
  });

  it('esc in INSERT switches to NORMAL', () => {
    const s = new VimState();
    s.feed('esc', DEFAULT_KEYBINDINGS);
    expect(s.mode).toBe('NORMAL');
  });

  it('i in NORMAL switches to INSERT', () => {
    const s = new VimState();
    s.mode = 'NORMAL';
    s.feed('i', DEFAULT_KEYBINDINGS);
    expect(s.mode).toBe('INSERT');
  });

  it('a in NORMAL switches to INSERT (append)', () => {
    const s = new VimState();
    s.mode = 'NORMAL';
    s.feed('a', DEFAULT_KEYBINDINGS);
    expect(s.mode).toBe('INSERT');
  });

  it('v in NORMAL enters VISUAL', () => {
    const s = new VimState();
    s.mode = 'NORMAL';
    s.feed('v', DEFAULT_KEYBINDINGS);
    expect(s.mode).toBe('VISUAL');
  });

  it('gg multi-chord resolves to cursor-buffer-start', () => {
    const s = new VimState();
    s.mode = 'NORMAL';
    expect(s.feed('g', DEFAULT_KEYBINDINGS)).toBeUndefined(); // pending
    expect(s.pending).toBe('g');
    const action = s.feed('g', DEFAULT_KEYBINDINGS);
    expect(action).toBe('cursor-buffer-start');
    expect(s.pending).toBe('');
  });

  it('unknown chord after a prefix clears pending', () => {
    const s = new VimState();
    s.mode = 'NORMAL';
    s.feed('g', DEFAULT_KEYBINDINGS);
    expect(s.pending).toBe('g');
    const action = s.feed('z', DEFAULT_KEYBINDINGS);
    expect(action).toBeUndefined();
    expect(s.pending).toBe('');
  });

  it('NORMAL-mode-only chord does not fire in INSERT', () => {
    const s = new VimState(); // INSERT
    expect(s.feed('i', DEFAULT_KEYBINDINGS)).toBeUndefined();
  });
});
