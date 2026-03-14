import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../config/env.js';
import * as schema from './schema.js';

// Ensure the data directory exists
mkdirSync(dirname(env.DB_PATH), { recursive: true });

const sqlite = new Database(env.DB_PATH);

// Enable WAL mode for better concurrency
sqlite.pragma('journal_mode = WAL');

// Safe column migrations (SQLite ALTER TABLE ADD COLUMN is idempotent-safe with try/catch)
try {
  sqlite.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1");
} catch { /* column already exists */ }

export const db = drizzle(sqlite, { schema });
/** @deprecated 仅供测试 cleanup 使用，业务代码请使用 Drizzle `db` */
export const rawDb: DatabaseType = sqlite;
export { schema };

// Apply pending migrations
migrate(db, { migrationsFolder: './drizzle' });
