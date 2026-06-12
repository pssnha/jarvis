import { prisma } from '@jarvis/db';

/** One LLM call's token usage. Recorded best-effort for per-circle billing. */
export interface LlmUsageEntry {
  /** Null/undefined for calls made outside any circle context. */
  circleId?: string | null;
  model: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Persist a usage row. Never throws — usage logging must not break a reply. */
export async function recordLlmUsage(entry: LlmUsageEntry): Promise<void> {
  try {
    await prisma.llmUsage.create({
      data: {
        circleId: entry.circleId ?? null,
        model: entry.model,
        source: entry.source,
        inputTokens: entry.inputTokens || 0,
        outputTokens: entry.outputTokens || 0,
        cacheReadTokens: entry.cacheReadTokens || 0,
        cacheCreationTokens: entry.cacheCreationTokens || 0,
      },
    });
  } catch {
    // swallow — billing is non-critical
  }
}
