// Command palette that opens above the composer when the input starts with '/'.
// Presentational: the parent owns the selected index and the keyboard handling,
// because the arrow keys have to be intercepted in the textarea itself.

import type { JSX } from 'react';
import type { SlashCommand } from '../lib/slash-commands.js';

interface SlashPaletteProps {
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

export function SlashPalette({
  commands,
  activeIndex,
  onPick,
  onHover,
}: SlashPaletteProps): JSX.Element | null {
  if (commands.length === 0) return null;
  return (
    <div className="slash-palette" role="listbox" aria-label="Slash commands">
      {commands.map((c, i) => (
        <button
          type="button"
          key={c.name}
          role="option"
          aria-selected={i === activeIndex}
          className={'slash-row' + (i === activeIndex ? ' active' : '')}
          // Pick on mousedown: the composer must not lose focus first, or the
          // blur handler closes the palette before the click lands.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="slash-name">
            {c.name}
            {c.args ? <span className="slash-args"> {c.args}</span> : null}
          </span>
          <span className="slash-summary">{c.summary}</span>
        </button>
      ))}
    </div>
  );
}
