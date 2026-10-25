import { describe, expect, it } from 'vitest';
import { ConfiguredProvider } from './configured.js';
import { CredentialsStore } from '../credentials/index.js';

for (const [model, key] of [
  ['kimi-k2.5', 'MOONSHOT_API_KEY'],
  ['glm-4.7', 'GLM_API_KEY'],
]) {
  const live =
    process.env.DEEPCODE_LIVE_TESTS === '1' && process.env[key!] ? describe : describe.skip;
  live(`live ${model}`, () => {
    it('completes a small text request', async () => {
      const provider = new ConfiguredProvider({
        settings: {},
        store: new CredentialsStore({ forceFile: true }),
      });
      const result = await provider.runTurn({
        model: model!,
        systemPrompt: 'Reply briefly.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }],
        tools: [],
        maxTokens: 4096,
        signal: AbortSignal.timeout(60_000),
      });
      expect(result.stopReason).toBe('end_turn');
      expect(result.content.some((block) => block.type === 'text' && block.text.length > 0)).toBe(
        true,
      );
    }, 65_000);
  });
}
