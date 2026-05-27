// @deepcode/shared-ui — shared types/constants for CLI + Mac client
// M0 skeleton — extended as CLI and desktop ship their UI surfaces.

export const BRAND_COLOR = '#4D6BFE';

/** Brand color tokens — used by both CLI ANSI palette and desktop theme. */
export const COLORS = {
  brand: BRAND_COLOR,
  brandDeep: '#2F49D1',
  accent: '#14E4A2',
  warn: '#FFB020',
  error: '#FF5470',
} as const;

/** Mode badge color mapping (visual parity between CLI and desktop). */
export const MODE_COLORS = {
  default: 'gray',
  acceptEdits: 'blue',
  plan: 'purple',
  auto: 'cyan',
  dontAsk: 'orange',
  bypassPermissions: 'orangeRed',
} as const;
