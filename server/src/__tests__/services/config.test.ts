import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/schema.js');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE bot_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const db = drizzle(sqlite, { schema });

  return { db, rawDb: sqlite, schema };
});

import { rawDb } from '../../db/index.js';
import { ConfigService } from '../../services/config.js';
import { DEFAULT_CONFIG } from '../../types/config.js';

describe('ConfigService', () => {
  let config: ConfigService;

  beforeEach(() => {
    rawDb.exec('DELETE FROM bot_config');
    config = new ConfigService();
  });

  describe('get', () => {
    it('returns default config when nothing is set', () => {
      const basic = config.get(1, 'basic');
      expect(basic).toEqual(DEFAULT_CONFIG.basic);
    });

    it('returns undefined for unknown section', () => {
      expect(config.get(1, 'nonexistent')).toBeUndefined();
    });
  });

  describe('set / get round-trip', () => {
    it('stores and retrieves config', () => {
      const custom = { ...DEFAULT_CONFIG.basic, nickname: 'TestBot' };
      config.set(1, 'basic', custom);
      expect(config.get(1, 'basic')).toEqual(custom);
    });

    it('persists to database across instances', () => {
      config.set(1, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'Persisted' });
      const fresh = new ConfigService();
      expect(fresh.get<any>(1, 'basic').nickname).toBe('Persisted');
    });

    it('overwrites existing value', () => {
      config.set(1, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'First' });
      config.set(1, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'Second' });
      expect(config.get<any>(1, 'basic').nickname).toBe('Second');
    });
  });

  describe('exportAll / importAll', () => {
    it('exportAll returns all config sections with defaults', () => {
      const exported = config.exportAll(1);
      expect(exported).toHaveProperty('basic');
      expect(exported).toHaveProperty('message');
      expect(exported).toHaveProperty('runtime');
    });

    it('importAll sets all provided sections', () => {
      const data = {
        basic: { ...DEFAULT_CONFIG.basic, nickname: 'Imported' },
        message: DEFAULT_CONFIG.message,
        runtime: DEFAULT_CONFIG.runtime,
      };
      config.importAll(1, data);
      expect(config.get<any>(1, 'basic').nickname).toBe('Imported');
      expect(config.get(1, 'message')).toEqual(DEFAULT_CONFIG.message);
      expect(config.get(1, 'runtime')).toEqual(DEFAULT_CONFIG.runtime);
    });
  });

  describe('deleteForBot', () => {
    it('removes all config for a bot', () => {
      config.set(1, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'ToDelete' });
      config.set(1, 'message', DEFAULT_CONFIG.message);
      config.deleteForBot(1);
      // After delete, should fall back to defaults
      expect(config.get(1, 'basic')).toEqual(DEFAULT_CONFIG.basic);
    });

    it('does not affect other bots', () => {
      config.set(1, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'Bot1' });
      config.set(2, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'Bot2' });
      config.deleteForBot(1);
      expect(config.get<any>(2, 'basic').nickname).toBe('Bot2');
    });
  });

  describe('isolation between bots', () => {
    it('keeps config separate per bot', () => {
      config.set(1, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'Bot1' });
      config.set(2, 'basic', { ...DEFAULT_CONFIG.basic, nickname: 'Bot2' });
      expect(config.get<any>(1, 'basic').nickname).toBe('Bot1');
      expect(config.get<any>(2, 'basic').nickname).toBe('Bot2');
    });
  });
});
