import { listen } from '@tauri-apps/api/event';
import {
  encodeProtocolMessage,
  type InitializeResult,
  type ProtocolEvent,
  type ProtocolMethod,
  type ProtocolRequest,
  type ProtocolResponse,
} from '@deepcode/protocol';

import { appServerSend, appServerStart, appServerStop } from './tauri-api.js';

export interface AppServerOutput {
  stream: 'stdout' | 'stderr' | 'error' | 'terminated';
  line: string;
  code?: number;
  signal?: number;
}

export interface ProtocolClientBridge {
  listen(handler: (output: AppServerOutput) => void): Promise<() => void>;
  start(): Promise<unknown>;
  send(message: string): Promise<void>;
  stop(): Promise<void>;
}

const tauriBridge: ProtocolClientBridge = {
  async listen(handler) {
    return listen<AppServerOutput>('app-server-output', (event) => handler(event.payload));
  },
  start: appServerStart,
  send: appServerSend,
  stop: appServerStop,
};

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class DesktopProtocolClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly subscribers = new Set<(event: ProtocolEvent) => void>();
  private nextId = 1;
  private unlisten?: () => void;

  constructor(
    private readonly bridge: ProtocolClientBridge = tauriBridge,
    private readonly timeoutMs = 30_000,
  ) {}

  async connect(): Promise<InitializeResult> {
    if (!this.unlisten) this.unlisten = await this.bridge.listen((output) => this.receive(output));
    await this.bridge.start();
    const initialized = await this.request<InitializeResult>('initialize');
    if (initialized.protocolVersion !== 1) {
      await this.close();
      throw new Error(`Unsupported app-server protocol version: ${initialized.protocolVersion}`);
    }
    return initialized;
  }

  subscribe(handler: (event: ProtocolEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  async request<T>(method: ProtocolMethod, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    const request: ProtocolRequest = { id, method, params };
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });
    try {
      await this.bridge.send(encodeProtocolMessage(request));
    } catch (error) {
      this.rejectRequest(id, error as Error);
    }
    return response;
  }

  async close(): Promise<void> {
    this.rejectAll(new Error('app-server client closed'));
    this.unlisten?.();
    this.unlisten = undefined;
    await this.bridge.stop();
  }

  private receive(output: AppServerOutput): void {
    if (output.stream === 'terminated') {
      this.rejectAll(
        new Error(
          `app-server terminated (code=${output.code ?? 'none'}, signal=${output.signal ?? 'none'})`,
        ),
      );
      return;
    }
    if (output.stream !== 'stdout') return;
    let message: ProtocolResponse | { method: 'event'; params: ProtocolEvent };
    try {
      message = JSON.parse(output.line) as
        | ProtocolResponse
        | { method: 'event'; params: ProtocolEvent };
    } catch {
      this.rejectAll(new Error('app-server emitted invalid JSON'));
      return;
    }
    if ('method' in message) {
      if (message.method === 'event') {
        for (const subscriber of this.subscribers) subscriber(message.params);
      }
      return;
    }
    if (message.id === null || typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.result);
  }

  private rejectRequest(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    for (const id of this.pending.keys()) this.rejectRequest(id, error);
  }
}
