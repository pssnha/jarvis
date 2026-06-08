import type { ExtractOpts, LlmProvider, RunConversationOpts } from './types';
import { toGeminiSchema } from './schema';

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

let aiInstance: any = null;

async function client(): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  if (!aiInstance) {
    // Dynamic import keeps this CJS build compatible with the SDK's module format.
    const { GoogleGenAI } = await import('@google/genai');
    aiInstance = new GoogleGenAI({ apiKey: key });
  }
  return aiInstance;
}

export const geminiProvider: LlmProvider = {
  name: 'gemini',

  async runConversation(opts: RunConversationOpts): Promise<string> {
    const ai = await client();
    const maxTurns = opts.maxTurns ?? 6;

    const functionDeclarations = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiSchema(t.parameters),
    }));
    const config = {
      systemInstruction: opts.system,
      tools: [{ functionDeclarations }],
    };

    const contents: any[] = opts.history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: opts.userText }] });

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents, config });
      const calls = response.functionCalls ?? [];

      if (calls.length === 0) {
        return (response.text ?? '').trim();
      }

      // Preserve the model turn (the function-call parts), then answer each call.
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent);

      const parts: any[] = [];
      for (const fc of calls) {
        const result = await opts.runTool(fc.name, (fc.args ?? {}) as Record<string, unknown>);
        parts.push({
          functionResponse: { name: fc.name, id: fc.id, response: { result } },
        });
      }
      contents.push({ role: 'user', parts });
    }

    return "Sorry, I couldn't complete that request.";
  },

  async extractStructured(opts: ExtractOpts): Promise<Record<string, unknown>> {
    const ai = await client();
    const functionDeclarations = [
      {
        name: opts.toolName,
        description: 'Record the extracted result.',
        parameters: toGeminiSchema(opts.schema),
      },
    ];
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: opts.text }] }],
      config: {
        systemInstruction: opts.system,
        tools: [{ functionDeclarations }],
        toolConfig: {
          functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [opts.toolName] },
        },
      },
    });
    const fc = (response.functionCalls ?? [])[0];
    return (fc?.args as Record<string, unknown>) ?? {};
  },
};
