#!/usr/bin/env node
// gen-update-manifest — the `latest.json` the Tauri updater polls.
//
// Usage:
//   tsx scripts/gen-update-manifest.ts \
//     --version 0.3.1 --bundle <path/to/DeepCode.app.tar.gz> \
//     --repo oratis/deepcode --pub-date 2026-08-09T00:00:00.000Z
//
// `tauri.conf.json#plugins.updater.endpoints` points at this file on the latest
// GitHub release. Without it the app polls, 404s, and silently never updates —
// which is the state DeepCode shipped in: `updater.active` was true and a public
// key was committed, but nothing ever produced the manifest.
//
// A separate script rather than inline YAML because the shape is a contract
// with the updater and a wrong field name fails the same way a missing file
// does: quietly, in the user's app, long after the release is cut.

import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

/** Tauri v2's manifest shape. Extra keys are not added — the client validates. */
export interface UpdateManifest {
  version: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
  notes?: string;
}

export interface ManifestInput {
  version: string;
  /** Path to the `.app.tar.gz` — its sibling `.sig` is read from disk. */
  bundlePath: string;
  signature: string;
  repo: string;
  pubDate: string;
  /** Tauri's platform key. macOS arm64 is the only build we ship. */
  platform?: string;
  notes?: string;
}

export function buildManifest(input: ManifestInput): UpdateManifest {
  if (!input.signature.trim()) {
    // An empty signature produces a manifest the updater rejects for every
    // user, and it would be produced by exactly the plausible mistake: globbing
    // up a `.sig` that was never written because the key was missing.
    throw new Error('refusing to write a manifest with an empty signature');
  }
  const file = basename(input.bundlePath);
  return {
    version: input.version,
    pub_date: input.pubDate,
    ...(input.notes ? { notes: input.notes } : {}),
    platforms: {
      [input.platform ?? 'darwin-aarch64']: {
        signature: input.signature.trim(),
        // Pinned to the tag, not `/latest/`: a client that already downloaded
        // this manifest must keep resolving to the build it was signed for,
        // even after a newer release exists.
        url: `https://github.com/${input.repo}/releases/download/v${input.version}/${file}`,
      },
    },
  };
}

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const version = arg(argv, 'version');
  const bundlePath = arg(argv, 'bundle');
  const repo = arg(argv, 'repo') ?? process.env.GITHUB_REPOSITORY;
  const pubDate = arg(argv, 'pub-date') ?? new Date().toISOString();

  if (!version || !bundlePath || !repo) {
    process.stderr.write(
      'Usage: gen-update-manifest --version <x.y.z> --bundle <file.app.tar.gz> [--repo owner/name]\n',
    );
    process.exit(2);
  }

  // Fail on a missing bundle rather than emitting a manifest pointing at a file
  // that was never uploaded.
  statSync(bundlePath);
  const signature = readFileSync(`${bundlePath}.sig`, 'utf8');

  process.stdout.write(
    JSON.stringify(
      buildManifest({ version, bundlePath, signature, repo, pubDate, notes: arg(argv, 'notes') }),
      null,
      2,
    ) + '\n',
  );
}

const invoked = process.argv[1] ?? '';
if (invoked.includes('gen-update-manifest')) {
  main();
}
