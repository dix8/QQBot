import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/schema.js');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      username TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const db = drizzle(sqlite, { schema });
  return { db, rawDb: sqlite, schema };
});

import { rawDb } from '../../db/index.js';

describe('AuditService', () => {
  let auditService: Awaited<typeof import('../../services/audit.js')>['auditService'];

  beforeEach(async () => {
    rawDb.exec('DELETE FROM audit_logs');
    vi.resetModules();
    const mod = await import('../../services/audit.js');
    auditService = mod.auditService;
  });

  it('logs an audit entry and queries it back', () => {
    auditService.log('config_update', 'bot-1', 'Updated basic config', 'admin', '127.0.0.1');
    const result = auditService.query();
    expect(result.total).toBe(1);
    expect(result.logs[0].action).toBe('config_update');
    expect(result.logs[0].target).toBe('bot-1');
    expect(result.logs[0].username).toBe('admin');
    expect(result.logs[0].ip).toBe('127.0.0.1');
  });

  it('supports filtering by action', () => {
    auditService.log('login', 'user1', 'Login success', 'admin', '1.1.1.1');
    auditService.log('config_update', 'bot-1', 'Config changed', 'admin', '1.1.1.1');
    auditService.log('login', 'user2', 'Login success', 'user2', '2.2.2.2');

    const logins = auditService.query({ action: 'login' });
    expect(logins.total).toBe(2);

    const configs = auditService.query({ action: 'config_update' });
    expect(configs.total).toBe(1);
  });

  it('supports search in detail', () => {
    auditService.log('plugin_enable', 'example', 'Enabled example plugin', 'admin', '127.0.0.1');
    auditService.log('plugin_disable', 'other', 'Disabled other plugin', 'admin', '127.0.0.1');

    const result = auditService.query({ search: 'example' });
    expect(result.total).toBe(1);
    expect(result.logs[0].action).toBe('plugin_enable');
  });

  it('paginates correctly', () => {
    for (let i = 0; i < 5; i++) {
      auditService.log('test', `target-${i}`, `Detail ${i}`, 'admin', '127.0.0.1');
    }

    const page1 = auditService.query({ page: 1, limit: 2 });
    expect(page1.logs.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);

    const page2 = auditService.query({ page: 2, limit: 2 });
    expect(page2.logs.length).toBe(2);
    expect(page2.page).toBe(2);

    const page3 = auditService.query({ page: 3, limit: 2 });
    expect(page3.logs.length).toBe(1);
  });

  it('returns results in descending order (newest first)', () => {
    auditService.log('first', undefined, 'First', undefined, undefined);
    auditService.log('second', undefined, 'Second', undefined, undefined);
    const result = auditService.query();
    expect(result.logs[0].action).toBe('second');
    expect(result.logs[1].action).toBe('first');
  });

  it('handles optional fields as null', () => {
    auditService.log('test_action');
    const result = auditService.query();
    expect(result.logs[0].target).toBeNull();
    expect(result.logs[0].detail).toBeNull();
    expect(result.logs[0].username).toBeNull();
    expect(result.logs[0].ip).toBeNull();
  });
});
