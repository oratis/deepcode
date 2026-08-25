// Tool-output spill — storage contract.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.1

/** Tool and call that produced a spilled artifact. Descriptive only — never consulted for access control. */
export interface SpillSource {
  /** The tool whose result was spilled (e.g. `Bash`). */
  toolName: string;
  /** The model-issued call id the result belongs to. */
  callId: string;
  /** Short human label for the artifact (e.g. `result`). */
  label: string;
}

/** One request to persist a tool result that was too large to show in full. */
export interface SaveTextRequest {
  source: SpillSource;
  /** The full text to persist. */
  content: string;
}

/** A saved artifact: where it went, how big it is, and how to get it back. */
export interface SpillRef {
  /**
   * Opaque model-facing handle. The local backend renders it as an absolute
   * file path; another backend could render a URI or key, so consumers show it
   * alongside `retrievalHint` rather than assuming `Read` always applies.
   */
  locator: string;
  /** Size of the persisted content in bytes. */
  bytes: number;
  /** Backend-specific instruction for retrieving the content. */
  retrievalHint: string;
}

/**
 * Storage for oversized tool output.
 *
 * A host that cannot persist (no session directory, or a renderer with no
 * filesystem) simply supplies no store — the policy still bounds what the model
 * sees, it just cannot offer retrieval.
 */
export interface SpillStore {
  /**
   * Persist text verbatim and return its locator.
   *
   * @param req The content to persist and the call that produced it.
   * @returns The saved artifact's locator, size, and retrieval hint.
   */
  saveText(req: SaveTextRequest): Promise<SpillRef>;
}
