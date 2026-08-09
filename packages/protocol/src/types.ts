export const PROTOCOL_VERSION = 1 as const;

export type TurnStatus = 'in_progress' | 'completed' | 'interrupted' | 'failed';
export type CompletedItemType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'approval'
  | 'ask_user'
  | 'review_finding'
  | 'review_action'
  | 'error';

export interface CompletedItem {
  id: string;
  type: CompletedItemType;
  payload: Record<string, unknown>;
  completedAt: string;
}

export interface TurnSnapshot {
  id: string;
  /** Host-generated correlation id. Optional when reading pre-tracing snapshots. */
  traceId?: string;
  threadId: string;
  status: TurnStatus;
  startedAt: string;
  completedAt?: string;
  items: CompletedItem[];
}

export interface ThreadSnapshot {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  turns: TurnSnapshot[];
}

export type DurableProtocolEvent =
  | { type: 'thread.started'; traceId?: string; thread: ThreadSnapshot }
  | { type: 'turn.started'; traceId?: string; threadId: string; turn: TurnSnapshot }
  | {
      type: 'item.completed';
      traceId?: string;
      threadId: string;
      turnId: string;
      item: CompletedItem;
    }
  | { type: 'turn.completed'; traceId?: string; threadId: string; turn: TurnSnapshot }
  | { type: 'turn.interrupted'; traceId?: string; threadId: string; turn: TurnSnapshot }
  | { type: 'turn.failed'; traceId?: string; threadId: string; turn: TurnSnapshot };

export interface ToolStartedEvent {
  type: 'tool.started';
  traceId?: string;
  threadId: string;
  turnId: string;
  itemId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCompletedEvent {
  type: 'tool.completed';
  traceId?: string;
  threadId: string;
  turnId: string;
  itemId: string;
  result: { content: string; isError?: boolean };
}

export interface UsageUpdatedEvent {
  type: 'usage.updated';
  traceId?: string;
  threadId: string;
  turnId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
  };
}

export interface ApprovalRequestedEvent {
  type: 'approval.requested';
  traceId?: string;
  threadId: string;
  turnId: string;
  requestId: string;
  toolName: string;
  reason: string;
}

export interface UserInputRequestedEvent {
  type: 'user-input.requested';
  traceId?: string;
  threadId: string;
  turnId: string;
  requestId: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

export interface TransientDeltaEvent {
  type: 'item.delta';
  traceId?: string;
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

/**
 * A reasoning delta from a model that produces one (DeepSeek's reasoner).
 *
 * Separate from `item.delta` rather than a flag on it: reasoning is not the
 * answer, it is never persisted as a completed item, and a client that doesn't
 * understand it must be able to drop it without accidentally rendering it as
 * assistant text. Gated by the `reasoningDeltas` capability.
 */
export interface ReasoningDeltaEvent {
  type: 'reasoning.delta';
  traceId?: string;
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export type TransientProtocolEvent =
  | TransientDeltaEvent
  | ReasoningDeltaEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | UsageUpdatedEvent
  | ApprovalRequestedEvent
  | UserInputRequestedEvent;

export type ProtocolEvent = DurableProtocolEvent | TransientProtocolEvent;

export interface InitializeResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  capabilities: {
    threadResume: true;
    turnInterrupt: true;
    completedItemPersistence: true;
    transientDeltas: true;
    structuredToolEvents: true;
    interactiveRequests: true;
    configDiagnostics: boolean;
    diagnosticExport: boolean;
    workspaceDiff: boolean;
    reviewActions: boolean;
    /** Server streams `reasoning.delta` for models that emit reasoning. */
    reasoningDeltas: boolean;
    /**
     * `thread/list`, `thread/fork`, `thread/archive` and `thread/delete` are
     * served. Without these a client has to read the session directory itself,
     * which is how the desktop ended up with two ways to see the same threads —
     * and, for delete, two ways to remove a file the app-server owns.
     */
    threadManagement: boolean;
    /**
     * `runtime/capabilities` is served. Distinct from the flags above: those
     * say which protocol features exist, this one says what the runtime will
     * write and what it always stops to ask about.
     */
    runtimeCapabilities: boolean;
  };
}

/**
 * What the runtime may write, and which actions always need a human.
 *
 * Deliberately not folded into `InitializeResult.capabilities`. That object
 * answers "which protocol methods work"; this one answers "what is this
 * runtime allowed to do to my machine". Keeping them apart is what stops the
 * next field from landing in the wrong one.
 */
export interface RuntimeCapabilitiesResult {
  writeScope: string[];
  confirmationRequired: string[];
  sandbox: { mode: string; effective: boolean };
  permissions: {
    mode: string;
    fileContract: 'absent' | 'loaded' | 'invalid';
    ruleCounts: { allow: number; ask: number; deny: number };
  };
  ledger: { enabled: boolean; path: string };
  modules: Record<string, 'enabled' | 'disabled'>;
}

export type ConfigLayerName = 'user' | 'project' | 'local' | 'override';

export interface ConfigDiagnosticsResult {
  cwd: string;
  trustStatus: 'trusted' | 'plan-only' | 'untrusted';
  layers: Array<{
    layer: ConfigLayerName;
    path: string;
    present: boolean;
    trusted: boolean;
  }>;
  provenance: Record<string, { layer: ConfigLayerName; path: string }>;
  gated: string[];
  issues: Array<{
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    pointer?: string;
    source?: { layer: ConfigLayerName; path: string };
  }>;
}

export interface DiagnosticExportResult {
  path: string;
  generatedAt: string;
  recordCount: number;
}

export type WorkspaceFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';
export type WorkspaceDiffLineKind = 'context' | 'addition' | 'deletion';

export interface WorkspaceDiffLine {
  kind: WorkspaceDiffLineKind;
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface WorkspaceDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: WorkspaceDiffLine[];
}

export interface WorkspaceDiffFile {
  path: string;
  previousPath?: string;
  status: WorkspaceFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
  hunks: WorkspaceDiffHunk[];
}

export interface WorkspaceDiffResult {
  repository: boolean;
  base: 'HEAD' | 'empty' | null;
  files: WorkspaceDiffFile[];
  truncated: boolean;
}

export interface ReviewFindingPayload {
  findingId: string;
  title: string;
  body: string;
  path: string;
  startLine: number;
  endLine: number;
  priority: 0 | 1 | 2 | 3;
  replacement?: string;
}

export type ReviewActionRequest =
  | { kind: 'apply'; findingIds: string[] }
  | { kind: 'revert'; sourceActionId: string; findingIds: string[] };

export type ReviewActionPayload = ReviewActionRequest & { actionId: string };

/** A thread as it appears in a list — enough to render a picker, no turns. */
export interface ThreadListEntry {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  /** First user message, truncated — absent for a thread with no turns yet. */
  title?: string;
  turnCount: number;
  archived?: boolean;
}

export interface ThreadListResult {
  threads: ThreadListEntry[];
}

export type ProtocolMethod =
  | 'initialize'
  | 'runtime/capabilities'
  | 'config/diagnostics'
  | 'diagnostics/export'
  | 'workspace/diff'
  | 'review/apply'
  | 'review/revert'
  | 'thread/start'
  | 'thread/read'
  | 'thread/resume'
  | 'thread/list'
  | 'thread/fork'
  | 'thread/archive'
  | 'thread/delete'
  | 'turn/start'
  | 'turn/interrupt'
  | 'approval/respond'
  | 'user-input/respond';

export interface ProtocolRequest {
  id: string | number;
  method: ProtocolMethod;
  params: Record<string, unknown>;
}

export interface ProtocolResponse {
  id: string | number | null;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface ProtocolNotification {
  method: 'event';
  params: ProtocolEvent;
}
