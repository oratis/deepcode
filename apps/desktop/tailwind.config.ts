// Tailwind config — DeepCode desktop client.
// Milestone: M6-rest
//
// Color tokens match docs/VISUAL_DESIGN.html. Dark theme is the only mode
// shipped at v1 (matches Claude Code's look).

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: '#0e0e10',
        'bg-elevated': '#18181b',
        fg: '#f4f4f5',
        muted: '#71717a',
        accent: '#a3e635',
        error: '#f87171',
        border: '#27272a',
      },
      fontFamily: {
        sans: ['ui-sans-serif', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
