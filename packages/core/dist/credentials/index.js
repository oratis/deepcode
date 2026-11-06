// Credentials — macOS Keychain primary, ~/.deepcode/credentials.json fallback.
// Spec: docs/DEVELOPMENT_PLAN.md §3.4
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const SERVICE = 'deepcode';
const KEYCHAIN_ACCOUNT_API = 'deepseek-api-key';
const KEYCHAIN_ACCOUNT_AUTH = 'deepseek-auth-token';
export class CredentialsStore {
    directory;
    useKeychain;
    constructor(opts = {}) {
        this.directory = opts.directory ?? join(opts.home ?? homedir(), '.deepcode');
        this.useKeychain = !opts.forceFile && platform() === 'darwin';
    }
    filePath() {
        return join(this.directory, 'credentials.json');
    }
    async load() {
        if (this.useKeychain) {
            const fromKeychain = await this.loadKeychain();
            if (fromKeychain.apiKey || fromKeychain.authToken) {
                // Read baseURL from file (Keychain doesn't store it)
                const fromFile = await this.loadFile();
                return { ...fromKeychain, baseURL: fromFile.baseURL };
            }
        }
        return this.loadFile();
    }
    async save(creds) {
        if (this.useKeychain) {
            await this.saveKeychain(creds);
        }
        // Always also persist baseURL (+ a sentinel) to file
        await this.saveFile(creds);
    }
    async clear() {
        if (this.useKeychain) {
            await Promise.allSettled([
                execFileAsync('security', [
                    'delete-generic-password',
                    '-s',
                    SERVICE,
                    '-a',
                    KEYCHAIN_ACCOUNT_API,
                ]),
                execFileAsync('security', [
                    'delete-generic-password',
                    '-s',
                    SERVICE,
                    '-a',
                    KEYCHAIN_ACCOUNT_AUTH,
                ]),
            ]);
        }
        try {
            await fs.unlink(this.filePath());
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
    }
    async loadFile() {
        try {
            const raw = await fs.readFile(this.filePath(), 'utf8');
            const parsed = JSON.parse(raw);
            return parsed;
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return {};
            throw err;
        }
    }
    async saveFile(creds) {
        const path = this.filePath();
        const dir = dirname(path);
        await fs.mkdir(dir, { recursive: true });
        // If Keychain is the source of truth, only write baseURL marker
        const toWrite = this.useKeychain
            ? { baseURL: creds.baseURL }
            : { apiKey: creds.apiKey, authToken: creds.authToken, baseURL: creds.baseURL };
        const data = JSON.stringify(toWrite, null, 2) + '\n';
        // Write to a temp file created with mode 0600, then atomically rename over
        // the target. Writing then chmod-ing the real file leaves a TOCTOU window in
        // which a plaintext apiKey/authToken is briefly readable at the default
        // umask (typically 0644). Creating at 0600 closes that window, and the
        // rename is atomic so readers never see a half-written file.
        const tmp = join(dir, `.credentials.${process.pid}.${Date.now()}.tmp`);
        await fs.writeFile(tmp, data, { mode: 0o600 });
        try {
            await fs.rename(tmp, path);
        }
        catch (err) {
            await fs.rm(tmp, { force: true });
            throw err;
        }
        // Belt-and-suspenders: some filesystems ignore the create mode, and a
        // pre-existing target may have had looser perms before this rename.
        await fs.chmod(path, 0o600);
    }
    async loadKeychain() {
        const apiKey = await this.kcRead(KEYCHAIN_ACCOUNT_API);
        const authToken = await this.kcRead(KEYCHAIN_ACCOUNT_AUTH);
        return { apiKey, authToken };
    }
    async saveKeychain(creds) {
        if (creds.apiKey)
            await this.kcWrite(KEYCHAIN_ACCOUNT_API, creds.apiKey);
        if (creds.authToken)
            await this.kcWrite(KEYCHAIN_ACCOUNT_AUTH, creds.authToken);
    }
    async kcRead(account) {
        try {
            const { stdout } = await execFileAsync('security', [
                'find-generic-password',
                '-s',
                SERVICE,
                '-a',
                account,
                '-w',
            ]);
            return stdout.trim() || undefined;
        }
        catch {
            return undefined;
        }
    }
    async kcWrite(account, value) {
        await execFileAsync('security', [
            'add-generic-password',
            '-s',
            SERVICE,
            '-a',
            account,
            '-w',
            value,
            '-U',
        ]);
    }
}
/**
 * Resolve credentials at runtime: apiKeyHelper (if set) overrides stored creds.
 * One-shot resolution — use `ApiKeyHelperRefresher` for periodic refresh on
 * 401 / TTL expiry.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.4
 */
export async function resolveCredentials(args) {
    if (args.apiKeyHelper) {
        try {
            const { stdout } = await execFileAsync('/bin/sh', ['-c', args.apiKeyHelper], {
                timeout: 10_000,
            });
            const key = stdout.trim();
            if (key) {
                const stored = await args.store.load();
                return { ...stored, apiKey: key };
            }
        }
        catch {
            // fall through to stored creds
        }
    }
    return args.store.load();
}
export class ApiKeyHelperRefresher {
    opts;
    ttlMs;
    cached = null;
    constructor(opts) {
        this.opts = opts;
        this.ttlMs =
            opts.ttlMs ??
                (process.env.DEEPCODE_API_KEY_HELPER_TTL_MS
                    ? Number.parseInt(process.env.DEEPCODE_API_KEY_HELPER_TTL_MS, 10)
                    : 5 * 60 * 1000);
    }
    /** Get the current key — refresh if expired. */
    async get() {
        if (this.cached && Date.now() < this.cached.expiresAt) {
            const stored = await this.opts.store.load();
            return { ...stored, apiKey: this.cached.key };
        }
        return this.refresh();
    }
    /** Force a refresh (e.g. on 401). */
    async refresh() {
        const creds = await resolveCredentials({
            store: this.opts.store,
            apiKeyHelper: this.opts.apiKeyHelper,
        });
        if (creds.apiKey) {
            this.cached = { key: creds.apiKey, expiresAt: Date.now() + this.ttlMs };
        }
        return creds;
    }
    /** Mark the cache stale so next .get() refreshes. */
    invalidate() {
        this.cached = null;
    }
}
/** Display-safe redacted form of a credential — first 4 + last 4. */
export function redact(value) {
    if (!value)
        return '<not set>';
    if (value.length <= 8)
        return '****';
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
//# sourceMappingURL=index.js.map