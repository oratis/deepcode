/** Composition profiles are separate from provider and scheduler profiles. */
export const RUNTIME_PROFILES = [
  'interactive',
  'headless',
  'desktop',
  'editor',
  'app-server',
] as const;
export type RuntimeProfileId = (typeof RUNTIME_PROFILES)[number];
export interface RuntimeProfile {
  schemaVersion: 1;
  profileId: RuntimeProfileId;
  bundles: ['base-coding'];
  /** Only narrowing tool constraints are configurable in the initial profile schema. */
  tools: { allow?: string[]; deny: string[] };
}
export interface ProfileLayer {
  source: 'user-profile' | 'user-global' | 'trusted-workspace' | 'startup';
  value: unknown;
}
export interface ResolvedProfile {
  profile: RuntimeProfile;
  /** Field names and sources only: never echo configuration values or credentials. */
  provenance: Array<{ field: string; source: string }>;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid profile object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown profile field: ${key}`);
}
function names(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 200) ||
    new Set(value).size !== value.length
  )
    throw new Error('Profile tool lists require unique nonempty names');
  return [...value] as string[];
}
export function resolveProfile(
  id: RuntimeProfileId = 'interactive',
  layers: readonly ProfileLayer[] = [],
): ResolvedProfile {
  if (!(RUNTIME_PROFILES as readonly string[]).includes(id))
    throw new Error(`Unsupported runtime profile: ${id}`);
  let allow: string[] | undefined;
  const deny = new Set<string>();
  const provenance = [
    { field: 'profileId', source: 'entrypoint' },
    { field: 'bundles', source: 'bundle-default' },
  ];
  const priority = ['user-profile', 'user-global', 'trusted-workspace', 'startup'];
  let previous = -1;
  for (const layer of layers) {
    const rank = priority.indexOf(layer.source);
    if (rank < previous || rank < 0)
      throw new Error('Profile layers must follow configuration precedence');
    previous = rank;
    const value = object(layer.value);
    keys(value, ['schemaVersion', 'profileId', 'bundles', 'tools']);
    if (value.schemaVersion !== 1) throw new Error('Unsupported profile schemaVersion');
    if (value.profileId !== undefined && value.profileId !== id)
      throw new Error('A patch cannot change the entrypoint profile');
    if (value.bundles !== undefined && JSON.stringify(value.bundles) !== '["base-coding"]')
      throw new Error('Required base-coding bundle cannot be removed or replaced');
    if (value.tools !== undefined) {
      const tools = object(value.tools);
      keys(tools, ['allow', 'deny']);
      if (tools.allow !== undefined) {
        const next = names(tools.allow);
        allow = allow ? allow.filter((name) => next.includes(name)) : next;
        provenance.push({ field: 'tools.allow', source: layer.source });
      }
      if (tools.deny !== undefined) {
        names(tools.deny).forEach((name) => deny.add(name));
        provenance.push({ field: 'tools.deny', source: layer.source });
      }
    }
  }
  return {
    profile: {
      schemaVersion: 1,
      profileId: id,
      bundles: ['base-coding'],
      tools: { ...(allow ? { allow } : {}), deny: [...deny] },
    },
    provenance,
  };
}
