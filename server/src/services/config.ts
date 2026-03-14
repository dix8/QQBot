import { db, schema } from '../db/index.js';
import { like } from 'drizzle-orm';
import type { BotConfigData, ConfigSection } from '../types/config.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { nowISO } from '../utils/date.js';

/** Validate imported BotConfigData structure at runtime (no zod dependency) */
function validateBotConfigData(data: unknown): asserts data is BotConfigData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('配置数据必须是对象');
  }

  const d = data as Record<string, unknown>;

  // Validate basic section
  if (d.basic !== undefined) {
    if (typeof d.basic !== 'object' || d.basic === null) throw new Error('basic 配置必须是对象');
    const b = d.basic as Record<string, unknown>;
    if (b.nickname !== undefined && typeof b.nickname !== 'string') throw new Error('basic.nickname 必须是字符串');
    if (b.masterQQ !== undefined) {
      if (!Array.isArray(b.masterQQ)) throw new Error('basic.masterQQ 必须是数组');
      if (!b.masterQQ.every((v: unknown) => typeof v === 'number')) throw new Error('basic.masterQQ 元素必须是数字');
    }
    if (b.autoReply !== undefined && typeof b.autoReply !== 'boolean') throw new Error('basic.autoReply 必须是布尔值');
    if (b.messageScope !== undefined && !['private', 'group', 'both'].includes(b.messageScope as string)) {
      throw new Error('basic.messageScope 必须是 private/group/both');
    }
    if (b.selfCommandEnabled !== undefined && typeof b.selfCommandEnabled !== 'boolean') {
      throw new Error('basic.selfCommandEnabled 必须是布尔值');
    }
  }

  // Validate message section
  if (d.message !== undefined) {
    if (typeof d.message !== 'object' || d.message === null) throw new Error('message 配置必须是对象');
    const m = d.message as Record<string, unknown>;
    if (m.keywordRules !== undefined) {
      if (!Array.isArray(m.keywordRules)) throw new Error('message.keywordRules 必须是数组');
      for (const rule of m.keywordRules) {
        if (typeof rule !== 'object' || rule === null) throw new Error('keywordRule 必须是对象');
        const r = rule as Record<string, unknown>;
        if (typeof r.keyword !== 'string') throw new Error('keywordRule.keyword 必须是字符串');
        if (typeof r.reply !== 'string') throw new Error('keywordRule.reply 必须是字符串');
        if (!['exact', 'contains', 'regex'].includes(r.matchType as string)) {
          throw new Error('keywordRule.matchType 必须是 exact/contains/regex');
        }
      }
    }
  }

  // Validate runtime section
  if (d.runtime !== undefined) {
    if (typeof d.runtime !== 'object' || d.runtime === null) throw new Error('runtime 配置必须是对象');
    const r = d.runtime as Record<string, unknown>;
    if (r.onlineTime !== undefined) {
      if (typeof r.onlineTime !== 'object' || r.onlineTime === null) throw new Error('runtime.onlineTime 必须是对象');
      const ot = r.onlineTime as Record<string, unknown>;
      if (ot.startHour !== undefined && typeof ot.startHour !== 'number') throw new Error('onlineTime.startHour 必须是数字');
      if (ot.endHour !== undefined && typeof ot.endHour !== 'number') throw new Error('onlineTime.endHour 必须是数字');
    }
    if (r.rateLimit !== undefined) {
      if (typeof r.rateLimit !== 'object' || r.rateLimit === null) throw new Error('runtime.rateLimit 必须是对象');
      const rl = r.rateLimit as Record<string, unknown>;
      if (rl.maxMessages !== undefined && typeof rl.maxMessages !== 'number') throw new Error('rateLimit.maxMessages 必须是数字');
      if (rl.windowSeconds !== undefined && typeof rl.windowSeconds !== 'number') throw new Error('rateLimit.windowSeconds 必须是数字');
    }
    if (r.retry !== undefined) {
      if (typeof r.retry !== 'object' || r.retry === null) throw new Error('runtime.retry 必须是对象');
      const rt = r.retry as Record<string, unknown>;
      if (rt.maxRetries !== undefined && typeof rt.maxRetries !== 'number') throw new Error('retry.maxRetries 必须是数字');
      if (rt.retryDelayMs !== undefined && typeof rt.retryDelayMs !== 'number') throw new Error('retry.retryDelayMs 必须是数字');
    }
  }
}

export class ConfigService {
  private cache = new Map<string, unknown>();

  constructor() {
    this.loadCache();
  }

  private loadCache(): void {
    const rows = db.select().from(schema.botConfig).all();

    for (const row of rows) {
      try {
        this.cache.set(row.key, JSON.parse(row.value));
      } catch {
        this.cache.set(row.key, row.value);
      }
    }
  }

  private dbKey(botId: number, section: string): string {
    return `bot:${botId}:${section}`;
  }

  get<T = unknown>(botId: number, section: string): T {
    const key = this.dbKey(botId, section);
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }
    if (section in DEFAULT_CONFIG) {
      return DEFAULT_CONFIG[section as ConfigSection] as T;
    }
    return undefined as T;
  }

  getAllForBot(botId: number): BotConfigData {
    return {
      basic: this.get<BotConfigData['basic']>(botId, 'basic') ?? DEFAULT_CONFIG.basic,
      message: this.get<BotConfigData['message']>(botId, 'message') ?? DEFAULT_CONFIG.message,
      runtime: this.get<BotConfigData['runtime']>(botId, 'runtime') ?? DEFAULT_CONFIG.runtime,
    };
  }

  set(botId: number, section: string, value: unknown): void {
    const key = this.dbKey(botId, section);
    const jsonValue = JSON.stringify(value);
    const now = nowISO();
    db.insert(schema.botConfig)
      .values({ key, value: jsonValue, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.botConfig.key,
        set: { value: jsonValue, updatedAt: now },
      })
      .run();
    this.cache.set(key, value);
  }

  exportAll(botId: number): BotConfigData {
    return this.getAllForBot(botId);
  }

  importAll(botId: number, data: unknown): void {
    validateBotConfigData(data);
    if (data.basic) this.set(botId, 'basic', data.basic);
    if (data.message) this.set(botId, 'message', data.message);
    if (data.runtime) this.set(botId, 'runtime', data.runtime);
  }

  /** Delete all config for a bot */
  deleteForBot(botId: number): void {
    const prefix = `bot:${botId}:%`;
    db.delete(schema.botConfig).where(like(schema.botConfig.key, prefix)).run();
    for (const key of this.cache.keys()) {
      if (key.startsWith(`bot:${botId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /** Get master QQ list for a bot */
  getMasterQQ(botId: number): number[] {
    const basic = this.get<BotConfigData['basic']>(botId, 'basic');
    return basic?.masterQQ ?? [];
  }

  /** Get super admin QQ list (system-level, not bound to any bot) */
  getSuperAdminQQ(): number[] {
    const key = 'system:superAdminQQ';
    if (this.cache.has(key)) return this.cache.get(key) as number[];
    return [];
  }

  /** Set super admin QQ list (system-level) */
  setSuperAdminQQ(list: number[]): void {
    const key = 'system:superAdminQQ';
    const jsonValue = JSON.stringify(list);
    const now = nowISO();
    db.insert(schema.botConfig)
      .values({ key, value: jsonValue, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.botConfig.key,
        set: { value: jsonValue, updatedAt: now },
      })
      .run();
    this.cache.set(key, list);
  }
}

export const configService = new ConfigService();
