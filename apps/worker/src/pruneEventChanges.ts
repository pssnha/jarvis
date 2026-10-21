import { pruneChanges } from '@jarvis/agent';

/** Drop MCP change-feed entries past the retention window. */
export async function pruneEventChanges(): Promise<void> {
  try {
    const n = await pruneChanges();
    if (n > 0) console.log(`[changes] pruned ${n} old event changes`);
  } catch (err) {
    console.error('[changes] prune failed:', err);
  }
}
