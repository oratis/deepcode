import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
export class HookTrustStore {
    directory;
    constructor(options = {}) {
        this.directory = options.directory ?? join(options.home ?? homedir(), '.deepcode');
    }
    filePath() {
        return join(this.directory, 'hook-trust.json');
    }
    async load() {
        try {
            return validateState(JSON.parse(await fs.readFile(this.filePath(), 'utf8')));
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return { version: 1, directories: {} };
            }
            throw new Error(`Failed to load hook trust: ${error.message}`, {
                cause: error,
            });
        }
    }
    async save(state) {
        const path = this.filePath();
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(path, `${JSON.stringify(validateState(state), null, 2)}\n`, 'utf8');
    }
    async review(cwd, loaded, hooks) {
        if (!hooks)
            return { hooks, reviews: [] };
        const state = await this.load();
        const trusted = state.directories[resolve(cwd)] ?? {};
        const filtered = {};
        const reviews = [];
        for (const [event, matchers] of Object.entries(hooks)) {
            const source = sourceForEvent(loaded, event);
            const nextMatchers = matchers
                .map((matcher) => {
                const nextHandlers = matcher.hooks.filter((handler) => {
                    if (handler.type !== 'command' || !source)
                        return true;
                    const hash = hookDefinitionHash(event, matcher.matcher, handler);
                    const review = {
                        hash,
                        event,
                        matcher: matcher.matcher,
                        command: handler.command ?? '',
                        source,
                        trusted: trusted[hash]?.sourcePath === source.path,
                    };
                    reviews.push(review);
                    return review.trusted;
                });
                return nextHandlers.length > 0 ? { ...matcher, hooks: nextHandlers } : undefined;
            })
                .filter((matcher) => matcher !== undefined);
            if (nextMatchers.length > 0)
                filtered[event] = nextMatchers;
        }
        return { hooks: filtered, reviews };
    }
    async trust(cwd, reviews) {
        const state = await this.load();
        const key = resolve(cwd);
        const entries = state.directories[key] ?? {};
        for (const review of reviews) {
            entries[review.hash] = {
                trustedAt: new Date().toISOString(),
                sourcePath: review.source.path,
            };
        }
        state.directories[key] = entries;
        await this.save(state);
    }
    async revoke(cwd) {
        const state = await this.load();
        delete state.directories[resolve(cwd)];
        await this.save(state);
    }
}
export function hookDefinitionHash(event, matcher, handler) {
    const canonical = canonicalJson({ event, matcher: matcher ?? '', handler });
    return createHash('sha256').update(canonical).digest('hex').slice(0, 20);
}
function sourceForEvent(loaded, event) {
    const source = loaded.provenance[`/hooks/${escapePointer(event)}`];
    return source?.layer === 'project' || source?.layer === 'local'
        ? { layer: source.layer, path: source.path }
        : undefined;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
function escapePointer(value) {
    return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
function validateState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('hook-trust.json must contain an object');
    }
    const raw = value;
    if (raw.version !== 1 ||
        !raw.directories ||
        typeof raw.directories !== 'object' ||
        Array.isArray(raw.directories)) {
        throw new Error('hook-trust.json must contain version 1 and directories');
    }
    const state = { version: 1, directories: {} };
    for (const [cwd, entries] of Object.entries(raw.directories)) {
        if (!safeKey(cwd) || !entries || typeof entries !== 'object' || Array.isArray(entries)) {
            throw new Error(`Invalid hook trust directory ${cwd}`);
        }
        const next = {};
        for (const [hash, entry] of Object.entries(entries)) {
            if (!safeKey(hash) || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Invalid hook trust entry ${hash}`);
            }
            const item = entry;
            if (typeof item.trustedAt !== 'string' || typeof item.sourcePath !== 'string') {
                throw new Error(`Invalid hook trust entry ${hash}`);
            }
            next[hash] = { trustedAt: item.trustedAt, sourcePath: item.sourcePath };
        }
        state.directories[cwd] = next;
    }
    return state;
}
function safeKey(value) {
    return value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}
//# sourceMappingURL=hook-trust.js.map