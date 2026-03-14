import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../services/password.js';

describe('hashPassword', () => {
  it('returns salt:key hex format', async () => {
    const hash = await hashPassword('test');
    expect(hash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it('produces different hashes for same password (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('mypassword');
    expect(await verifyPassword('mypassword', hash)).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('mypassword');
    expect(await verifyPassword('wrongpassword', hash)).toBe(false);
  });

  it('returns false for malformed hash', async () => {
    expect(await verifyPassword('test', 'invalid')).toBe(false);
    expect(await verifyPassword('test', '')).toBe(false);
  });

  it('verifies both hashes of same password', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(await verifyPassword('same', h1)).toBe(true);
    expect(await verifyPassword('same', h2)).toBe(true);
  });
});
