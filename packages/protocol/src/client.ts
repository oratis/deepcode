import { encodeProtocolMessage } from './codec.js';
import {
  PROTOCOL_VERSION,
  type InitializeResult,
  type ProtocolEvent,
  type ProtocolMethod,
  type ProtocolRequest,
  type ProtocolResponse,
} from './types.js';

/** A transport owns one ordered, newline-free protocol message stream. */
export interface ProtocolClientConnection {
  open(onMessage: (message: string) => void, onDisconnect: (error: Error) => void): Promise<void>;
  send(message: string): Promise<void>;
  close(): Promise<void>;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Provider- and host-neutral app-server client. Desktop, editors, and tests
 * supply only their connection adapter; request correlation, initialization,
 * disconnect behavior, and event fan-out stay identical across surfaces.
 */
export class ProtocolClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly subscribers = new Set<(event: ProtocolEvent) => void>();
  private nextId = 1;
  private opened = false;
  private initialized?: InitializeResult;
  private connecting?: Promise<InitializeResult>;

  constructor(
    private readonly connection: ProtocolClientConnection,
    private readonly timeoutMs = 30_000,
  ) {}

  async connect(): Promise<InitializeResult> {
    if (this.initialized) return this.initialized;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  subscribe(handler: (event: ProtocolEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  async request<T>(method: ProtocolMethod, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.opened) throw new Error('app-server client is not connected');
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
      await this.connection.send(encodeProtocolMessage(request));
    } catch (error) {
      this.rejectRequest(id, asError(error));
    }
    return response;
  }

  async close(): Promise<void> {
    this.disconnect(new Error('app-server client closed'));
    await this.connection.close();
  }

  private async open(): Promise<InitializeResult> {
    if (!this.opened) {
      await this.connection.open(
        (message) => this.receive(message),
        (error) => this.disconnect(error),
      );
      this.opened = true;
    }
    const initialized = await this.request<InitializeResult>('initialize');
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      await this.close();
      throw new Error(`Unsupported app-server protocol version: ${initialized.protocolVersion}`);
    }
    this.initialized = initialized;
    return initialized;
  }

  private receive(raw: string): void {
    let message: ProtocolResponse | { method: 'event'; params: ProtocolEvent };
    try {
      message = JSON.parse(raw) as ProtocolResponse | { method: 'event'; params: ProtocolEvent };
    } catch {
      this.disconnect(new Error('app-server emitted invalid JSON'));
      return;
    }
    if ('method' in message) {
      if (message.method === 'event') {
        for (const subscriber of this.subscribers) subscriber(message.params);
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.result);
  }

  private disconnect(error: Error): void {
    this.opened = false;
    this.initialized = undefined;
    this.rejectAll(error);
  }

  private rejectRequest(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) this.rejectRequest(id, error);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
