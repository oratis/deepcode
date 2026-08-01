export const PROTOCOL_VERSION = 1 as const;

export type TurnStatus = 'in_progress' | 'completed' | 'interrupted' | 'failed';
export type CompletedItemType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'approval'
  | 'ask_user'
  | 'error';

export interface CompletedItem {
  id: string;
  type: CompletedItemType;
  payload: Record<string, unknown>;
  completedAt: string;
}

export interface TurnSnapshot {
  id: string;
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
  | { type: 'thread.started'; thread: ThreadSnapshot }
  | { type: 'turn.started'; threadId: string; turn: TurnSnapshot }
  | { type: 'item.completed'; threadId: string; turnId: string; item: CompletedItem }
  | { type: 'turn.completed'; threadId: string; turn: TurnSnapshot }
  | { type: 'turn.interrupted'; threadId: string; turn: TurnSnapshot }
  | { type: 'turn.failed'; threadId: string; turn: TurnSnapshot };

export interface ToolStartedEvent {
  type: 'tool.started';
  threadId: string;
  turnId: string;
  itemId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCompletedEvent {
  type: 'tool.completed';
  threadId: string;
  turnId: string;
  itemId: string;
  result: { content: string; isError?: boolean };
}

export interface UsageUpdatedEvent {
  type: 'usage.updated';
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
  threadId: string;
  turnId: string;
  requestId: string;
  toolName: string;
  reason: string;
}

export interface UserInputRequestedEvent {
  type: 'user-input.requested';
  threadId: string;
  turnId: string;
  requestId: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

export interface TransientDeltaEvent {
  type: 'item.delta';
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export type TransientProtocolEvent =
  | TransientDeltaEvent
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
  };
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

export type ProtocolMethod =
  | 'initialize'
  | 'config/diagnostics'
  | 'thread/start'
  | 'thread/read'
  | 'thread/resume'
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
