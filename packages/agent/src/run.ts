import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL } from './client';
import { buildSystemPrompt } from './systemPrompt';
import { toolDefinitions, toolHandlers, type ToolContext } from './tools';

export interface RunOptions {
  ctx: ToolContext;
  /** Prior conversation turns (alternating user/assistant). */
  history: Anthropic.MessageParam[];
  /** The new user message text. */
  userText: string;
  /** Sender's display name (group context). */
  authorName?: string;
  /** Safety cap on tool-use round trips. */
  maxTurns?: number;
}

export interface RunResult {
  reply: string;
  messages: Anthropic.MessageParam[];
}

/** Run one user turn through Claude with an agentic schedule-tool loop. */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { ctx } = opts;
  const maxTurns = opts.maxTurns ?? 6;
  const userText = opts.authorName ? `${opts.authorName}: ${opts.userText}` : opts.userText;

  const messages: Anthropic.MessageParam[] = [
    ...opts.history,
    { role: 'user', content: userText },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: buildSystemPrompt(ctx.timezone),
      thinking: { type: 'adaptive' },
      tools: toolDefinitions,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply, messages };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const handler = toolHandlers.get(block.name);
      let content: string;
      let isError = false;
      try {
        if (!handler) {
          content = `Unknown tool: ${block.name}`;
          isError = true;
        } else {
          content = await handler(block.input as Record<string, unknown>, ctx);
        }
      } catch (err) {
        content = `Tool ${block.name} failed: ${(err as Error).message}`;
        isError = true;
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content,
        is_error: isError,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { reply: "Sorry, I couldn't complete that request.", messages };
}
