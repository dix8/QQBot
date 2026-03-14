import { db, schema } from '../db/index.js';
import { desc, and, eq, like, count, lt, type SQL } from 'drizzle-orm';
import { nowISO } from '../utils/date.js';

/** Escape LIKE wildcard characters for safe use in SQL LIKE patterns */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

export interface StoredMessage {
  id: number;
  botId: number | null;
  messageId: number | null;
  messageType: string;
  groupId: number | null;
  userId: number;
  nickname: string | null;
  rawMessage: string | null;
  time: number;
  createdAt: string;
}

export interface MessageQueryParams {
  botId?: number;
  messageType?: 'private' | 'group';
  groupId?: number;
  userId?: number;
  search?: string;
  page?: number;
  limit?: number;
}

export interface MessageQueryResult {
  messages: StoredMessage[];
  total: number;
  page: number;
  limit: number;
}

const MAX_MESSAGES = 50000;
const PRUNE_BATCH = 5000;

class MessageStoreService {
  private insertCount = 0;

  store(event: {
    message_id?: number;
    message_type: string;
    group_id?: number;
    user_id: number;
    sender?: { nickname?: string };
    raw_message?: string;
    time: number;
  }, botId?: number): void {
    db.insert(schema.messages)
      .values({
        botId: botId ?? null,
        messageId: event.message_id ?? null,
        messageType: event.message_type,
        groupId: event.group_id ?? null,
        userId: event.user_id,
        nickname: event.sender?.nickname ?? null,
        rawMessage: event.raw_message ?? null,
        time: event.time,
        createdAt: nowISO(),
      })
      .run();

    this.insertCount++;
    if (this.insertCount % 500 === 0) {
      this.prune();
    }
  }

  query(params: MessageQueryParams = {}): MessageQueryResult {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (params.botId != null) {
      conditions.push(eq(schema.messages.botId, params.botId));
    }
    if (params.messageType) {
      conditions.push(eq(schema.messages.messageType, params.messageType));
    }
    if (params.groupId != null) {
      conditions.push(eq(schema.messages.groupId, params.groupId));
    }
    if (params.userId != null) {
      conditions.push(eq(schema.messages.userId, params.userId));
    }
    if (params.search) {
      conditions.push(like(schema.messages.rawMessage, `%${escapeLike(params.search)}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = db.select({ count: count() })
      .from(schema.messages)
      .where(where)
      .get();

    const rows = db.select()
      .from(schema.messages)
      .where(where)
      .orderBy(desc(schema.messages.id))
      .limit(limit)
      .offset(offset)
      .all() as StoredMessage[];

    return { messages: rows, total: countResult?.count ?? 0, page, limit };
  }

  /** Remove oldest messages when total exceeds MAX_MESSAGES */
  private prune(): void {
    const total = db.select({ count: count() }).from(schema.messages).get();
    if (!total || total.count <= MAX_MESSAGES) return;

    const cutoff = db.select({ id: schema.messages.id })
      .from(schema.messages)
      .orderBy(desc(schema.messages.id))
      .limit(1)
      .offset(MAX_MESSAGES - PRUNE_BATCH)
      .get();

    if (cutoff) {
      db.delete(schema.messages).where(lt(schema.messages.id, cutoff.id)).run();
    }
  }
}

export const messageStoreService = new MessageStoreService();
