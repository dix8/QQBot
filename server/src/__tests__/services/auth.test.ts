import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../config/env.js', () => ({
  env: {
    INITIAL_ADMIN_PASSWORD: 'test-password-123',
  },
}));

vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/schema.js');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_default_pwd INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const db = drizzle(sqlite, { schema });

  return { db, rawDb: sqlite, schema };
});

import { rawDb } from '../../db/index.js';
import { AuthService } from '../../services/auth.js';

const TEST_PASSWORD = 'test-password-123';

describe('AuthService', () => {
  let auth: AuthService;

  beforeEach(() => {
    rawDb.exec('DELETE FROM users');
    auth = new AuthService();
  });

  describe('seedDefaultAdmin', () => {
    it('creates admin user when no users exist', async () => {
      await auth.seedDefaultAdmin();
      const rows = rawDb.prepare('SELECT * FROM users').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].username).toBe('admin');
      expect(rows[0].token_version).toBe(1);
    });

    it('does nothing when users already exist', async () => {
      await auth.seedDefaultAdmin();
      await auth.seedDefaultAdmin();
      const rows = rawDb.prepare('SELECT * FROM users').all();
      expect(rows).toHaveLength(1);
    });
  });

  describe('validateLogin', () => {
    beforeEach(async () => {
      await auth.seedDefaultAdmin();
    });

    it('returns user for correct credentials', async () => {
      const result = await auth.validateLogin('admin', TEST_PASSWORD);
      expect(result).not.toBeNull();
      expect(result!.username).toBe('admin');
      expect(result!.id).toBeTypeOf('number');
      expect(result!.tokenVersion).toBe(1);
    });

    it('returns null for wrong password', async () => {
      const result = await auth.validateLogin('admin', 'wrong');
      expect(result).toBeNull();
    });

    it('returns null for non-existent user', async () => {
      const result = await auth.validateLogin('nobody', 'test');
      expect(result).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('succeeds with correct current password', async () => {
      await auth.seedDefaultAdmin();
      const user = (await auth.validateLogin('admin', TEST_PASSWORD))!;
      const changed = await auth.changePassword(user.id, TEST_PASSWORD, 'newpass12');
      expect(changed).toBe(true);

      const result = await auth.validateLogin('admin', 'newpass12');
      expect(result).not.toBeNull();
    });

    it('clears default password flag after change', async () => {
      await auth.seedDefaultAdmin();
      const user = (await auth.validateLogin('admin', TEST_PASSWORD))!;
      expect(auth.isDefaultPassword(user.id)).toBe(true);

      await auth.changePassword(user.id, TEST_PASSWORD, 'newpass12');
      expect(auth.isDefaultPassword(user.id)).toBe(false);
    });

    it('increments tokenVersion on password change', async () => {
      await auth.seedDefaultAdmin();
      const user = (await auth.validateLogin('admin', TEST_PASSWORD))!;
      expect(auth.getTokenVersion(user.id)).toBe(1);

      await auth.changePassword(user.id, TEST_PASSWORD, 'newpass12');
      expect(auth.getTokenVersion(user.id)).toBe(2);
    });

    it('fails with wrong current password', async () => {
      await auth.seedDefaultAdmin();
      const user = (await auth.validateLogin('admin', TEST_PASSWORD))!;
      const changed = await auth.changePassword(user.id, 'wrong', 'newpass12');
      expect(changed).toBe(false);
    });

    it('fails for non-existent user', async () => {
      const changed = await auth.changePassword(999, 'any', 'any');
      expect(changed).toBe(false);
    });
  });

  describe('changeUsername', () => {
    it('succeeds with valid new username', async () => {
      await auth.seedDefaultAdmin();
      const user = (await auth.validateLogin('admin', TEST_PASSWORD))!;
      const changed = auth.changeUsername(user.id, 'superadmin');
      expect(changed).toBe(true);

      const result = await auth.validateLogin('superadmin', TEST_PASSWORD);
      expect(result).not.toBeNull();
    });

    it('fails for non-existent user', () => {
      const changed = auth.changeUsername(999, 'newname');
      expect(changed).toBe(false);
    });
  });

  describe('isDefaultPassword', () => {
    it('returns true for freshly seeded admin', async () => {
      await auth.seedDefaultAdmin();
      const user = (await auth.validateLogin('admin', TEST_PASSWORD))!;
      expect(auth.isDefaultPassword(user.id)).toBe(true);
    });

    it('returns false for non-existent user', () => {
      expect(auth.isDefaultPassword(999)).toBe(false);
    });
  });

  describe('getTokenVersion', () => {
    it('returns 1 for new user', async () => {
      await auth.seedDefaultAdmin();
      const user = (await auth.validateLogin('admin', TEST_PASSWORD))!;
      expect(auth.getTokenVersion(user.id)).toBe(1);
    });

    it('returns 1 for non-existent user', () => {
      expect(auth.getTokenVersion(999)).toBe(1);
    });
  });
});
