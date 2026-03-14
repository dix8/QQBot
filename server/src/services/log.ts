import { db, schema } from '../db/index.js';
import { eq, ne, like, gt, and, count, desc, asc, type SQL } from 'drizzle-orm';
import type { LogLevel, LogSource, LogEntry, LogQueryParams, LogQueryResult } from '../types/log.js';
import { nowISO } from '../utils/date.js';

/** Escape LIKE wildcard characters for safe use in SQL LIKE patterns */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

export class LogService {
  private broadcastFn: ((event: string, data: unknown) => void) | null = null;

  setBroadcast(fn: (event: string, data: unknown) => void): void {
    this.broadcastFn = fn;
  }

  addLog(level: LogLevel, source: LogSource, message: string, details?: string): void {
    const now = nowISO();
    const result = db.insert(schema.logs)
      .values({ level, source, message, details: details ?? null, createdAt: now })
      .returning()
      .get();
    if (this.broadcastFn && level !== 'debug') {
      this.broadcastFn('log:new', result);
    }
  }

  queryLogs(params: LogQueryParams = {}): LogQueryResult {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = (page - 1) * limit;
    const search = params.search?.slice(0, 200);

    const conditions: SQL[] = [];

    if (params.level) {
      conditions.push(eq(schema.logs.level, params.level));
    } else {
      conditions.push(ne(schema.logs.level, 'debug'));
    }
    if (params.source) {
      conditions.push(eq(schema.logs.source, params.source));
    }
    if (search) {
      conditions.push(like(schema.logs.message, `%${escapeLike(search)}%`));
    }
    if (params.sinceId) {
      conditions.push(gt(schema.logs.id, params.sinceId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = db.select({ count: count() })
      .from(schema.logs)
      .where(where)
      .get();

    const rows = db.select({
      id: schema.logs.id,
      level: schema.logs.level,
      source: schema.logs.source,
      message: schema.logs.message,
      details: schema.logs.details,
      createdAt: schema.logs.createdAt,
    })
      .from(schema.logs)
      .where(where)
      .orderBy(desc(schema.logs.id))
      .limit(limit)
      .offset(offset)
      .all() as LogEntry[];

    return {
      logs: rows,
      total: countResult?.count ?? 0,
      page,
      limit,
    };
  }

  getLogsSince(sinceId: number, level?: LogLevel): LogEntry[] {
    const conditions: SQL[] = [gt(schema.logs.id, sinceId)];
    if (level) {
      conditions.push(eq(schema.logs.level, level));
    } else {
      conditions.push(ne(schema.logs.level, 'debug'));
    }
    return db.select({
      id: schema.logs.id,
      level: schema.logs.level,
      source: schema.logs.source,
      message: schema.logs.message,
      details: schema.logs.details,
      createdAt: schema.logs.createdAt,
    })
      .from(schema.logs)
      .where(and(...conditions))
      .orderBy(asc(schema.logs.id))
      .limit(200)
      .all() as LogEntry[];
  }

  clearLogs(): void {
    db.delete(schema.logs).run();
    this.addLog('info', 'system', '日志已清空');
  }
}

export const logService = new LogService();
