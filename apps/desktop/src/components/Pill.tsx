// Pill — small rounded chip for the chat header (connected · model · approval).
// Optional leading dot for status indication (e.g. live connection).

import type { ReactNode } from 'react';

interface PillProps {
  /** Show a leading mint dot. */
  dot?: boolean;
  children: ReactNode;
}

export function Pill({ dot, children }: PillProps): JSX.Element {
  return (
    <span className="pill">
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}
