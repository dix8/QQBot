import { db, schema } from '../db/index.js';
import { desc, and, eq, like, count, type SQL } from 'drizzle-orm';
import { nowISO } from '../utils/date.js';

/** Escape LIKE wildcard characters for safe use in SQL LIKE patterns */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

export interface AuditEntry {
  id: number;
  action: string;
  target: string | null;
  detail: string | null;
  username: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditQueryParams {
  action?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AuditQueryResult {
  logs: AuditEntry[];
  total: number;
  page: number;
  limit: number;
}

class AuditService {
  log(action: string, target?: string, detail?: string, username?: string, ip?: string): void {
    db.insert(schema.auditLogs)
      .values({
        action,
        target: target ?? null,
        detail: detail ?? null,
        username: username ?? null,
        ip: ip ?? null,
        createdAt: nowISO(),
      })
      .run();
  }

  query(params: AuditQueryParams = {}): AuditQueryResult {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (params.action) {
      conditions.push(eq(schema.auditLogs.action, params.action));
    }
    if (params.search) {
      conditions.push(like(schema.auditLogs.detail, `%${escapeLike(params.search)}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = db.select({ count: count() })
      .from(schema.auditLogs)
      .where(where)
      .get();

    const rows = db.select()
      .from(schema.auditLogs)
      .where(where)
      .orderBy(desc(schema.auditLogs.id))
      .limit(limit)
      .offset(offset)
      .all() as AuditEntry[];

    return { logs: rows, total: countResult?.count ?? 0, page, limit };
  }
}

export const auditService = new AuditService();
