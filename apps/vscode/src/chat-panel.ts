import type { ProtocolEvent } from '@deepcode/protocol';
import type { StartEditorTurn } from './protocol-runtime.js';

export type ChatStatus =
  | 'ready'
  | 'starting'
  | 'working'
  | 'approval'
  | 'input'
  | 'cancelling'
  | 'completed'
  | 'interrupted'
  | 'disconnected'
  | 'failed';

export type ChatPanelMessage =
  | { kind: 'status'; status: ChatStatus; detail?: string }
  | { kind: 'thread'; id: string }
  | { kind: 'message'; id: string; role: 'user' | 'assistant' | 'notice' | 'error'; text: string }
  | { kind: 'delta'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      name?: string;
      summary?: string;
      input?: string;
      output?: string;
      status: 'running' | 'completed' | 'failed' | 'unsettled';
    }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'reset' };

interface ChatRuntime {
  start(
    input: StartEditorTurn,
    onEvent: (event: ProtocolEvent) => void,
  ): Promise<{ threadId: string; turnId: string }>;
  interrupt(turnId: string): Promise<boolean>;
  subscribeDisconnect(handler: (error: Error) => void): () => void;
}

interface ActiveRun {
  turnId?: string;
  cancelRequested: boolean;
  interruptSent: boolean;
  segment: number;
  streamed: boolean;
  tools: Set<string>;
  interactions: Map<string, 'approval' | 'input'>;
}

/** Presentation-only controller; the app-server remains the permission and turn owner. */
export class ChatPanelController {
  private active?: ActiveRun;
  private status: ChatPanelMessage = { kind: 'status', status: 'ready' };
  private readonly transcript: ChatPanelMessage[] = [];
  private nextId = 0;
  private readonly unsubscribeDisconnect: () => void;

  constructor(
    private readonly runtime: ChatRuntime,
    private readonly post: (message: ChatPanelMessage) => void,
    private readonly input: (text: string) => StartEditorTurn,
    private readonly interact: (event: ProtocolEvent) => Promise<void>,
  ) {
    this.unsubscribeDisconnect = runtime.subscribeDisconnect((error) => this.disconnected(error));
  }

  dispose(): void {
    this.unsubscribeDisconnect();
  }

  private disconnected(error: Error): void {
    const run = this.active;
    this.active = undefined;
    if (run) {
      for (const id of run.tools) {
        this.emit({
          kind: 'tool',
          id,
          status: 'unsettled',
          output:
            'Connection lost before a tool result was received. Its effects are unknown; inspect the workspace before retrying.',
        });
      }
    }
    this.error(`Connection lost: ${error.message}`);
    this.setStatus(
      'disconnected',
      'The turn outcome is unknown. Review the workspace before continuing. Send a new message to reconnect; the previous request will not be retried automatically.',
    );
  }

  async receive(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const value = message as { kind?: unknown; text?: unknown };
    if (value.kind === 'ready') {
      this.post({ kind: 'reset' });
      for (const item of this.transcript) this.post(item);
      this.post(this.status);
    } else if (value.kind === 'stop') {
      await this.stop();
    } else if (value.kind === 'send' && typeof value.text === 'string' && value.text.trim()) {
      if (this.active) return;
      await this.start(value.text);
    }
  }

  private async start(text: string): Promise<void> {
    const run: ActiveRun = {
      cancelRequested: false,
      interruptSent: false,
      segment: 0,
      streamed: false,
      tools: new Set(),
      interactions: new Map(),
    };
    this.active = run;
    this.emit({ kind: 'message', id: `user-${++this.nextId}`, role: 'user', text });
    this.setStatus('starting');
    try {
      const started = await this.runtime.start(this.input(text), (event) => this.event(run, event));
      this.emit({ kind: 'thread', id: started.threadId });
      // A fast terminal event may arrive before turn/start resolves.
      if (this.active !== run) return;
      run.turnId = started.turnId;
      if (run.cancelRequested) await this.interrupt(run);
    } catch (error) {
      if (this.active !== run) return;
      this.active = undefined;
      this.error(error);
      this.setStatus('failed', 'The turn could not start. Your request is kept above.');
    }
  }

  private async stop(): Promise<void> {
    const run = this.active;
    if (!run || run.cancelRequested) return;
    run.cancelRequested = true;
    this.setStatus('cancelling', 'Waiting for the backend to stop the turn.');
    if (run.turnId) await this.interrupt(run);
  }

  private async interrupt(run: ActiveRun): Promise<void> {
    if (!run.turnId || run.interruptSent || this.active !== run) return;
    run.interruptSent = true;
    try {
      const interrupted = await this.runtime.interrupt(run.turnId);
      // Acknowledgement alone is not a terminal event. Keep Send blocked until settlement.
      if (!interrupted && this.active === run) {
        run.cancelRequested = false;
        run.interruptSent = false;
        this.setStatus('working', 'Stop was not accepted. You can try again.');
      }
    } catch (error) {
      if (this.active !== run) return;
      run.cancelRequested = false;
      run.interruptSent = false;
      this.error(error);
      this.setStatus('working', 'Stop failed; the turn may still be running. Try Stop again.');
    }
  }

  private event(run: ActiveRun, event: ProtocolEvent): void {
    if (this.active !== run) return;
    switch (event.type) {
      case 'turn.started':
        run.turnId = event.turn.id;
        this.emit({ kind: 'thread', id: event.threadId });
        if (!run.cancelRequested) this.setStatus('working');
        break;
      case 'item.delta':
        run.streamed = true;
        this.emit({
          kind: 'delta',
          id: `${event.turnId}:${event.itemId}:${run.segment}`,
          text: event.delta,
        });
        break;
      case 'tool.started':
        run.segment++;
        run.tools.add(toolKey(event.turnId, event.itemId));
        this.emit({
          kind: 'tool',
          id: toolKey(event.turnId, event.itemId),
          name: event.name,
          summary: toolSummary(event.input),
          input: bounded(JSON.stringify(event.input, null, 2)),
          status: 'running',
        });
        break;
      case 'tool.completed':
        run.tools.delete(toolKey(event.turnId, event.itemId));
        this.emit({
          kind: 'tool',
          id: toolKey(event.turnId, event.itemId),
          output: bounded(event.result.content),
          status: event.result.isError ? 'failed' : 'completed',
        });
        break;
      case 'approval.requested':
      case 'user-input.requested': {
        if (run.interactions.has(event.requestId)) break;
        run.segment++;
        const approval = event.type === 'approval.requested';
        run.interactions.set(event.requestId, approval ? 'approval' : 'input');
        if (!run.cancelRequested) this.setStatus(approval ? 'approval' : 'input');
        this.emit({
          kind: 'message',
          id: event.requestId,
          role: 'notice',
          text: approval
            ? `Approval needed · ${event.toolName}\n${event.reason}\nRespond in the VS Code notification.`
            : `Input needed\n${event.question}\nRespond in the VS Code input picker.`,
        });
        if (run.cancelRequested) break;
        void this.interact(event)
          .then(() => {
            run.interactions.delete(event.requestId);
            if (this.active === run && !run.cancelRequested) {
              this.setStatus(run.interactions.values().next().value ?? 'working');
            }
          })
          .catch((error: unknown) => {
            // Dismissed or late native prompts must not become unhandled rejections.
            if (this.active === run && !run.cancelRequested) this.error(error);
          });
        break;
      }
      case 'usage.updated':
        this.emit({
          kind: 'usage',
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
        });
        break;
      case 'item.completed':
        if (event.item.type === 'assistant_message' && !run.streamed) {
          const text = assistantText(event.item.payload);
          if (text) this.emit({ kind: 'message', id: event.item.id, role: 'assistant', text });
        } else if (event.item.type === 'review_finding') {
          const p = event.item.payload;
          this.emit({
            kind: 'message',
            id: event.item.id,
            role: 'notice',
            text: `Review · ${String(p.title)}\n${String(p.path)}:${String(p.startLine)}\n${String(p.body)}`,
          });
        }
        break;
      case 'turn.completed':
      case 'turn.interrupted':
      case 'turn.failed': {
        for (const id of run.tools)
          this.emit({
            kind: 'tool',
            id,
            status: 'unsettled',
            output:
              'No tool result was reported before the turn ended. Check the workspace before retrying.',
          });
        this.active = undefined;
        const status =
          event.type === 'turn.completed'
            ? 'completed'
            : event.type === 'turn.interrupted'
              ? 'interrupted'
              : 'failed';
        this.setStatus(status);
        if (status === 'failed') {
          const error = [...event.turn.items].reverse().find((item) => item.type === 'error');
          this.error(
            error?.payload.message ?? 'The turn failed. Review the output before retrying.',
          );
        } else {
          this.emit({
            kind: 'message',
            id: `${event.turn.id}:end`,
            role: 'notice',
            text: status === 'interrupted' ? 'Turn interrupted' : 'Turn completed',
          });
        }
        break;
      }
    }
  }

  private error(error: unknown): void {
    this.emit({
      kind: 'message',
      id: `error-${++this.nextId}`,
      role: 'error',
      text: error instanceof Error ? error.message : String(error),
    });
  }

  private setStatus(status: ChatStatus, detail?: string): void {
    this.status = { kind: 'status', status, ...(detail ? { detail } : {}) };
    this.post(this.status);
  }

  private emit(message: ChatPanelMessage): void {
    const previous = this.transcript.at(-1);
    // Coalesce adjacent deltas for hidden/recreated views without changing the live stream.
    if (message.kind === 'delta' && previous?.kind === 'delta' && previous.id === message.id) {
      previous.text += message.text;
    } else {
      this.transcript.push({ ...message });
    }
    this.post(message);
  }
}

function toolSummary(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    if (typeof input[key] === 'string') return input[key].slice(0, 160);
  }
  return JSON.stringify(input).slice(0, 160);
}

function toolKey(turnId: string, itemId: string): string {
  return JSON.stringify([turnId, itemId]);
}

function bounded(text: string): string {
  return text.length > 24_000
    ? `${text.slice(0, 16_000)}\n… ${text.length - 24_000} characters omitted from the middle. Output shortened in this view. …\n${text.slice(-8_000)}`
    : text;
}

function assistantText(payload: Record<string, unknown>): string {
  if (typeof payload.text === 'string') return payload.text;
  const message = payload.message as { content?: unknown } | undefined;
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .map((block: { type?: unknown; text?: unknown }) =>
      block?.type === 'text' && typeof block.text === 'string' ? block.text : '',
    )
    .join('');
}
