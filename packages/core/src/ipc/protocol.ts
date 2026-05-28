// IPC protocol between the Electron renderer and the main process.
// Spec: docs/DEVELOPMENT_PLAN.md §4
//
// Goals:
//   1. Type-safe channel names + payload shapes (no string-typed `ipc.invoke`).
//   2. Stream agent events (text_delta / tool_use / tool_result / usage /
//      turn_complete / error) one-way from main → renderer.
//   3. Same shape works for the future web SDK if we host the agent loop
//      out-of-process (just swap the transport).
//
// Channel naming convention: `<domain>:<verb>` for request/response invokes
// and `<domain>:event` for streamed events.

import type {
  AgentEvent,
  Mode,
  StoredMessage,
} from '../types.js';

// ──────────────────────────────────────────────────────────────────────────
// Request/response channels (renderer → main → reply)
// ──────────────────────────────────────────────────────────────────────────

export interface IpcRequestMap {
  'app:version': { req: void; res: string };
  'creds:load': { req: void; res: { hasKey: boolean; baseURL?: string } };
  'creds:save': { req: { apiKey: string; baseURL?: string }; res: boolean };
  'settings:load': { req: void; res: Record<string, unknown> };
  'sessions:list': {
    req: { limit?: number };
    res: Array<{ id: string; title?: string; cwd: string; updatedAt: string; model?: string }>;
  };
  'sessions:resume': {
    req: { id: string };
    res: { history: StoredMessage[]; sessionId: string };
  };
  'plugins:list': {
    req: void;
    res: Array<{
      name: string;
      version: string;
      enabled: boolean;
      sourceHash: string;
      trustedBy: 'user' | 'marketplace' | 'official';
      contributedHookEvents: string[];
    }>;
  };
  'plugins:install': { req: { spec: string }; res: { name: string; version: string } };
  'plugins:setEnabled': { req: { name: string; enabled: boolean }; res: boolean };
  'mcp:list': {
    req: void;
    res: Array<{
      name: string;
      status: 'connected' | 'failed' | 'disabled';
      toolCount?: number;
      error?: string;
    }>;
  };
  'skills:list': {
    req: void;
    res: Array<{
      name: string;
      description: string;
      source: 'builtin' | 'user' | 'project' | 'plugin';
      path: string;
    }>;
  };
  'skills:body': { req: { path: string }; res: string };
  /**
   * Start an agent turn. Returns a turnId that subsequent events are tagged
   * with via the 'agent:event' channel.
   */
  'agent:start': {
    req: {
      sessionId: string;
      userMessage: string;
      mode?: Mode;
      model?: string;
      allowedTools?: string[];
    };
    res: { turnId: string };
  };
  /** Abort an in-flight turn. */
  'agent:abort': { req: { turnId: string }; res: boolean };
  /**
   * Reply to an approval prompt that the agent surfaced via 'agent:event'
   * with type 'approval_request'.
   */
  'agent:approve': {
    req: { turnId: string; toolCallId: string; allow: boolean };
    res: void;
  };
  /** Reply to an AskUserQuestion prompt. */
  'agent:answer': {
    req: { turnId: string; questionId: string; answer: string };
    res: void;
  };
}

export type IpcChannel = keyof IpcRequestMap;

// ──────────────────────────────────────────────────────────────────────────
// One-way events (main → renderer)
// ──────────────────────────────────────────────────────────────────────────

export type AgentStreamEvent =
  | ({ kind: 'event' } & AgentEvent & { turnId: string })
  | { kind: 'approval_request'; turnId: string; toolCallId: string; toolName: string; toolInput: Record<string, unknown>; reason: string }
  | { kind: 'ask_user'; turnId: string; questionId: string; question: string; options: Array<{ label: string; description: string }>; multiSelect?: boolean }
  | { kind: 'turn_done'; turnId: string; stopReason: 'end_turn' | 'max_turns' | 'aborted' | 'error' };

export interface IpcEventMap {
  'agent:event': AgentStreamEvent;
  'updater:update-downloaded': { version: string; releaseNotes?: string };
}

export type IpcEventChannel = keyof IpcEventMap;

// ──────────────────────────────────────────────────────────────────────────
// Helpers for safer channel typing in the renderer/main code
// ──────────────────────────────────────────────────────────────────────────

/**
 * Type-level utility: pull out the request payload type for a channel.
 */
export type IpcRequest<C extends IpcChannel> = IpcRequestMap[C]['req'];
/**
 * Type-level utility: pull out the response type for a channel.
 */
export type IpcResponse<C extends IpcChannel> = IpcRequestMap[C]['res'];

/**
 * Generate a fresh turn ID — used by the main process when starting a turn.
 * Format: `turn-<timestamp36>-<random>`.
 */
export function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a fresh question ID for an AskUserQuestion prompt.
 */
export function newQuestionId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
