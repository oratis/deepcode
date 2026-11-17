import { Context, type Fiber } from '@deepseek-ai/cordis';
export { Context } from '@deepseek-ai/cordis';
// The pinned package erases its const enum; isolated TS/esbuild cannot import it.
const CORDIS_ACTIVE_STATE = 2;

/** Trusted first-party runtime services only. External extensions never execute in this Context. */
export interface KernelPlugin {
  id: string;
  provides?: readonly string[];
  requires?: readonly string[];
  apply(context: Context): void | Promise<void>;
}

/** Validate the declared graph before running any plugin code. */
export function orderPlugins(plugins: readonly KernelPlugin[]): KernelPlugin[] {
  const ids = new Set<string>();
  const owners = new Map<string, KernelPlugin>();
  for (const plugin of plugins) {
    if (!plugin.id || ids.has(plugin.id))
      throw new Error(`Duplicate or empty plugin id: ${plugin.id}`);
    ids.add(plugin.id);
    for (const name of plugin.provides ?? []) {
      if (owners.has(name)) throw new Error(`Duplicate service: ${name}`);
      owners.set(name, plugin);
    }
  }
  const visiting = new Set<KernelPlugin>();
  const visited = new Set<KernelPlugin>();
  const ordered: KernelPlugin[] = [];
  const visit = (plugin: KernelPlugin) => {
    if (visited.has(plugin)) return;
    if (visiting.has(plugin)) throw new Error(`Dependency cycle at ${plugin.id}`);
    visiting.add(plugin);
    for (const name of plugin.requires ?? []) {
      const owner = owners.get(name);
      if (!owner) throw new Error(`Missing service ${name} required by ${plugin.id}`);
      visit(owner);
    }
    visiting.delete(plugin);
    visited.add(plugin);
    ordered.push(plugin);
  };
  plugins.forEach(visit);
  return ordered;
}

export interface Kernel {
  /** Cordis context owned by this kernel; callers must not reuse it after close. */
  readonly context: Context;
  readonly plugins: readonly string[];
  close(): Promise<void>;
}

/** Real Context/Fiber, with explicit graph admission and observable teardown failures. */
export async function createKernel(plugins: readonly KernelPlugin[]): Promise<Kernel> {
  const ordered = orderPlugins(plugins);
  const context = new Context();
  const fibers: Fiber[] = [];
  const errors: unknown[] = [];
  const removeExporter = context.logger.exporter({
    export(message) {
      if (message.type === 'error') errors.push(...message.args);
    },
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      // Consumers dispose before providers; Cordis owns each fiber's child effects.
      for (const fiber of [...fibers].reverse()) {
        try {
          await fiber.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      await removeExporter();
      if (errors.length) throw new AggregateError(errors, 'Kernel lifecycle failed');
    })();
    return closing;
  };
  try {
    for (const plugin of ordered) {
      const fiber = context.plugin({
        name: plugin.id,
        inject: [...(plugin.requires ?? [])],
        apply: plugin.apply,
      });
      fibers.push(fiber);
      await fiber.await();
      if (fiber.state !== CORDIS_ACTIVE_STATE || fiber.uid === null)
        throw new Error(`Plugin did not activate: ${plugin.id}`);
      for (const name of plugin.provides ?? []) {
        if (context.get(name) === undefined)
          throw new Error(`Plugin ${plugin.id} did not provide ${name}`);
      }
    }
    return { context, plugins: ordered.map((plugin) => plugin.id), close };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Kernel startup failed', { cause: cleanup });
    }
    throw error;
  }
}

/** Candidate activation is isolated; failed candidates never replace the active graph.
 * H02 tests use inert services. Live resource handoff/admission belongs to H03/H08.
 */
export class KernelSlot {
  private current: Kernel | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  get active(): Kernel | undefined {
    return this.current;
  }
  reload(plugins: readonly KernelPlugin[]): Promise<void> {
    const next = this.tail.then(async () => {
      if (this.closed) throw new Error('Kernel slot is closed');
      const candidate = await createKernel(plugins);
      const previous = this.current;
      this.current = undefined;
      try {
        await previous?.close();
      } catch (error) {
        await candidate.close();
        throw error;
      }
      this.current = candidate;
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.tail.then(async () => {
      const previous = this.current;
      this.current = undefined;
      await previous?.close();
    });
    return this.closing;
  }
}
