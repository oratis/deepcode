// Compatibility bridge for panels that still address canonical sessions.
// The protocol agent publishes the active thread id here; canonical thread and
// session ids are identical during the rollout.

let activeSessionId: string | null = null;

/** Set (or clear, with null) the canonical session selected by the UI. */
export function setActiveSessionId(id: string | null): void {
  activeSessionId = id;
}

/** The current session id, or null before the first turn / after a reset. */
export function getActiveSessionId(): string | null {
  return activeSessionId;
}
