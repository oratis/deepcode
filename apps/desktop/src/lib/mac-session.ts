// The id of the session the agent is currently writing to. mac-agent owns the
// session lifecycle (lazy create on first turn, resume, clear) and publishes
// the active id here; mac-tools reads it to stamp file snapshots, and the file
// panel reads it to fetch those snapshots. Kept in its own tiny module so both
// sides depend on it without a mac-agent ↔ mac-tools import cycle.

let activeSessionId: string | null = null;

/** Set (or clear, with null) the session the tools should snapshot under. */
export function setActiveSessionId(id: string | null): void {
  activeSessionId = id;
}

/** The current session id, or null before the first turn / after a reset. */
export function getActiveSessionId(): string | null {
  return activeSessionId;
}
