import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().default(3000),
  PUBLIC_WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Time zone used for the web-chat demo group. */
  WEB_DEMO_TIMEZONE: z.string().default('UTC'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // ---- Auth (Google OAuth + session) ----
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Secret for signing the session cookie. Set a strong value in production. */
  AUTH_SECRET: z.string().default('dev-insecure-secret-change-me'),
  /** Public base URL the browser uses (for the OAuth callback + post-login redirect). */
  AUTH_BASE_URL: z.string().default('http://localhost:5173'),
  /** Seeded admin account (the identity that signs in via Google). */
  ADMIN_EMAIL: z.string().default('passanha@gmail.com'),
  /** Where site notifications (e.g. new sign-ups) are sent + public contact address. */
  ADMIN_NOTIFY_EMAIL: z.string().default('jarvis@passanha.com'),

  // ---- Outbound email (SMTP) — used for sign-up notifications + approvals. ----
  /** When unset, mail is logged to the console instead of being delivered. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  // NB: z.coerce.boolean() treats any non-empty string (incl. "false") as true,
  // so parse the flag explicitly. true => implicit TLS (port 465); false (the
  // default) => STARTTLS (port 587).
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** From: header for outbound mail (defaults to ADMIN_NOTIFY_EMAIL). */
  MAIL_FROM: z.string().optional(),

  /** Current terms & conditions version applicants must accept. */
  TERMS_VERSION: z.string().default('2026-06-12'),

  /** Grace period (days) a soft-deleted circle is retained before the worker purges it. */
  CIRCLE_PURGE_GRACE_DAYS: z.coerce.number().default(30),
  /** Minutes a site-admin break-glass support grant stays valid after unlocking. */
  SUPPORT_ACCESS_MINUTES: z.coerce.number().default(30),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),

  WHATSAPP_VERIFY_TOKEN: z.string().default('change-me-verify-token'),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().default('v21.0'),

  // ---- Telegram (single shared bot via BotFather; privacy mode disabled) ----
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Verifies inbound webhooks (X-Telegram-Bot-Api-Secret-Token header). */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** Bot @username, for t.me deep links shown in the UI. */
  TELEGRAM_BOT_USERNAME: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
