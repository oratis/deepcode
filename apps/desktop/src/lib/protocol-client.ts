import { listen } from '@tauri-apps/api/event';
import { ProtocolClient, type ProtocolClientConnection } from '@deepcode/protocol';

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

class TauriProtocolConnection implements ProtocolClientConnection {
  private unlisten?: () => void;

  constructor(private readonly bridge: ProtocolClientBridge) {}

  async open(onMessage: (message: string) => void, onDisconnect: (error: Error) => void) {
    this.unlisten = await this.bridge.listen((output) => {
      if (output.stream === 'stdout') {
        onMessage(output.line);
        return;
      }
      if (output.stream === 'terminated' || output.stream === 'error') {
        this.detach();
        onDisconnect(
          output.stream === 'terminated'
            ? new Error(
                `app-server terminated (code=${output.code ?? 'none'}, signal=${output.signal ?? 'none'})`,
              )
            : new Error(output.line || 'app-server bridge failed'),
        );
      }
    });
    try {
      await this.bridge.start();
    } catch (error) {
      this.detach();
      throw error;
    }
  }

  send(message: string): Promise<void> {
    return this.bridge.send(message);
  }

  async close(): Promise<void> {
    this.detach();
    await this.bridge.stop();
  }

  private detach(): void {
    this.unlisten?.();
    this.unlisten = undefined;
  }
}

/** Tauri connection adapter over the shared provider-neutral protocol client. */
export class DesktopProtocolClient extends ProtocolClient {
  constructor(bridge: ProtocolClientBridge = tauriBridge, timeoutMs = 30_000) {
    super(new TauriProtocolConnection(bridge), timeoutMs);
  }
}
