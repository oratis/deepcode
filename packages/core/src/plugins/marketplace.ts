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

import { verify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MarketplaceEntry {
  name: string;
  version: string;
  /** SHA-256 hash recorded by the publisher; we re-verify on local install. */
  sourceHash: string;
  /** Base64-encoded ed25519 signature over `${name}|${version}|${sourceHash}`. */
  sigBase64: string;
  /** Base64-encoded ed25519 public key of the publisher (DER SPKI form). */
  publisherPubKey: string;
  /** Free-form publisher label (display only — trust comes from pubkey). */
  publisher: string;
  downloadUrl: string;
  description?: string;
}

export interface MarketplaceIndex {
  version: '1';
  entries: MarketplaceEntry[];
}

export interface RevokedEntry {
  name: string;
  version: string;
  sourceHash: string;
  reason?: string;
}

export interface RevokedList {
  version: '1';
  entries: RevokedEntry[];
}

export function marketplacesPath(home: string = homedir()): string {
  return join(home, '.deepcode', 'marketplaces.json');
}

export interface MarketplaceConfig {
  /** URL → optional pubkey for that marketplace (so an entry's pubkey is verified to come FROM that source). */
  marketplaces: Record<string, { rootPubKey?: string }>;
}

/**
 * Verify a marketplace entry's ed25519 signature.
 * Returns true on success; false on any tamper / invalid signature.
 */
export function verifyEntrySignature(entry: MarketplaceEntry): boolean {
  try {
    const payload = Buffer.from(`${entry.name}|${entry.version}|${entry.sourceHash}`, 'utf8');
    const sig = Buffer.from(entry.sigBase64, 'base64');
    // node:crypto ed25519 verify requires a KeyObject — derive from raw pubkey
    // bytes wrapped in SPKI. The published pubkey is itself DER-SPKI base64.
    const pubKeyDer = Buffer.from(entry.publisherPubKey, 'base64');
    const { createPublicKey } = require('node:crypto') as typeof import('node:crypto');
    const pub = createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });
    return verify(null, payload, pub, sig);
  } catch {
    return false;
  }
}

export function isRevoked(entry: MarketplaceEntry, revoked: RevokedList): boolean {
  return revoked.entries.some(
    (r) =>
      r.name === entry.name &&
      r.version === entry.version &&
      r.sourceHash === entry.sourceHash,
  );
}

/**
 * Fetch an index from a marketplace URL. Returns parsed entries.
 * Caller is responsible for verifying signatures (see verifyEntrySignature).
 */
export async function fetchIndex(url: string): Promise<MarketplaceIndex> {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`marketplace index ${url}: HTTP ${res.status}`);
  const json = (await res.json()) as MarketplaceIndex;
  if (json.version !== '1') throw new Error(`unsupported marketplace index version: ${json.version}`);
  return json;
}

/**
 * Fetch revoked.json from the same marketplace base URL.
 * If the file is missing (404) we treat it as "no revocations" — silent.
 */
export async function fetchRevoked(baseUrl: string): Promise<RevokedList> {
  const url = baseUrl.replace(/\/index\.json$/, '/revoked.json');
  try {
    const res = await fetch(url);
    if (res.status === 404) return { version: '1', entries: [] };
    if (!res.ok) throw new Error(`revoked.json ${url}: HTTP ${res.status}`);
    return (await res.json()) as RevokedList;
  } catch (err) {
    // Network errors → treat as empty list (don't break install flow on transient issues)
    if ((err as { code?: string }).code === 'ENOTFOUND') {
      return { version: '1', entries: [] };
    }
    throw err;
  }
}

/**
 * Resolve a marketplace entry: fetch index + revoked, find by name (and
 * optional version), verify signature, ensure not revoked.
 */
export async function resolveEntry(args: {
  marketplaceUrl: string;
  name: string;
  version?: string;
}): Promise<MarketplaceEntry> {
  const idx = await fetchIndex(args.marketplaceUrl);
  const candidate = idx.entries
    .filter((e) => e.name === args.name)
    .filter((e) => !args.version || e.version === args.version)
    .sort((a, b) => versionCompare(b.version, a.version))[0];
  if (!candidate) throw new Error(`No entry "${args.name}"${args.version ? `@${args.version}` : ''} in ${args.marketplaceUrl}`);
  if (!verifyEntrySignature(candidate))
    throw new Error(`Signature verification failed for ${args.name}@${candidate.version}`);
  const revoked = await fetchRevoked(args.marketplaceUrl);
  if (isRevoked(candidate, revoked))
    throw new Error(`${args.name}@${candidate.version} is in the revocation list — refusing to install`);
  return candidate;
}

function versionCompare(a: string, b: string): number {
  const aParts = a.split('.').map((s) => Number(s) || 0);
  const bParts = b.split('.').map((s) => Number(s) || 0);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Load the user's marketplace registry (~/.deepcode/marketplaces.json).
 * Returns { marketplaces: {} } if missing.
 */
export async function loadMarketplaceConfig(
  home: string = homedir(),
): Promise<MarketplaceConfig> {
  try {
    const raw = await fs.readFile(marketplacesPath(home), 'utf8');
    return JSON.parse(raw) as MarketplaceConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { marketplaces: {} };
    }
    throw err;
  }
}

export async function saveMarketplaceConfig(
  config: MarketplaceConfig,
  home: string = homedir(),
): Promise<void> {
  const path = marketplacesPath(home);
  await fs.mkdir(join(home, '.deepcode'), { recursive: true });
  await fs.writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Adds a marketplace URL to the user's config. Validates by fetching the
 * index (must parse).
 */
export async function addMarketplace(
  url: string,
  opts: { home?: string; rootPubKey?: string } = {},
): Promise<MarketplaceConfig> {
  // Side-effect: confirm the index is fetchable + parses
  await fetchIndex(url);
  const home = opts.home ?? homedir();
  const cfg = await loadMarketplaceConfig(home);
  cfg.marketplaces[url] = { rootPubKey: opts.rootPubKey };
  await saveMarketplaceConfig(cfg, home);
  return cfg;
}
