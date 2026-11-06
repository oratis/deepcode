// LSP compatibility handler backed by the shared app-server protocol client.
import { fileURLToPath } from 'node:url';
import { SpawnedAppServerConnection } from '@deepcode/app-server/client';
import { ProtocolClient, } from '@deepcode/protocol';
const state = {
    initialized: false,
    clientFactory: () => new ProtocolClient(new SpawnedAppServerConnection()),
    activeTurns: new Map(),
    turnSinks: new Map(),
    queuedEvents: new Map(),
};
const SERVER_INFO = {
    name: 'deepcode-lsp',
    version: '0.0.0',
};
const COMMANDS = [
    'deepcode.runAgent',
    'deepcode.abort',
    'deepcode.readThread',
    'deepcode.resumeThread',
    'deepcode.respondApproval',
    'deepcode.respondUserInput',
    'deepcode.listSkills',
    'deepcode.configDiagnostics',
    'deepcode.workspaceDiff',
    'deepcode.applyReviewFinding',
    'deepcode.applyReviewFindings',
    'deepcode.revertReviewAction',
];
export async function handleMessage(msg, send) {
    if (msg.id === undefined || msg.id === null) {
        await handleNotification(msg);
        return;
    }
    try {
        const result = await dispatch(msg, send);
        send({ jsonrpc: '2.0', id: msg.id, result });
    }
    catch (error) {
        send({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32603, message: error.message },
        });
    }
}
async function handleNotification(msg) {
    switch (msg.method) {
        case 'initialized':
            state.initialized = true;
            return;
        case 'exit':
            await closeClient();
            process.exit(state.initialized ? 0 : 1);
            return;
        default:
            return;
    }
}
async function dispatch(msg, send) {
    switch (msg.method) {
        case 'initialize':
            return handleInitialize(msg.params);
        case 'shutdown':
            await closeClient();
            return null;
        case 'workspace/executeCommand':
            return handleExecuteCommand(msg.params, send);
        default:
            throw new Error(`Method not supported: ${msg.method ?? '<missing>'}`);
    }
}
function handleInitialize(params) {
    state.rootUri = params?.rootUri;
    return {
        capabilities: {
            executeCommandProvider: { commands: COMMANDS },
            textDocumentSync: 0,
        },
        serverInfo: SERVER_INFO,
    };
}
async function handleExecuteCommand(params, send) {
    state.latestSend = send;
    switch (params.command) {
        case 'deepcode.runAgent':
            return handleRunAgent((params.arguments?.[0] ?? {}), send);
        case 'deepcode.abort':
            return handleAbort((params.arguments?.[0] ?? {}));
        case 'deepcode.readThread':
            return handleReadThread((params.arguments?.[0] ?? {}));
        case 'deepcode.resumeThread':
            return handleResumeThread((params.arguments?.[0] ?? {}));
        case 'deepcode.respondApproval':
            return handleApproval((params.arguments?.[0] ?? {}));
        case 'deepcode.respondUserInput':
            return handleUserInput((params.arguments?.[0] ?? {}));
        case 'deepcode.listSkills':
            return handleListSkills();
        case 'deepcode.configDiagnostics':
            return handleConfigDiagnostics();
        case 'deepcode.workspaceDiff':
            return handleWorkspaceDiff();
        case 'deepcode.applyReviewFinding':
            return handleReviewApply([(params.arguments?.[0] ?? {}).findingId], send);
        case 'deepcode.applyReviewFindings':
            return handleReviewApply((params.arguments?.[0] ?? {}).findingIds ?? [], send);
        case 'deepcode.revertReviewAction':
            return handleReviewRevert((params.arguments?.[0] ?? {}).actionId, send);
        default:
            throw new Error(`Unknown command: ${params.command}`);
    }
}
async function handleRunAgent(args, send) {
    if (!args.prompt)
        throw new Error('prompt is required');
    const client = await getClient();
    const thread = await ensureThread(client, args.threadId);
    const turn = await client.request('turn/start', {
        threadId: thread.id,
        input: {
            text: args.prompt,
            ...(args.model ? { model: args.model } : {}),
            ...(args.effort ? { effort: args.effort } : {}),
            ...(args.mode ? { mode: args.mode } : {}),
        },
    });
    state.activeTurns.set(turn.id, thread.id);
    state.turnSinks.set(turn.id, send);
    flushEvents(turn.id);
    return { threadId: thread.id, turnId: turn.id };
}
async function handleReviewApply(findingIds, send) {
    if (findingIds.length === 0 || findingIds.some((findingId) => !findingId)) {
        throw new Error('At least one findingId is required');
    }
    const client = await getClient();
    const initialized = await client.connect();
    if (!initialized.capabilities.reviewActions) {
        throw new Error('The app-server does not support review actions');
    }
    const thread = await ensureThread(client);
    const turn = await client.request('review/apply', {
        threadId: thread.id,
        findingIds: findingIds,
    });
    state.activeTurns.set(turn.id, thread.id);
    state.turnSinks.set(turn.id, send);
    flushEvents(turn.id);
    return { threadId: thread.id, turnId: turn.id };
}
async function handleReviewRevert(actionId, send) {
    if (!actionId)
        throw new Error('actionId is required');
    const client = await getClient();
    const initialized = await client.connect();
    if (!initialized.capabilities.reviewActions) {
        throw new Error('The app-server does not support review actions');
    }
    const thread = await ensureThread(client);
    const turn = await client.request('review/revert', {
        threadId: thread.id,
        actionId,
    });
    state.activeTurns.set(turn.id, thread.id);
    state.turnSinks.set(turn.id, send);
    flushEvents(turn.id);
    return { threadId: thread.id, turnId: turn.id };
}
async function handleAbort(args) {
    if (!args.turnId)
        throw new Error('turnId is required');
    const threadId = state.activeTurns.get(args.turnId);
    if (!threadId)
        return { aborted: false };
    const client = await getClient();
    const result = await client.request('turn/interrupt', {
        threadId,
        turnId: args.turnId,
    });
    return { aborted: result.interrupted };
}
async function handleReadThread(args) {
    if (!args.threadId)
        throw new Error('threadId is required');
    return (await getClient()).request('thread/read', { threadId: args.threadId });
}
async function handleResumeThread(args) {
    if (!args.threadId)
        throw new Error('threadId is required');
    const thread = await (await getClient()).request('thread/resume', {
        threadId: args.threadId,
    });
    state.threadId = thread.id;
    return thread;
}
async function handleApproval(args) {
    const { threadId, turnId, requestId } = interactionContext(args);
    if (!args.decision)
        throw new Error('decision is required');
    return (await getClient()).request('approval/respond', {
        threadId,
        turnId,
        requestId,
        decision: args.decision,
    });
}
async function handleUserInput(args) {
    const { threadId, turnId, requestId } = interactionContext(args);
    if (args.answer === undefined)
        throw new Error('answer is required');
    return (await getClient()).request('user-input/respond', {
        threadId,
        turnId,
        requestId,
        answer: args.answer,
    });
}
function interactionContext(args) {
    if (!args.turnId)
        throw new Error('turnId is required');
    if (!args.requestId)
        throw new Error('requestId is required');
    const threadId = state.activeTurns.get(args.turnId);
    if (!threadId)
        throw new Error(`Active turn not found: ${args.turnId}`);
    return { threadId, turnId: args.turnId, requestId: args.requestId };
}
async function getClient() {
    if (!state.client) {
        const client = state.clientFactory();
        state.client = client;
        state.unsubscribe = client.subscribe(routeEvent);
    }
    await state.client.connect();
    return state.client;
}
async function ensureThread(client, requestedThreadId) {
    if (requestedThreadId && requestedThreadId !== state.threadId) {
        const thread = await client.request('thread/resume', {
            threadId: requestedThreadId,
        });
        state.threadId = thread.id;
        return thread;
    }
    if (state.threadId) {
        return client.request('thread/read', { threadId: state.threadId });
    }
    const thread = await client.request('thread/start', { cwd: workspacePath() });
    state.threadId = thread.id;
    return thread;
}
function routeEvent(event) {
    const turnId = turnIdFrom(event);
    if (!turnId) {
        state.latestSend?.({ jsonrpc: '2.0', method: 'deepcode/protocolEvent', params: event });
        return;
    }
    const send = state.turnSinks.get(turnId);
    if (!send) {
        const queued = state.queuedEvents.get(turnId) ?? [];
        queued.push(event);
        state.queuedEvents.set(turnId, queued);
        return;
    }
    sendProtocolEvent(send, event);
}
function flushEvents(turnId) {
    const send = state.turnSinks.get(turnId);
    if (!send)
        return;
    const events = state.queuedEvents.get(turnId) ?? [];
    state.queuedEvents.delete(turnId);
    for (const event of events)
        sendProtocolEvent(send, event);
}
function sendProtocolEvent(send, event) {
    send({ jsonrpc: '2.0', method: 'deepcode/protocolEvent', params: event });
    if (isTerminal(event)) {
        const turnId = event.turn.id;
        state.activeTurns.delete(turnId);
        state.turnSinks.delete(turnId);
        state.queuedEvents.delete(turnId);
    }
}
function turnIdFrom(event) {
    if (event.type === 'thread.started')
        return undefined;
    if (event.type === 'turn.started' ||
        event.type === 'turn.completed' ||
        event.type === 'turn.interrupted' ||
        event.type === 'turn.failed') {
        return event.turn.id;
    }
    return event.turnId;
}
function isTerminal(event) {
    return (event.type === 'turn.completed' ||
        event.type === 'turn.interrupted' ||
        event.type === 'turn.failed');
}
function workspacePath() {
    if (!state.rootUri)
        return process.cwd();
    try {
        return fileURLToPath(state.rootUri);
    }
    catch {
        return process.cwd();
    }
}
async function closeClient() {
    state.unsubscribe?.();
    state.unsubscribe = undefined;
    const client = state.client;
    state.client = undefined;
    state.threadId = undefined;
    state.activeTurns.clear();
    state.turnSinks.clear();
    state.queuedEvents.clear();
    if (client)
        await client.close();
}
async function handleListSkills() {
    const { loadSkills } = await import('@deepcode/core');
    const skills = await loadSkills({ cwd: workspacePath() });
    return {
        skills: skills.map((skill) => ({
            name: skill.qualifiedName,
            description: skill.frontmatter.description,
            source: skill.source,
            path: skill.path,
        })),
    };
}
async function handleConfigDiagnostics() {
    const client = await getClient();
    const initialized = await client.connect();
    if (!initialized.capabilities.configDiagnostics) {
        throw new Error('The app-server does not support configuration diagnostics');
    }
    return client.request('config/diagnostics', { cwd: workspacePath() });
}
async function handleWorkspaceDiff() {
    const client = await getClient();
    const initialized = await client.connect();
    if (!initialized.capabilities.workspaceDiff) {
        throw new Error('The app-server does not support workspace diff');
    }
    const thread = await ensureThread(client);
    return client.request('workspace/diff', { threadId: thread.id });
}
export const __test = {
    state,
    dispatch,
    setClientFactory(factory) {
        state.clientFactory = factory;
    },
    async reset() {
        await closeClient();
        state.initialized = false;
        state.rootUri = undefined;
        state.latestSend = undefined;
        state.clientFactory = () => new ProtocolClient(new SpawnedAppServerConnection());
    },
};
//# sourceMappingURL=handler.js.map