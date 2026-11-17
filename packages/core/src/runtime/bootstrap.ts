import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { durableFile, privateDirectory, syncDirectory } from '../sessions/lease.js';
import { createHash, randomUUID } from 'node:crypto';
import { createKernel, type Kernel, type KernelPlugin } from '@deepcode/kernel';
import { ToolExecutionService } from './tool-execution.js';
import { SessionManager } from '../sessions/manager.js';
import {
  resolveProfile,
  type ProfileLayer,
  type ResolvedProfile,
  type RuntimeProfileId,
} from './profile.js';
import type { Provider } from '../providers/types.js';

const ROOT_VERSION = 1;
const ROOTS = ['policy', 'credentials', 'resources', 'journal'] as const;
interface Generation {
  id: string;
  resolved: ResolvedProfile;
  kernel: Kernel;
}
/** Trusted, sealed composition. External extensions never receive this Context. */
export class AppBootstrap {
  private generation?: Generation;
  private starting?: Promise<Generation>;
  private closing?: Promise<void>;
  private closed = false;
  private changing = false;
  private readonly turns = new Map<AbortController, Promise<unknown>>();
  private readonly roots: Record<(typeof ROOTS)[number], object>;
  private readonly initial: ResolvedProfile;
  constructor(
    private readonly options: {
      provider: Provider;
      profileId?: RuntimeProfileId;
      layers?: readonly ProfileLayer[];
      stateDirectory?: string;
    },
  ) {
    this.initial = resolveProfile(options.profileId, options.layers);
    // Fixed implementation references, not labels supplied by a config file.
    this.roots = {
      policy: Object.freeze({
        owner: 'deepcode.root.policy',
        version: ROOT_VERSION,
        create: ToolExecutionService,
      }),
      credentials: Object.freeze({
        owner: 'deepcode.root.credentials',
        version: ROOT_VERSION,
        provider: options.provider,
      }),
      resources: Object.freeze({
        owner: 'deepcode.root.resources',
        version: ROOT_VERSION,
        turns: this.turns,
      }),
      journal: Object.freeze({
        owner: 'deepcode.root.journal',
        version: ROOT_VERSION,
        repository: SessionManager,
      }),
    };
  }
  private async candidate(resolved: ResolvedProfile): Promise<Generation> {
    // Prewarming is deliberately inert: no providers, hooks, tools or processes run here.
    const plugins: KernelPlugin[] = ROOTS.map((name) => ({
      id: `deepcode.root.${name}`,
      provides: [`deepcode.${name}`],
      apply: (ctx) => {
        ctx.provide(`deepcode.${name}`, this.roots[name]);
      },
    }));
    plugins.push({
      id: 'deepcode.base-coding',
      requires: ROOTS.map((name) => `deepcode.${name}`),
      provides: ['deepcode.profile'],
      apply: (ctx) => {
        ctx.provide('deepcode.profile', resolved.profile);
      },
    });
    const kernel = await createKernel(plugins);
    try {
      for (const name of ROOTS)
        if (kernel.context.get(`deepcode.${name}`) !== this.roots[name])
          throw new Error(`Missing trusted root owner: ${name}`);
      return {
        id: createHash('sha256').update(JSON.stringify(resolved.profile)).digest('hex'),
        resolved,
        kernel,
      };
    } catch (error) {
      await kernel.close();
      throw error;
    }
  }
  private async persist(generation: Generation): Promise<void> {
    if (!this.options.stateDirectory) return;
    await privateDirectory(this.options.stateDirectory);
    const temporary = join(this.options.stateDirectory, `${randomUUID()}.pending`);
    try {
      await durableFile(
        temporary,
        JSON.stringify({
          schemaVersion: 1,
          generation: generation.id,
          profile: generation.resolved.profile,
        }),
      );
      await rename(
        temporary,
        join(
          this.options.stateDirectory,
          `${generation.resolved.profile.profileId}.last-good.json`,
        ),
      );
      await syncDirectory(this.options.stateDirectory);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async start(): Promise<void> {
    await this.current();
  }
  private async current(): Promise<Generation> {
    if (this.closed) throw new Error('Bootstrap is closed');
    this.starting ??= this.candidate(this.initial).then(async (generation) => {
      try {
        await this.persist(generation);
        return (this.generation = generation);
      } catch (error) {
        await generation.kernel.close();
        throw error;
      }
    });
    return this.generation ?? this.starting;
  }
  async inspect() {
    const generation = await this.current();
    return structuredClone({
      generation: generation.id,
      ...generation.resolved,
      plugins: generation.kernel.plugins,
      roots: ROOTS.map((name) => ({
        service: name,
        owner: `deepcode.root.${name}`,
        version: ROOT_VERSION,
      })),
    });
  }
  async reload(layers: readonly ProfileLayer[]): Promise<void> {
    if (this.changing || this.turns.size)
      throw new Error('Profile reload requires an idle bootstrap');
    this.changing = true;
    try {
      const previous = await this.current();
      const candidate = await this.candidate(resolveProfile(this.options.profileId, layers));
      // New admission is closed throughout candidate validation and publication.
      if (this.closed) {
        await candidate.kernel.close();
        throw new Error('Bootstrap is closed');
      }
      try {
        await this.persist(candidate);
      } catch (error) {
        await candidate.kernel.close();
        throw error;
      }
      this.generation = candidate;
      try {
        await previous.kernel.close();
      } catch (error) {
        this.closed = true;
        await candidate.kernel.close();
        throw new Error('cleanup_incomplete: profile retirement', { cause: error });
      }
    } finally {
      this.changing = false;
    }
  }
  async run<T>(
    signal: AbortSignal | undefined,
    run: (context: {
      signal: AbortSignal;
      generation: string;
      profile: ResolvedProfile['profile'];
    }) => Promise<T>,
  ): Promise<T> {
    if (this.closed || this.changing) throw new Error('Bootstrap is not accepting turns');
    const generation = await this.current();
    if (this.closed || this.changing) throw new Error('Bootstrap is not accepting turns');
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    combined.throwIfAborted();
    const operation = Promise.resolve().then(() =>
      run({
        signal: combined,
        generation: generation.id,
        profile: structuredClone(generation.resolved.profile),
      }),
    );
    this.turns.set(controller, operation);
    try {
      return await operation;
    } finally {
      this.turns.delete(controller);
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const controller of this.turns.keys()) controller.abort(new Error('Bootstrap shutdown'));
    this.closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled(this.turns.values()),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('cleanup_incomplete: bootstrap turns')),
              2500,
            );
          }),
        ]);
        const generation = this.generation ?? (await this.starting);
        await generation?.kernel.close();
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.closing;
  }
}
