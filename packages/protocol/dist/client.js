import { encodeProtocolMessage } from './codec.js';
import { PROTOCOL_VERSION, } from './types.js';
/**
 * Provider- and host-neutral app-server client. Desktop, editors, and tests
 * supply only their connection adapter; request correlation, initialization,
 * disconnect behavior, and event fan-out stay identical across surfaces.
 */
export class ProtocolClient {
    connection;
    timeoutMs;
    pending = new Map();
    subscribers = new Set();
    nextId = 1;
    opened = false;
    initialized;
    connecting;
    constructor(connection, timeoutMs = 30_000) {
        this.connection = connection;
        this.timeoutMs = timeoutMs;
    }
    async connect() {
        if (this.initialized)
            return this.initialized;
        if (this.connecting)
            return this.connecting;
        this.connecting = this.open();
        try {
            return await this.connecting;
        }
        finally {
            this.connecting = undefined;
        }
    }
    subscribe(handler) {
        this.subscribers.add(handler);
        return () => this.subscribers.delete(handler);
    }
    async request(method, params = {}) {
        if (!this.opened)
            throw new Error('app-server client is not connected');
        const id = this.nextId++;
        const request = { id, method, params };
        const response = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`app-server request timed out: ${method}`));
            }, this.timeoutMs);
            this.pending.set(id, {
                resolve: (value) => resolve(value),
                reject,
                timeout,
            });
        });
        try {
            await this.connection.send(encodeProtocolMessage(request));
        }
        catch (error) {
            this.rejectRequest(id, asError(error));
        }
        return response;
    }
    async close() {
        this.disconnect(new Error('app-server client closed'));
        await this.connection.close();
    }
    async open() {
        if (!this.opened) {
            await this.connection.open((message) => this.receive(message), (error) => this.disconnect(error));
            this.opened = true;
        }
        const initialized = await this.request('initialize');
        if (initialized.protocolVersion !== PROTOCOL_VERSION) {
            await this.close();
            throw new Error(`Unsupported app-server protocol version: ${initialized.protocolVersion}`);
        }
        this.initialized = initialized;
        return initialized;
    }
    receive(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            this.disconnect(new Error('app-server emitted invalid JSON'));
            return;
        }
        if ('method' in message) {
            if (message.method === 'event') {
                for (const subscriber of this.subscribers)
                    subscriber(message.params);
            }
            return;
        }
        if (typeof message.id !== 'number')
            return;
        const pending = this.pending.get(message.id);
        if (!pending)
            return;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error)
            pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        else
            pending.resolve(message.result);
    }
    disconnect(error) {
        this.opened = false;
        this.initialized = undefined;
        this.rejectAll(error);
    }
    rejectRequest(id, error) {
        const pending = this.pending.get(id);
        if (!pending)
            return;
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(error);
    }
    rejectAll(error) {
        for (const id of [...this.pending.keys()])
            this.rejectRequest(id, error);
    }
}
function asError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
//# sourceMappingURL=client.js.map