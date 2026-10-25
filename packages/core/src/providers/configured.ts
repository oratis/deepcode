import type { DeepCodeSettings } from '../config/types.js';
import { CredentialsStore, resolveCredentials } from '../credentials/index.js';
import { DeepSeekProvider } from './deepseek.js';
import {
  PROVIDERS,
  providerForModel,
  validModelId,
  modelParameters,
  modelInfo,
  type ProviderId,
} from './catalog.js';
import type { Provider, ProviderRunOpts } from './types.js';
import type { Effort } from '../types.js';

export function defaultModel(settings: DeepCodeSettings): string {
  const id = settings.provider ?? 'deepseek';
  if (!Object.hasOwn(PROVIDERS, id)) throw new Error('Unknown provider');
  return settings.model ?? settings.providers?.[id]?.model ?? PROVIDERS[id].model;
}
export function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new Error(
      'Provider endpoint must use HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment',
    );
  }
  return value.replace(/\/$/, '');
}
export interface ConnectionOptions {
  settings: DeepCodeSettings;
  store: CredentialsStore;
  env?: NodeJS.ProcessEnv;
}
export async function resolveProviderConnection(
  options: ConnectionOptions,
  model = defaultModel(options.settings),
  signal?: AbortSignal,
) {
  if (!validModelId(model)) throw new Error('Invalid model ID');
  const { settings, store, env } = options;
  const id: ProviderId = providerForModel(model, settings.provider);
  if (!Object.hasOwn(PROVIDERS, id)) throw new Error('Unknown provider');
  const profile = settings.providers?.[id];
  const apiKeyEnv = profile?.apiKeyEnv ?? PROVIDERS[id].apiKeyEnv;
  if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv))
    throw new Error('Invalid API key environment variable name');
  for (const limit of [profile?.contextWindow, profile?.maxOutput]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
      throw new Error('Model limits must be positive integers');
  }
  const credentials = await resolveCredentials({
    store,
    env,
    apiKeyEnv,
    useStore: id === 'deepseek',
    apiKeyHelper: id === 'deepseek' ? settings.apiKeyHelper : undefined,
    signal,
  });
  const apiKey = credentials.apiKey || credentials.authToken;
  if (!apiKey)
    throw new Error(
      `No ${id} credentials. Set ${apiKeyEnv}${id === 'deepseek' ? ' or run deepcode to onboard' : ''}.`,
    );
  const baseURL = validateEndpoint(
    profile?.baseURL ??
      (id === 'deepseek' ? (credentials.baseURL ?? settings.baseURL) : undefined) ??
      PROVIDERS[id].baseURL,
  );
  return { id, model, apiKey, baseURL, profile };
}

/** Resolves every call independently: switching models never reuses another provider's key. */
export class ConfiguredProvider implements Provider {
  readonly name = 'configured';
  readonly defaultModel: string;
  constructor(private readonly options: ConnectionOptions & { fetch?: typeof globalThis.fetch }) {
    this.defaultModel = defaultModel(options.settings);
  }
  parameters(model: string, effort?: Effort) {
    const id = providerForModel(model, this.options.settings.provider);
    return modelParameters(model, effort, this.options.settings.providers?.[id], id);
  }
  contextWindow(model: string) {
    const id = providerForModel(model, this.options.settings.provider);
    return (
      this.options.settings.providers?.[id]?.contextWindow ??
      modelInfo(model)?.contextWindow ??
      32_000
    );
  }
  async runTurn(opts: ProviderRunOpts) {
    const connection = await resolveProviderConnection(this.options, opts.model, opts.signal);
    return new DeepSeekProvider({
      apiKey: connection.apiKey,
      baseURL: connection.baseURL,
      provider: connection.id,
      maxOutput: connection.profile?.maxOutput,
      fetch: this.options.fetch,
    }).runTurn(opts);
  }
}
