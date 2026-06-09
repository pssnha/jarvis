import { getProvider } from './llm';
import type { LlmMessage } from './llm/types';
import { buildSystemPrompt } from './systemPrompt';
import { toolHandlers, toolSpecs, type ToolContext } from './tools';

export interface RunOptions {
  ctx: ToolContext;
  /** Prior conversation turns (oldest first). */
  history: LlmMessage[];
  /** The new user message text. */
  userText: string;
  /** Sender's display name (group context). */
  authorName?: string;
  /** Email proposals awaiting confirmation in this group. */
  pendingProposals?: { code: string; kind: string; summary: string }[];
  maxTurns?: number;
}

export interface RunResult {
  reply: string;
}

async function dispatch(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const handler = toolHandlers.get(name);
  if (!handler) return `Unknown tool: ${name}`;
  try {
    return await handler(input, ctx);
  } catch (err) {
    return `Tool ${name} failed: ${(err as Error).message}`;
  }
}

/** Run one user turn through the configured LLM with the schedule tools available. */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const userText = opts.authorName ? `${opts.authorName}: ${opts.userText}` : opts.userText;
  const reply = await getProvider().runConversation({
    system: buildSystemPrompt(opts.ctx.timezone, {
      isAdmin: opts.ctx.isAdmin,
      maintenance: opts.ctx.maintenance,
      pendingProposals: opts.pendingProposals,
    }),
    history: opts.history,
    userText,
    tools: toolSpecs,
    runTool: (name, input) => dispatch(name, input, opts.ctx),
    maxTurns: opts.maxTurns,
  });
  return { reply };
}
