import {
  ProtocolClient,
  type InitializeResult,
  type ProtocolClientConnection,
  type ProtocolEvent,
  type ProtocolMethod,
} from '@deepcode/protocol';
import type { EditorProtocolClient } from './protocol-runtime.js';

/** Adds transport lifecycle notifications without inventing a protocol terminal event. */
export class EditorAppServerClient implements EditorProtocolClient {
  private client: ProtocolClient;
  private readonly eventHandlers = new Set<(event: ProtocolEvent) => void>();
  private readonly disconnectHandlers = new Set<(error: Error) => void>();
  private connectionEpoch = 0;
  private cleanup: Promise<void> = Promise.resolve();

  constructor(private readonly connection: ProtocolClientConnection) {
    this.client = this.createClient();
  }

  private createClient(): ProtocolClient {
    const client = new ProtocolClient({
      open: async (onMessage, onDisconnect) => {
        await this.cleanup;
        const epoch = ++this.connectionEpoch;
        let disconnected = false;
        await this.connection.open(
          (message) => {
            if (epoch !== this.connectionEpoch || disconnected) return;
            try {
              const frame: unknown = JSON.parse(message);
              if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
                throw new Error('Invalid protocol frame');
              }
            } catch {
              // ProtocolClient's parser otherwise disconnects privately. Close
              // our owned transport before exposing a reconnectable UI state.
              disconnected = true;
              const error = new Error('The app-server emitted an invalid protocol message.');
              onDisconnect(error);
              this.client = this.createClient();
              this.cleanup = this.connection.close();
              void this.cleanup.then(
                () => {
                  if (epoch === this.connectionEpoch) this.notifyDisconnect(error);
                },
                (cleanupError: unknown) => {
                  if (epoch === this.connectionEpoch) {
                    this.notifyDisconnect(
                      new Error(
                        `${error.message} Backend cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
                      ),
                    );
                  }
                  // Retain the rejected cleanup barrier. Reconnection cannot
                  // create a second owner when the old transport failed to close.
                },
              );
              return;
            }
            onMessage(message);
          },
          (error) => {
            if (epoch !== this.connectionEpoch || disconnected) return;
            disconnected = true;
            // Reject protocol requests before notifying UI subscribers. A request
            // timeout or a rejected Stop does not take this confirmed-loss path.
            onDisconnect(error);
            // A fresh client also discards an initialize promise that was racing
            // with the lost connection. Old callbacks remain fenced by epoch.
            this.client = this.createClient();
            this.notifyDisconnect(error);
          },
        );
      },
      send: (message) => this.connection.send(message),
      close: async () => {
        this.connectionEpoch++;
        await this.cleanup.catch(() => undefined);
        await this.connection.close();
      },
    });
    client.subscribe((event) => {
      for (const handler of this.eventHandlers) handler(event);
    });
    return client;
  }

  private notifyDisconnect(error: Error): void {
    for (const handler of this.disconnectHandlers) handler(error);
  }

  async connect(): Promise<InitializeResult> {
    try {
      return await this.client.connect();
    } catch (error) {
      // Do not let a startup rejection unlock the composer before the invalid
      // stream's cleanup notification has invalidated its original run.
      await this.cleanup;
      throw error;
    }
  }

  async request<T>(method: ProtocolMethod, params?: Record<string, unknown>): Promise<T> {
    try {
      return await this.client.request(method, params);
    } catch (error) {
      await this.cleanup;
      throw error;
    }
  }

  subscribe(handler: (event: ProtocolEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  subscribeDisconnect(handler: (error: Error) => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  async close(): Promise<void> {
    this.disconnectHandlers.clear();
    this.eventHandlers.clear();
    await this.client.close();
  }
}
