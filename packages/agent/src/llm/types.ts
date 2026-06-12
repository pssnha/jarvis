import type { JsonSchema } from './schema';

/** A provider-neutral tool definition. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** A simplified conversation turn (text only). */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Usage-attribution context recorded for billing (optional). */
export interface UsageContext {
  /** Circle the call belongs to; null/undefined → not attributed to a circle. */
  circleId?: string | null;
  /** Where the call originated: web | whatsapp | email | alexa | … */
  source?: string;
}

export interface RunConversationOpts extends UsageContext {
  system: string;
  history: LlmMessage[];
  userText: string;
  tools: ToolSpec[];
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxTurns?: number;
}

export interface ExtractOpts extends UsageContext {
  system: string;
  text: string;
  toolName: string;
  schema: JsonSchema;
}

/** A pluggable LLM backend (Claude, Gemini, …). */
export interface LlmProvider {
  name: string;
  /** Run an agentic tool-use loop and return the final assistant text. */
  runConversation(opts: RunConversationOpts): Promise<string>;
  /** Force a single structured tool call and return its arguments. */
  extractStructured(opts: ExtractOpts): Promise<Record<string, unknown>>;
}
