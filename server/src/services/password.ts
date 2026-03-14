import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

/**
 * Hash a password using scrypt.
 * Returns "salt:derivedKey" in hex format.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verify a password against a stored "salt:derivedKey" hash.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  const derived = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;

  if (derived.length !== storedKey.length) return false;
  return timingSafeEqual(derived, storedKey);
}
