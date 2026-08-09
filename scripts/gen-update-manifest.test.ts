import { describe, expect, it } from 'vitest';
import { buildManifest } from './gen-update-manifest.js';

const base = {
  version: '0.3.1',
  bundlePath: '/build/bundle/macos/DeepCode.app.tar.gz',
  signature: 'dW50cnVzdGVkIGNvbW1lbnQ6…\n',
  repo: 'oratis/deepcode',
  pubDate: '2026-08-09T12:00:00.000Z',
};

describe('buildManifest', () => {
  it('produces the shape the Tauri updater expects', () => {
    expect(buildManifest(base)).toEqual({
      version: '0.3.1',
      pub_date: '2026-08-09T12:00:00.000Z',
      platforms: {
        'darwin-aarch64': {
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ6…',
          url: 'https://github.com/oratis/deepcode/releases/download/v0.3.1/DeepCode.app.tar.gz',
        },
      },
    });
  });

  it('pins the download at the tag, not at /latest/', () => {
    // A client that already fetched this manifest has to keep resolving to the
    // build the signature was made for, even after a newer release exists.
    expect(buildManifest(base).platforms['darwin-aarch64']!.url).toContain('/download/v0.3.1/');
    expect(buildManifest(base).platforms['darwin-aarch64']!.url).not.toContain('/latest/');
  });

  it('refuses an empty signature', () => {
    // The plausible mistake is globbing up a `.sig` that was never written
    // because the signing key was missing. A manifest with an empty signature
    // is rejected by every client — better to fail the release than to publish
    // an update nobody can install.
    expect(() => buildManifest({ ...base, signature: '   \n' })).toThrow(/empty signature/);
  });

  it('omits notes rather than emitting an empty one', () => {
    expect(buildManifest(base).notes).toBeUndefined();
    expect(buildManifest({ ...base, notes: 'Security fix' }).notes).toBe('Security fix');
  });

  it('names the uploaded file, not its build path', () => {
    // The URL is a release asset; the local directory it was built in has no
    // meaning to the client.
    expect(buildManifest(base).platforms['darwin-aarch64']!.url).toMatch(
      /\/DeepCode\.app\.tar\.gz$/,
    );
  });
});
