// Plugin marketplace — fetch index, verify ed25519 signatures, enforce revoke list.
// Spec: docs/DEVELOPMENT_PLAN.md §3.14 (M5.2)
//
// The marketplace publishes a single `index.json` containing entries:
//   { name, version, sourceHash, sigBase64, publisher, downloadUrl, description }
//
// Verification:
//   1. ed25519 signature over `name|version|sourceHash` with publisher's pubkey
//   2. Revocation list at `revoked.json` keyed by name+version+sourceHash
//
// The trust ladder uses these to color a plugin as "official" / "marketplace"
// / "user-local" / "untrusted".
import { createPublicKey, verify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function marketplacesPath(home = homedir()) {
    return join(home, '.deepcode', 'marketplaces.json');
}
/**
 * Verify a marketplace entry's ed25519 signature.
 * Returns true on success; false on any tamper / invalid signature.
 */
export function verifyEntrySignature(entry) {
    try {
        const payload = Buffer.from(`${entry.name}|${entry.version}|${entry.sourceHash}`, 'utf8');
        const sig = Buffer.from(entry.sigBase64, 'base64');
        // node:crypto ed25519 verify requires a KeyObject — derive from raw pubkey
        // bytes wrapped in SPKI. The published pubkey is itself DER-SPKI base64.
        const pubKeyDer = Buffer.from(entry.publisherPubKey, 'base64');
        const pub = createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });
        return verify(null, payload, pub, sig);
    }
    catch {
        return false;
    }
}
export function isRevoked(entry, revoked) {
    return revoked.entries.some((r) => r.name === entry.name && r.version === entry.version && r.sourceHash === entry.sourceHash);
}
/**
 * Fetch an index from a marketplace URL. Returns parsed entries.
 * Caller is responsible for verifying signatures (see verifyEntrySignature).
 */
export async function fetchIndex(url) {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok)
        throw new Error(`marketplace index ${url}: HTTP ${res.status}`);
    const json = (await res.json());
    if (json.version !== '1')
        throw new Error(`unsupported marketplace index version: ${json.version}`);
    return json;
}
/**
 * Fetch revoked.json from the same marketplace base URL.
 * If the file is missing (404) we treat it as "no revocations" — silent.
 */
export async function fetchRevoked(baseUrl) {
    const url = baseUrl.replace(/\/index\.json$/, '/revoked.json');
    try {
        const res = await fetch(url);
        if (res.status === 404)
            return { version: '1', entries: [] };
        if (!res.ok)
            throw new Error(`revoked.json ${url}: HTTP ${res.status}`);
        return (await res.json());
    }
    catch (err) {
        // Network errors → treat as empty list (don't break install flow on transient issues)
        if (err.code === 'ENOTFOUND') {
            return { version: '1', entries: [] };
        }
        throw err;
    }
}
/**
 * Resolve a marketplace entry: fetch index + revoked, find by name (and
 * optional version), verify signature, ensure not revoked.
 */
export async function resolveEntry(args) {
    const idx = await fetchIndex(args.marketplaceUrl);
    const candidate = idx.entries
        .filter((e) => e.name === args.name)
        .filter((e) => !args.version || e.version === args.version)
        .sort((a, b) => versionCompare(b.version, a.version))[0];
    if (!candidate)
        throw new Error(`No entry "${args.name}"${args.version ? `@${args.version}` : ''} in ${args.marketplaceUrl}`);
    if (!verifyEntrySignature(candidate))
        throw new Error(`Signature verification failed for ${args.name}@${candidate.version}`);
    const revoked = await fetchRevoked(args.marketplaceUrl);
    if (isRevoked(candidate, revoked))
        throw new Error(`${args.name}@${candidate.version} is in the revocation list — refusing to install`);
    return candidate;
}
function versionCompare(a, b) {
    const aParts = a.split('.').map((s) => Number(s) || 0);
    const bParts = b.split('.').map((s) => Number(s) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const av = aParts[i] ?? 0;
        const bv = bParts[i] ?? 0;
        if (av !== bv)
            return av - bv;
    }
    return 0;
}
/**
 * Load the user's marketplace registry (~/.deepcode/marketplaces.json).
 * Returns { marketplaces: {} } if missing.
 */
export async function loadMarketplaceConfig(home = homedir()) {
    try {
        const raw = await fs.readFile(marketplacesPath(home), 'utf8');
        return JSON.parse(raw);
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return { marketplaces: {} };
        }
        throw err;
    }
}
export async function saveMarketplaceConfig(config, home = homedir()) {
    const path = marketplacesPath(home);
    await fs.mkdir(join(home, '.deepcode'), { recursive: true });
    await fs.writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
/**
 * Adds a marketplace URL to the user's config. Validates by fetching the
 * index (must parse).
 */
export async function addMarketplace(url, opts = {}) {
    // Side-effect: confirm the index is fetchable + parses
    await fetchIndex(url);
    const home = opts.home ?? homedir();
    const cfg = await loadMarketplaceConfig(home);
    cfg.marketplaces[url] = { rootPubKey: opts.rootPubKey };
    await saveMarketplaceConfig(cfg, home);
    return cfg;
}
//# sourceMappingURL=marketplace.js.map