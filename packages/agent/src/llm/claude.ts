import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL } from '../client';
import type { ExtractOpts, LlmProvider, RunConversationOpts, UsageContext } from './types';
import { recordLlmUsage } from './usage';

/** Record an Anthropic response's token usage against the call's circle. */
function record(ctx: UsageContext, usage: Anthropic.Usage | undefined): void {
  if (!usage) return;
  void recordLlmUsage({
    circleId: ctx.circleId,
    source: ctx.source ?? 'unknown',
    model: MODEL,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  });
}

export const claudeProvider: LlmProvider = {
  name: 'claude',

  async runConversation(opts: RunConversationOpts): Promise<string> {
    const maxTurns = opts.maxTurns ?? 6;
    const tools: Anthropic.Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as any,
    }));

    const messages: Anthropic.MessageParam[] = opts.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    messages.push({ role: 'user', content: opts.userText });

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: opts.system,
        thinking: { type: 'adaptive' },
        tools,
        messages,
      });
      record(opts, response.usage);
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        return response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const content = await opts.runTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return "Sorry, I couldn't complete that request.";
  },

  async extractStructured(opts: ExtractOpts): Promise<Record<string, unknown>> {
    const response = await anthropic.messages.create({
      model: MODEL,
      // Rich emails (multi-leg trip itineraries) need room — too small a cap
      // truncates the tool call and yields an empty extraction.
      max_tokens: 8192,
      system: opts.system,
      tools: [
        {
          name: opts.toolName,
          description: 'Record the extracted result.',
          input_schema: opts.schema as any,
        },
      ],
      tool_choice: { type: 'tool', name: opts.toolName },
      messages: [{ role: 'user', content: opts.text }],
    });
    record(opts, response.usage);
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    return (toolUse?.input as Record<string, unknown>) ?? {};
  },
};
