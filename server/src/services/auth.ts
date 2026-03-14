import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db, schema } from '../db/index.js';
import { hashPassword, verifyPassword } from './password.js';
import { nowISO } from '../utils/date.js';
import { env } from '../config/env.js';

const DEFAULT_USERNAME = 'admin';

export class AuthService {
  /**
   * Seed the default admin account if no users exist.
   * Uses INITIAL_ADMIN_PASSWORD env var, or generates a random one-time password.
   */
  async seedDefaultAdmin(): Promise<void> {
    const existing = db.select().from(schema.users).all();
    if (existing.length > 0) return;

    const initialPassword = env.INITIAL_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
    const hash = await hashPassword(initialPassword);
    db.insert(schema.users).values({
      username: DEFAULT_USERNAME,
      passwordHash: hash,
      isDefaultPwd: 1,
      tokenVersion: 1,
    }).run();

    // Print the initial password prominently in the console
    console.log('');
    console.log('='.repeat(60));
    console.log('  初始管理员账号已创建');
    console.log(`  用户名: ${DEFAULT_USERNAME}`);
    if (env.INITIAL_ADMIN_PASSWORD) {
      console.log('  密码: 已从环境变量 INITIAL_ADMIN_PASSWORD 读取');
    } else {
      console.log(`  密码: ${initialPassword}`);
      console.log('  （随机生成，请立即登录并修改密码）');
    }
    console.log('='.repeat(60));
    console.log('');
  }

  /**
   * Validate login credentials. Returns user info or null on failure.
   */
  async validateLogin(username: string, password: string): Promise<{ id: number; username: string; tokenVersion: number } | null> {
    const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (!user) return null;

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;

    return { id: user.id, username: user.username, tokenVersion: user.tokenVersion };
  }

  /**
   * Change password for a user. Returns true on success, false if current password is wrong.
   * Increments tokenVersion to invalidate all existing JWTs.
   */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return false;

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return false;

    const newHash = await hashPassword(newPassword);
    const newTokenVersion = (user.tokenVersion ?? 1) + 1;
    db.update(schema.users)
      .set({ passwordHash: newHash, isDefaultPwd: 0, tokenVersion: newTokenVersion, updatedAt: nowISO() })
      .where(eq(schema.users.id, userId))
      .run();

    return true;
  }

  /**
   * Change username for a user. Returns true on success.
   */
  changeUsername(userId: number, newUsername: string): boolean {
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return false;

    // Check if username is already taken
    const existing = db.select().from(schema.users).where(eq(schema.users.username, newUsername)).get();
    if (existing && existing.id !== userId) return false;

    db.update(schema.users)
      .set({ username: newUsername, updatedAt: nowISO() })
      .where(eq(schema.users.id, userId))
      .run();

    return true;
  }

  /**
   * Check if a user is still using the default password (fast DB lookup, no scrypt).
   */
  isDefaultPassword(userId: number): boolean {
    const user = db.select({ isDefaultPwd: schema.users.isDefaultPwd }).from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return false;
    return user.isDefaultPwd === 1;
  }

  /**
   * Get the current tokenVersion for a user. Used for JWT validation.
   */
  getTokenVersion(userId: number): number {
    const user = db.select({ tokenVersion: schema.users.tokenVersion }).from(schema.users).where(eq(schema.users.id, userId)).get();
    return user?.tokenVersion ?? 1;
  }
}

export const authService = new AuthService();
