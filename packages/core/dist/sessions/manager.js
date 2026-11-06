// Session manager — high-level API: create / load / list sessions; append messages.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5
import { appendMessage, defaultSessionsDir, deleteSession, listSessions as listSessionsLow, newSessionId, readMessages, readMeta, replaceSession, writeMeta, } from './storage.js';
import { captureGitCheckpoint, captureSnapshot, listSnapshots, } from './snapshots.js';
export class SessionManager {
    root;
    constructor(opts = {}) {
        this.root = opts.root ?? defaultSessionsDir();
    }
    async create(cwd, opts = {}) {
        const now = new Date().toISOString();
        const meta = {
            id: newSessionId(),
            cwd,
            createdAt: now,
            updatedAt: now,
            title: opts.title,
            model: opts.model,
        };
        await writeMeta(this.root, meta);
        return meta;
    }
    async load(sessionId) {
        const meta = await readMeta(this.root, sessionId);
        if (!meta)
            return null;
        const messages = await readMessages(this.root, sessionId);
        return { meta, messages };
    }
    async append(sessionId, msg) {
        await appendMessage(this.root, sessionId, msg);
    }
    async materialize(meta, messages) {
        await replaceSession(this.root, meta, messages);
    }
    async list() {
        return listSessionsLow(this.root);
    }
    async delete(sessionId) {
        await deleteSession(this.root, sessionId);
    }
    async snapshot(args) {
        return captureSnapshot({ ...args, sessionsRoot: this.root });
    }
    /** Capture a git working-tree checkpoint (used before Bash commands). */
    async gitCheckpoint(args) {
        return captureGitCheckpoint({ ...args, sessionsRoot: this.root });
    }
    async snapshots(sessionId) {
        return listSnapshots({ sessionsRoot: this.root, sessionId });
    }
}
//# sourceMappingURL=manager.js.map