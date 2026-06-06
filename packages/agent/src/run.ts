import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL } from './client';
import { SYSTEM_PROMPT } from './systemPrompt';
import { toolDefinitions, toolHandlers, type ToolContext } from './tools';

export interface RunOptions {
  ctx: ToolContext;
  /** Prior conversation turns (alternating user/assistant). */
  history: Anthropic.MessageParam[];
  /** The new user message. */
  userText: string;
  /** Safety cap on tool-use round trips. */
  maxTurns?: number;
}

export interface RunResult {
  /** The assistant's final text reply. */
  reply: string;
  /** The full message list including this exchange (for persistence/debugging). */
  messages: Anthropic.MessageParam[];
}

/**
 * Run one user turn through Claude with an agentic tool-use loop.
 * The model may call tools any number of times before producing a final reply.
 */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { ctx, userText } = opts;
  const maxTurns = opts.maxTurns ?? 6;

  const messages: Anthropic.MessageParam[] = [
    ...opts.history,
    { role: 'user', content: userText },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      tools: toolDefinitions,
      messages,
    });

    // Preserve the assistant turn verbatim (including thinking blocks).
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply, messages };
    }

    // Execute every tool the model requested and feed results back.
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
