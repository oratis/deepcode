import type { RunAgentOptions } from '../agent.js';
import { ToolExecutionService } from './tool-execution.js';

/** Compatibility adapter: SDK tools share the native/plugin execution service. */
export function createEngineToolRunner(options: RunAgentOptions & { onBlocked?: () => void }) {
  const service = options.toolExecution ?? new ToolExecutionService(options);
  return {
    get blocked() {
      return service.blocked;
    },
    async run(name: string, input: Record<string, unknown>, id: string) {
      const result = await service.run(name, input, id, options.signal, options.onEvent);
      if (service.blocked) options.onBlocked?.();
      return result;
    },
    drain: () => service.drain(),
  };
}
