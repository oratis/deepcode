// Plugins subsystem entry — manifest parsing, hash pinning, local install, discovery.
// Spec: docs/DEVELOPMENT_PLAN.md §3.14
// Milestone: M5
//
// What's IN this milestone:
//   - plugin.json manifest parsing
//   - SHA-256 source hash + ~/.deepcode/plugins-trust.json
//   - installLocal() — copy a directory + record trust
//   - discoverPlugins() — scan ~/.deepcode/plugins/ + verify hashes
//
// What's NOT in this milestone (see docs/design/plugin-security.md):
//   - Sandbox subprocess execution (RPC over stdio)
//   - GitHub URL install (gh:user/repo)
//   - Marketplace index + ed25519 signature verification
//   - Revoke list pull + enforcement
//   - "Trust ladder" UI tiers
//
// IMPORTANT: until subprocess sandbox lands (planned M5.1), plugins are
// effectively untrusted code with full host access. The trust system records
// what the user *thought* they were installing, but cannot enforce it.
// Treat M5 as a foundation, not a security boundary.

export {
  installLocal,
  discoverPlugins,
  readManifest,
  computeSourceHash,
  loadTrustState,
  saveTrustState,
  pluginsDir,
  trustFilePath,
  type PluginManifest,
  type InstalledPlugin,
  type PluginTrust,
  type TrustState,
  type InstallOptions,
  type DiscoverOptions,
} from './manifest.js';
