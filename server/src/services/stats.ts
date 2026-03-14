import { db, schema } from '../db/index.js';
import { sql } from 'drizzle-orm';

export interface HourlyBucket {
  /** Hour key: "YYYY-MM-DD HH" */
  hour: string;
  received: number;
  sent: number;
}

export interface RankedEntry {
  id: number;
  count: number;
}

export interface StatsSnapshot {
  hourly: HourlyBucket[];
  topGroups: RankedEntry[];
  topUsers: RankedEntry[];
  totalReceived: number;
  totalSent: number;
}

export interface DailyBucket {
  date: string;
  received: number;
  sent: number;
}

const FLUSH_INTERVAL_MS = 5 * 60_000;

class StatsService {
  private hourly = new Map<string, { received: number; sent: number }>();
  private groupCounts = new Map<number, number>();
  private userCounts = new Map<number, number>();
  private totalReceived = 0;
  private totalSent = 0;

  private dirtyHours = new Set<string>();
  private dirtyGroups = new Set<number>();
  private dirtyUsers = new Set<number>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  initialize(): void {
    this.loadFromDb();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private loadFromDb(): void {
    const hourRows = db.select().from(schema.messageStats).all();
    for (const row of hourRows) {
      this.hourly.set(row.hour, { received: row.received, sent: row.sent });
      this.totalReceived += row.received;
      this.totalSent += row.sent;
    }

    const rankRows = db.select().from(schema.messageRankings).all();
    for (const row of rankRows) {
      if (row.type === 'group') {
        this.groupCounts.set(row.targetId, row.count);
      } else if (row.type === 'user') {
        this.userCounts.set(row.targetId, row.count);
      }
    }
  }

  private getCurrentHourKey(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}`;
  }

  private getOrCreateHourBucket(key: string) {
    let bucket = this.hourly.get(key);
    if (!bucket) {
      bucket = { received: 0, sent: 0 };
      this.hourly.set(key, bucket);
    }
    return bucket;
  }

  recordReceived(groupId?: number, userId?: number): void {
    this.totalReceived++;
    const key = this.getCurrentHourKey();
    const bucket = this.getOrCreateHourBucket(key);
    bucket.received++;
    this.dirtyHours.add(key);

    if (groupId) {
      this.groupCounts.set(groupId, (this.groupCounts.get(groupId) ?? 0) + 1);
      this.dirtyGroups.add(groupId);
    }
    if (userId) {
      this.userCounts.set(userId, (this.userCounts.get(userId) ?? 0) + 1);
      this.dirtyUsers.add(userId);
    }
  }

  recordSent(): void {
    this.totalSent++;
    const key = this.getCurrentHourKey();
    const bucket = this.getOrCreateHourBucket(key);
    bucket.sent++;
    this.dirtyHours.add(key);
  }

  getSnapshot(topN = 10): StatsSnapshot {
    const now = new Date();
    const hourly: HourlyBucket[] = [];
    for (let i = 23; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 3600_000);
      const y = t.getFullYear();
      const m = String(t.getMonth() + 1).padStart(2, '0');
      const d = String(t.getDate()).padStart(2, '0');
      const h = String(t.getHours()).padStart(2, '0');
      const key = `${y}-${m}-${d} ${h}`;
      const bucket = this.hourly.get(key);
      hourly.push({
        hour: `${h}:00`,
        received: bucket?.received ?? 0,
        sent: bucket?.sent ?? 0,
      });
    }

    const topGroups = [...this.groupCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([id, count]) => ({ id, count }));

    const topUsers = [...this.userCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([id, count]) => ({ id, count }));

    return { hourly, topGroups, topUsers, totalReceived: this.totalReceived, totalSent: this.totalSent };
  }

  /** Query daily aggregated stats from DB for a date range */
  getDailyStats(days: number): DailyBucket[] {
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400_000);
    const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

    const rows = db.select({
      date: sql<string>`substr(${schema.messageStats.hour}, 1, 10)`,
      received: sql<number>`sum(${schema.messageStats.received})`,
      sent: sql<number>`sum(${schema.messageStats.sent})`,
    })
      .from(schema.messageStats)
      .where(sql`substr(${schema.messageStats.hour}, 1, 10) >= ${startKey}`)
      .groupBy(sql`substr(${schema.messageStats.hour}, 1, 10)`)
      .orderBy(sql`substr(${schema.messageStats.hour}, 1, 10)`)
      .all();

    return rows.map(r => ({ date: r.date, received: r.received ?? 0, sent: r.sent ?? 0 }));
  }

  flush(): void {
    for (const key of this.dirtyHours) {
      const bucket = this.hourly.get(key);
      if (!bucket) continue;
      db.insert(schema.messageStats)
        .values({ hour: key, received: bucket.received, sent: bucket.sent })
        .onConflictDoUpdate({
          target: schema.messageStats.hour,
          set: { received: bucket.received, sent: bucket.sent },
        })
        .run();
    }
    this.dirtyHours.clear();

    for (const gid of this.dirtyGroups) {
      const cnt = this.groupCounts.get(gid) ?? 0;
      db.insert(schema.messageRankings)
        .values({ type: 'group', targetId: gid, count: cnt })
        .onConflictDoUpdate({
          target: [schema.messageRankings.type, schema.messageRankings.targetId],
          set: { count: cnt },
        })
        .run();
    }
    this.dirtyGroups.clear();

    for (const uid of this.dirtyUsers) {
      const cnt = this.userCounts.get(uid) ?? 0;
      db.insert(schema.messageRankings)
        .values({ type: 'user', targetId: uid, count: cnt })
        .onConflictDoUpdate({
          target: [schema.messageRankings.type, schema.messageRankings.targetId],
          set: { count: cnt },
        })
        .run();
    }
    this.dirtyUsers.clear();

    // Prune hourly data older than 90 days from DB and memory
    const cutoff = new Date(Date.now() - 90 * 86400_000);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')} 00`;
    db.delete(schema.messageStats).where(sql`${schema.messageStats.hour} < ${cutoffKey}`).run();
    for (const key of this.hourly.keys()) {
      if (key < cutoffKey) this.hourly.delete(key);
    }
  }

  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

export const statsService = new StatsService();
