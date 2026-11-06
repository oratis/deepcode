import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
/** Canonical directory-trust store shared by every runtime host. */
export class DirectoryTrustStore {
    directory;
    constructor(options = {}) {
        this.directory = options.directory ?? join(options.home ?? homedir(), '.deepcode');
    }
    filePath() {
        return join(this.directory, 'trusted-dirs.json');
    }
    async load() {
        try {
            const parsed = JSON.parse(await fs.readFile(this.filePath(), 'utf8'));
            return validateState(parsed);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { dirs: {} };
            throw new Error(`Failed to load directory trust: ${error.message}`, {
                cause: error,
            });
        }
    }
    async save(state) {
        const path = this.filePath();
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(path, `${JSON.stringify(validateState(state), null, 2)}\n`, 'utf8');
    }
    async statusFor(cwd) {
        const entry = (await this.load()).dirs[resolve(cwd)];
        if (!entry)
            return 'untrusted';
        return entry.mode === 'plan-only' ? 'plan-only' : 'trusted';
    }
    async trust(cwd, mode) {
        const state = await this.load();
        state.dirs[resolve(cwd)] = { trustedAt: new Date().toISOString(), mode };
        await this.save(state);
    }
    async untrust(cwd) {
        const state = await this.load();
        delete state.dirs[resolve(cwd)];
        await this.save(state);
    }
}
function validateState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('trusted-dirs.json must contain an object');
    }
    const dirs = value.dirs;
    if (!dirs || typeof dirs !== 'object' || Array.isArray(dirs)) {
        throw new Error('trusted-dirs.json must contain a dirs object');
    }
    const validated = { dirs: {} };
    for (const [path, raw] of Object.entries(dirs)) {
        if (path === '__proto__' || path === 'prototype' || path === 'constructor') {
            throw new Error(`Invalid trust entry key ${path}`);
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`Invalid trust entry for ${path}`);
        }
        const entry = raw;
        if (typeof entry.trustedAt !== 'string' ||
            (entry.mode !== 'full' && entry.mode !== 'plan-only')) {
            throw new Error(`Invalid trust entry for ${path}`);
        }
        validated.dirs[path] = { trustedAt: entry.trustedAt, mode: entry.mode };
    }
    return validated;
}
//# sourceMappingURL=trust-store.js.map