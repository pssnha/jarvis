import { getProvider } from './llm';
import { circleUsageStatus } from './llm/limits';
import type { LlmMessage } from './llm/types';
import { executeProposalCommand, resolveProposalCommand } from './proposals';
import { buildSystemPrompt } from './systemPrompt';
import { toolsForSurface, type ToolContext, type ToolSurface } from './tools';

/** Reply returned in place of an LLM call when a circle is over its spend cap. */
const LIMIT_REACHED_REPLY =
  "I've reached this circle's LLM usage limit for now — an admin can raise it on the Billing page.";

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
  /** Trips in this group, so the assistant routes itinerary items correctly. */
  trips?: { id: string; title: string; destinations: string | null; start: string; end: string }[];
  /** Active page: scopes which tools the assistant may use (no cross-editing). */
  surface?: ToolSurface;
  maxTurns?: number;
}

export interface RunResult {
  reply: string;
}

/** Run one user turn through the configured LLM with the schedule tools available. */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  // Cap per-circle spend: refuse before incurring any LLM cost when over limit.
  const usage = await circleUsageStatus(opts.ctx.circleId, opts.ctx.timezone);
  if (usage.blocked) return { reply: LIMIT_REACHED_REPLY };

  // Resolve a numeric "add 1 and 2" / "no 3" reply against the CURRENT pending
  // codes deterministically — the LLM otherwise anchors on stale numbered lists
  // still sitting in the conversation history and refuses valid confirmations.
  if (opts.pendingProposals && opts.pendingProposals.length > 0) {
    const pendingCodes = opts.pendingProposals.map((p) => p.code);
    const cmd = resolveProposalCommand(opts.userText, pendingCodes);
    if (cmd) return { reply: await executeProposalCommand(opts.ctx.circleId, cmd, pendingCodes) };
  }

  const userText = opts.authorName ? `${opts.authorName}: ${opts.userText}` : opts.userText;

  // Only expose the tools for the active page so the assistant can't, say,
  // create a calendar event while the user is on the Vacations page.
  const active = toolsForSurface(opts.surface);
  const handlers = new Map(active.map((t) => [t.spec.name, t.handler]));
  const dispatch = async (name: string, input: Record<string, unknown>): Promise<string> => {
    const handler = handlers.get(name);
    if (!handler) return `Unknown tool: ${name}`;
    try {
      return await handler(input, opts.ctx);
    } catch (err) {
      return `Tool ${name} failed: ${(err as Error).message}`;
    }
  };

  const reply = await getProvider().runConversation({
    system: buildSystemPrompt(opts.ctx.timezone, {
      isAdmin: opts.ctx.isAdmin,
      groupContext: opts.ctx.groupContext,
      pendingProposals: opts.pendingProposals,
      trips: opts.trips,
      surface: opts.surface,
    }),
    history: opts.history,
    userText,
    tools: active.map((t) => t.spec),
    runTool: dispatch,
    maxTurns: opts.maxTurns,
    circleId: opts.ctx.circleId,
    source: opts.ctx.source,
  });
  return { reply };
}
