import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/schema.js');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const db = drizzle(sqlite, { schema });

  return { db, rawDb: sqlite, schema };
});

import { rawDb } from '../../db/index.js';
import { LogService } from '../../services/log.js';

describe('LogService', () => {
  let log: LogService;

  beforeEach(() => {
    rawDb.exec('DELETE FROM logs');
    log = new LogService();
  });

  describe('addLog', () => {
    it('inserts a log with all fields', () => {
      log.addLog('info', 'system', 'test message', 'test details');
      const result = log.queryLogs();
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toMatchObject({
        level: 'info',
        source: 'system',
        message: 'test message',
        details: 'test details',
      });
    });

    it('inserts a log without details', () => {
      log.addLog('warn', 'plugin', 'no details');
      const result = log.queryLogs();
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].details).toBeNull();
    });

    it('auto-assigns an incrementing id', () => {
      log.addLog('info', 'system', 'first');
      log.addLog('info', 'system', 'second');
      const result = log.queryLogs();
      expect(result.logs[0].id).toBeGreaterThan(result.logs[1].id);
    });
  });

  describe('queryLogs', () => {
    beforeEach(() => {
      log.addLog('info', 'system', 'system info');
      log.addLog('warn', 'plugin', 'plugin warn');
      log.addLog('error', 'connection', 'conn error');
      log.addLog('info', 'plugin', 'plugin info');
      log.addLog('debug', 'system', 'debug msg');
    });

    it('returns non-debug logs by default', () => {
      const result = log.queryLogs();
      expect(result.logs).toHaveLength(4);
      expect(result.total).toBe(4);
      expect(result.page).toBe(1);
      result.logs.forEach(l => expect(l.level).not.toBe('debug'));
    });

    it('returns all logs including debug when level=debug is specified', () => {
      const result = log.queryLogs({ level: 'debug' });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].level).toBe('debug');
    });

    it('filters by level', () => {
      const result = log.queryLogs({ level: 'info' });
      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
      result.logs.forEach((l) => expect(l.level).toBe('info'));
    });

    it('filters by source', () => {
      const result = log.queryLogs({ source: 'plugin' });
      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
      result.logs.forEach((l) => expect(l.source).toBe('plugin'));
    });

    it('filters by search keyword', () => {
      const result = log.queryLogs({ search: 'plugin' });
      expect(result.logs).toHaveLength(2);
    });

    it('filters by sinceId', () => {
      const all = log.queryLogs();
      const oldestId = Math.min(...all.logs.map((l) => l.id));
      const result = log.queryLogs({ sinceId: oldestId });
      expect(result.logs).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('combines multiple filters', () => {
      const result = log.queryLogs({ level: 'info', source: 'plugin' });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toBe('plugin info');
    });

    it('paginates correctly', () => {
      const page1 = log.queryLogs({ limit: 2, page: 1 });
      const page2 = log.queryLogs({ limit: 2, page: 2 });
      expect(page1.logs).toHaveLength(2);
      expect(page2.logs).toHaveLength(2);
      expect(page1.total).toBe(4);
      // Pages should not overlap
      const page1Ids = page1.logs.map((l) => l.id);
      const page2Ids = page2.logs.map((l) => l.id);
      expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
    });

    it('orders by id DESC (newest first)', () => {
      const result = log.queryLogs();
      for (let i = 0; i < result.logs.length - 1; i++) {
        expect(result.logs[i].id).toBeGreaterThan(result.logs[i + 1].id);
      }
    });

    it('caps limit at 200', () => {
      const result = log.queryLogs({ limit: 999 });
      expect(result.limit).toBe(200);
    });
  });

  describe('getLogsSince', () => {
    it('returns logs after a given id in ASC order', () => {
      log.addLog('info', 'system', 'first');
      log.addLog('info', 'system', 'second');
      log.addLog('info', 'system', 'third');

      const all = log.queryLogs();
      const oldestId = Math.min(...all.logs.map((l) => l.id));
      const result = log.getLogsSince(oldestId);
      expect(result).toHaveLength(2);
      // ASC order
      expect(result[0].id).toBeLessThan(result[1].id);
    });

    it('returns empty array when no logs after sinceId', () => {
      log.addLog('info', 'system', 'only');
      const all = log.queryLogs();
      const maxId = Math.max(...all.logs.map((l) => l.id));
      const result = log.getLogsSince(maxId);
      expect(result).toHaveLength(0);
    });

    it('limits to 200 results', () => {
      // Insert 210 logs
      for (let i = 0; i < 210; i++) {
        log.addLog('info', 'system', `log ${i}`);
      }
      const result = log.getLogsSince(0);
      expect(result).toHaveLength(200);
    });
  });

  describe('clearLogs', () => {
    it('removes all logs and adds a "cleared" log entry', () => {
      log.addLog('info', 'system', 'will be cleared');
      log.addLog('error', 'plugin', 'also cleared');
      log.clearLogs();

      const result = log.queryLogs();
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toBe('日志已清空');
      expect(result.logs[0].level).toBe('info');
      expect(result.logs[0].source).toBe('system');
    });
  });
});
