import Anthropic from '@anthropic-ai/sdk';

/** The Claude model the agent uses. Override with ANTHROPIC_MODEL. */
export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';

/** Shared Anthropic client (reads ANTHROPIC_API_KEY from the environment). */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
