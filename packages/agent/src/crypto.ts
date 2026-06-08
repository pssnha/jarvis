import crypto from 'node:crypto';

const SECRET = process.env.ENCRYPTION_KEY || 'dev-insecure-encryption-key-change-me';
const ENC_KEY = crypto.createHash('sha256').update(`${SECRET}:enc`).digest(); // 32 bytes
const MAC_KEY = crypto.createHash('sha256').update(`${SECRET}:mac`).digest();

/** Normalize a phone number to digits only (so +1 408… and 1408… match). */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

/** AES-256-GCM encrypt → base64(iv|tag|ciphertext). */
export function encryptValue(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decrypt a base64(iv|tag|ciphertext) value, or null if it can't be read. */
export function decryptValue(b64: string): string | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Deterministic blind index of a phone number, for equality lookups. */
export function phoneHash(value: string): string {
  return crypto.createHmac('sha256', MAC_KEY).update(normalizePhone(value)).digest('hex');
}

/** Encrypt a phone number → { enc, hash }. */
export function encryptPhone(value: string): { enc: string; hash: string } {
  const normalized = normalizePhone(value);
  return { enc: encryptValue(normalized), hash: phoneHash(normalized) };
}

/** Mask a phone number for display, e.g. "•••• 0985". */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = normalizePhone(value);
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : '••••';
}
