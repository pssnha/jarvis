/**
 * Estimated LLM pricing for the Billing view. Values are USD per 1,000,000
 * tokens, based on published list prices — they are estimates, not invoices.
 * Adjust a single rate here to change every (re-computed) cost.
 */
export interface ModelRate {
  input: number;
  output: number;
  /** Cache read / write (Anthropic prompt caching). Fall back to `input` if unset. */
  cacheRead?: number;
  cacheWrite?: number;
}

const PRICING: { match: RegExp; rate: ModelRate }[] = [
  { match: /opus/i, rate: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: /sonnet/i, rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /haiku/i, rate: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  { match: /gemini.*(pro)/i, rate: { input: 1.25, output: 10 } },
  { match: /gemini/i, rate: { input: 0.3, output: 2.5 } },
];

/** Conservative fallback (Opus-class) for unrecognised models. */
const DEFAULT_RATE: ModelRate = { input: 15, output: 75 };

export function rateForModel(model: string): ModelRate {
  return PRICING.find((p) => p.match.test(model))?.rate ?? DEFAULT_RATE;
}

/** Estimated USD cost for a usage record. */
export function estimateCost(u: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): number {
  const r = rateForModel(u.model);
  const read = (u.cacheReadTokens ?? 0) * (r.cacheRead ?? r.input);
  const write = (u.cacheCreationTokens ?? 0) * (r.cacheWrite ?? r.input);
  return (u.inputTokens * r.input + u.outputTokens * r.output + read + write) / 1_000_000;
}
