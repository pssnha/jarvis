import { claudeProvider } from './claude';
import { geminiProvider } from './gemini';
import type { LlmProvider } from './types';

export * from './types';
export * from './schema';

let cached: LlmProvider | null = null;

/**
 * Choose the LLM backend.
 * - LLM_PROVIDER=gemini|claude forces a choice.
 * - Otherwise: Gemini if GEMINI_API_KEY is set, else Claude.
 */
export function getProvider(): LlmProvider {
  if (cached) return cached;
  const choice = (process.env.LLM_PROVIDER ?? '').toLowerCase();
  if (choice === 'claude') cached = claudeProvider;
  else if (choice === 'gemini') cached = geminiProvider;
  else cached = process.env.GEMINI_API_KEY ? geminiProvider : claudeProvider;
  return cached;
}
