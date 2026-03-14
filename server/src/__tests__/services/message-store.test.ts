import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/schema.js');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER,
      message_id INTEGER,
      message_type TEXT NOT NULL,
      group_id INTEGER,
      user_id INTEGER NOT NULL,
      nickname TEXT,
      raw_message TEXT,
      time INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const db = drizzle(sqlite, { schema });
  return { db, rawDb: sqlite, schema };
});

import { rawDb } from '../../db/index.js';

describe('MessageStoreService', () => {
  let messageStoreService: Awaited<typeof import('../../services/message-store.js')>['messageStoreService'];

  beforeEach(async () => {
    rawDb.exec('DELETE FROM messages');
    vi.resetModules();
    const mod = await import('../../services/message-store.js');
    messageStoreService = mod.messageStoreService;
  });

  it('stores and retrieves a group message', () => {
    messageStoreService.store({
      message_id: 1001,
      message_type: 'group',
      group_id: 12345,
      user_id: 67890,
      sender: { nickname: 'TestUser' },
      raw_message: 'Hello world',
      time: 1700000000,
    });

    const result = messageStoreService.query();
    expect(result.total).toBe(1);
    expect(result.messages[0].messageType).toBe('group');
    expect(result.messages[0].groupId).toBe(12345);
    expect(result.messages[0].userId).toBe(67890);
    expect(result.messages[0].nickname).toBe('TestUser');
    expect(result.messages[0].rawMessage).toBe('Hello world');
  });

  it('stores a private message with no group_id', () => {
    messageStoreService.store({
      message_type: 'private',
      user_id: 11111,
      raw_message: 'DM content',
      time: 1700000001,
    });

    const result = messageStoreService.query({ messageType: 'private' });
    expect(result.total).toBe(1);
    expect(result.messages[0].groupId).toBeNull();
  });

  it('filters by message type', () => {
    messageStoreService.store({ message_type: 'group', group_id: 100, user_id: 1, time: 1700000000, raw_message: 'g1' });
    messageStoreService.store({ message_type: 'private', user_id: 2, time: 1700000001, raw_message: 'p1' });
    messageStoreService.store({ message_type: 'group', group_id: 200, user_id: 3, time: 1700000002, raw_message: 'g2' });

    expect(messageStoreService.query({ messageType: 'group' }).total).toBe(2);
    expect(messageStoreService.query({ messageType: 'private' }).total).toBe(1);
  });

  it('filters by group_id', () => {
    messageStoreService.store({ message_type: 'group', group_id: 100, user_id: 1, time: 1700000000, raw_message: 'a' });
    messageStoreService.store({ message_type: 'group', group_id: 200, user_id: 2, time: 1700000001, raw_message: 'b' });

    const result = messageStoreService.query({ groupId: 100 });
    expect(result.total).toBe(1);
    expect(result.messages[0].rawMessage).toBe('a');
  });

  it('filters by user_id', () => {
    messageStoreService.store({ message_type: 'group', group_id: 100, user_id: 1, time: 1700000000, raw_message: 'x' });
    messageStoreService.store({ message_type: 'group', group_id: 100, user_id: 2, time: 1700000001, raw_message: 'y' });

    const result = messageStoreService.query({ userId: 2 });
    expect(result.total).toBe(1);
    expect(result.messages[0].rawMessage).toBe('y');
  });

  it('searches message content', () => {
    messageStoreService.store({ message_type: 'group', group_id: 100, user_id: 1, time: 1700000000, raw_message: 'apple pie' });
    messageStoreService.store({ message_type: 'group', group_id: 100, user_id: 2, time: 1700000001, raw_message: 'banana split' });

    const result = messageStoreService.query({ search: 'apple' });
    expect(result.total).toBe(1);
    expect(result.messages[0].rawMessage).toBe('apple pie');
  });

  it('paginates correctly', () => {
    for (let i = 0; i < 5; i++) {
      messageStoreService.store({ message_type: 'group', group_id: 100, user_id: 1, time: 1700000000 + i, raw_message: `msg-${i}` });
    }

    const page1 = messageStoreService.query({ page: 1, limit: 2 });
    expect(page1.messages.length).toBe(2);
    expect(page1.total).toBe(5);

    const page3 = messageStoreService.query({ page: 3, limit: 2 });
    expect(page3.messages.length).toBe(1);
  });

  it('returns newest messages first', () => {
    messageStoreService.store({ message_type: 'group', group_id: 1, user_id: 1, time: 1700000000, raw_message: 'old' });
    messageStoreService.store({ message_type: 'group', group_id: 1, user_id: 1, time: 1700000010, raw_message: 'new' });

    const result = messageStoreService.query();
    expect(result.messages[0].rawMessage).toBe('new');
    expect(result.messages[1].rawMessage).toBe('old');
  });
});
