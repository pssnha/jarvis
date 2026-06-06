import type Anthropic from '@anthropic-ai/sdk';

/** Context passed to every tool handler. */
export interface ToolContext {
  /** The app user id the agent is acting on behalf of. */
  userId: string;
}

/** A tool definition paired with the function that executes it. */
export interface AgentTool {
  definition: Anthropic.Tool;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

/**
 * The agent's tool surface. These are placeholders — replace/extend them with
 * tools that act on your domain (e.g. create an order, look up a record). Each
 * handler can use `packages/db` to read/write MySQL.
 */
export const tools: AgentTool[] = [
  {
    definition: {
      name: 'get_server_time',
      description:
        'Get the current server time as an ISO-8601 string. Call this when the user asks what time or date it is.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    handler: async () => new Date().toISOString(),
  },
  {
    definition: {
      name: 'save_note',
      description:
        'Save a short note for the current user. Call this when the user asks you to remember or jot something down.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The note content to save.' },
        },
        required: ['text'],
      },
    },
    handler: async (input, ctx) => {
      const text = String(input.text ?? '').trim();
      if (!text) return 'Nothing to save.';
      // TODO: persist to a domain table via `packages/db` once the schema is defined.
      return `Saved a note for user ${ctx.userId}: "${text}"`;
    },
  },
];

export const toolDefinitions: Anthropic.Tool[] = tools.map((t) => t.definition);

export const toolHandlers = new Map(tools.map((t) => [t.definition.name, t.handler]));
