import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().default(3000),
  PUBLIC_WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Time zone used for the web-chat demo group. */
  WEB_DEMO_TIMEZONE: z.string().default('UTC'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),

  WHATSAPP_VERIFY_TOKEN: z.string().default('change-me-verify-token'),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().default('v21.0'),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
