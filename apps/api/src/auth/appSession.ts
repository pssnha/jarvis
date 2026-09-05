import crypto from 'node:crypto';

/**
 * One-time codes that let the iOS app turn its OAuth Bearer token into the web
 * session cookie inside its embedded web view (Google refuses to sign in inside
 * WKWebView, so the app signs in natively and hands the session over here).
 * In-memory is fine: the API is a single process and a code lives for a minute.
 */
const TTL_MS = 60_000;
const codes = new Map<string, { authUserId: string; expiresAt: number }>();

export function mintAppSessionCode(authUserId: string): string {
  for (const [k, v] of codes) if (v.expiresAt < Date.now()) codes.delete(k);
  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(code, { authUserId, expiresAt: Date.now() + TTL_MS });
  return code;
}

/** Consume a code (single use); null if unknown or expired. */
export function redeemAppSessionCode(code: string): string | null {
  const entry = codes.get(code);
  codes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.authUserId;
}
