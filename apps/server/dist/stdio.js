import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { decodeProtocolRequest, encodeProtocolMessage, } from '@deepcode/protocol';
export class ProtocolLineWriter {
    output;
    maxPending;
    tail = Promise.resolve();
    failure;
    pending = 0;
    constructor(output, maxPending = 1024) {
        this.output = output;
        this.maxPending = maxPending;
    }
    enqueue(message) {
        if (this.pending >= this.maxPending && isTransientDelta(message)) {
            return Promise.resolve();
        }
        this.pending++;
        const task = this.tail.then(async () => {
            if (this.failure)
                throw this.failure;
            const accepted = this.output.write(`${encodeProtocolMessage(message)}\n`);
            if (!accepted)
                await once(this.output, 'drain');
        });
        this.tail = task.catch((error) => {
            this.failure = error;
        });
        void task.then(() => this.pending--, () => this.pending--);
        return task;
    }
    async flush() {
        await this.tail;
        if (this.failure)
            throw this.failure;
    }
}
export async function serveStdio(server, input, destination) {
    const writer = destination instanceof ProtocolLineWriter ? destination : new ProtocolLineWriter(destination);
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
        if (!line.trim())
            continue;
        let request;
        try {
            request = decodeProtocolRequest(line);
        }
        catch (error) {
            await writer.enqueue({
                id: null,
                error: { code: 'parse_error', message: error.message ?? String(error) },
            });
            continue;
        }
        await writer.enqueue(await server.handle(request));
    }
    await server.shutdown();
    await writer.flush();
}
function isTransientDelta(message) {
    return 'method' in message && message.method === 'event' && message.params.type === 'item.delta';
}
//# sourceMappingURL=stdio.js.map