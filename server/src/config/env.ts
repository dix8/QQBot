import { resolve } from 'node:path';

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function envBoolOrNumber(key: string, fallback: boolean): boolean | number {
  const val = process.env[key];
  if (!val) return fallback;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

export const env = {
  /** HTTP listen port */
  PORT: envInt('PORT', 3000),
  /** HTTP listen host */
  HOST: envStr('HOST', '0.0.0.0'),
  /** SQLite database file path */
  DB_PATH: envStr('DB_PATH', 'data/qqbot.db'),
  /** Plugin storage directory */
  PLUGINS_DIR: resolve(envStr('PLUGINS_DIR', 'data/plugins')),
  /** JWT secret (takes precedence over file) */
  JWT_SECRET: process.env.JWT_SECRET,
  /** File path for auto-generated JWT secret */
  JWT_SECRET_FILE: resolve(envStr('JWT_SECRET_FILE', 'data/.jwt-secret')),
  /** Heartbeat timeout in ms */
  HEARTBEAT_TIMEOUT_MS: envInt('HEARTBEAT_TIMEOUT_MS', 60000),
  /** OneBot API call timeout in ms */
  API_TIMEOUT_MS: envInt('API_TIMEOUT_MS', 30000),
  /** CORS allowed origin — set to specific origin in production (e.g. "https://example.com"), defaults to "*" (allow all) for development */
  CORS_ORIGIN: envStr('CORS_ORIGIN', '*'),
  /** Initial admin password (first run only). If not set, a random password is generated. */
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD,
  /** Fastify trustProxy setting. Default false. Accepts true/false/number. */
  TRUST_PROXY: envBoolOrNumber('TRUST_PROXY', false),
} as const;
