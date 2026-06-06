import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifySignature } from '../src/whatsapp/verify';

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    const secret = 'test-secret';
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifySignature(secret, body, sig)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    expect(verifySignature('secret', Buffer.from('x'), 'sha256=deadbeef')).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifySignature('secret', Buffer.from('x'), undefined)).toBe(false);
  });
});
