import { describe, it, expect } from 'vitest';
import { decryptValue, encryptPhone, encryptValue, maskPhone, phoneHash } from '@jarvis/agent';

describe('phone encryption', () => {
  it('round-trips AES-GCM encryption', () => {
    const c = encryptValue('14085040985');
    expect(c).not.toContain('14085040985');
    expect(decryptValue(c)).toBe('14085040985');
  });

  it('blind index is deterministic and ignores formatting', () => {
    expect(phoneHash('+1 (408) 504-0985')).toBe(phoneHash('14085040985'));
    expect(phoneHash('14085040985')).not.toBe(phoneHash('14085040986'));
  });

  it('encryptPhone returns enc + matching hash', () => {
    const { enc, hash } = encryptPhone('+14085040985');
    expect(decryptValue(enc)).toBe('14085040985');
    expect(hash).toBe(phoneHash('14085040985'));
  });

  it('masks for display', () => {
    expect(maskPhone('+14085040985')).toBe('•••• 0985');
    expect(maskPhone(null)).toBeNull();
  });
});
