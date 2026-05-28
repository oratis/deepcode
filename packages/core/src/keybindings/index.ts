// Keybindings — ~/.deepcode/keybindings.json loader + saver.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M8)
//
// The pure parts (types, DEFAULT_KEYBINDINGS, VimState, resolveKeyAction)
// live in `./vim.ts` so the Tauri renderer can import them without
// dragging node:fs. This module wraps those with disk IO.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { KeybindingsConfig, KeyBinding } from './vim.js';
import { DEFAULT_KEYBINDINGS } from './vim.js';

// Re-export the pure surface so existing callers don't have to chase the new path.
export {
  DEFAULT_KEYBINDINGS,
  VimState,
  normalizeChord,
  resolveKeyAction,
  type KeyBinding,
  type KeybindingsConfig,
  type KeyResolveOpts,
  type VimMode,
} from './vim.js';

export function keybindingsPath(home: string): string {
  return join(home, '.deepcode', 'keybindings.json');
}

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
