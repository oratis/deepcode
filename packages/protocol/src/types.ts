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

export interface TransientDeltaEvent {
  type: 'item.delta';
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export type ProtocolEvent = DurableProtocolEvent | TransientDeltaEvent;

export interface InitializeResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  capabilities: {
    threadResume: true;
    turnInterrupt: true;
    completedItemPersistence: true;
    transientDeltas: true;
  };
}

export type ProtocolMethod =
  | 'initialize'
  | 'thread/start'
  | 'thread/read'
  | 'thread/resume'
  | 'turn/start'
  | 'turn/interrupt';

export interface ProtocolRequest {
  id: string | number;
  method: ProtocolMethod;
  params: Record<string, unknown>;
}

export interface ProtocolResponse {
  id: string | number;
  result?: unknown;
  error?: { code: string; message: string };
}
