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
  /** Attachments (PDF/image) for the new user turn — the model reads them as
   *  vision input alongside `userText`. History turns stay text-only. */
  documents?: LlmDocument[];
  tools: ToolSpec[];
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxTurns?: number;
}

/** A binary document (PDF/image) fed to the LLM alongside the prompt text. */
export interface LlmDocument {
  /** Base64-encoded file bytes. */
  data: string;
  /** MIME type, e.g. "application/pdf", "image/png", "image/jpeg". */
  mediaType: string;
  filename?: string;
}

export interface ExtractOpts extends UsageContext {
  system: string;
  text: string;
  toolName: string;
  schema: JsonSchema;
  /** Optional attachments (e.g. an itinerary PDF) to extract from. */
  documents?: LlmDocument[];
}

/** A pluggable LLM backend (Claude, Gemini, …). */
export interface LlmProvider {
  name: string;
  /** Run an agentic tool-use loop and return the final assistant text. */
  runConversation(opts: RunConversationOpts): Promise<string>;
  /** Force a single structured tool call and return its arguments. */
  extractStructured(opts: ExtractOpts): Promise<Record<string, unknown>>;
}
