import crypto from 'node:crypto';

/**
 * Verify the `X-Hub-Signature-256` header Meta sends with each webhook delivery.
 * It is `sha256=<hex hmac>` of the raw request body keyed by the app secret.
 */
export function verifySignature(
  appSecret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
