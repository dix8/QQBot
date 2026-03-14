import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { auditService } from '../services/audit.js';
import { configService } from '../services/config.js';
import type { ConfigSection } from '../types/config.js';

const VALID_SECTIONS: ConfigSection[] = ['basic', 'message', 'runtime'];

export function configRoutes(fastify: FastifyInstance): void {
  // GET /api/system/super-admins
  fastify.get('/api/system/super-admins', async () => {
    return { list: configService.getSuperAdminQQ() };
  });

  // PUT /api/system/super-admins
  fastify.put('/api/system/super-admins', async (request, reply) => {
    const body = request.body as { list?: unknown };
    if (!body || !Array.isArray(body.list)) {
      return reply.code(400).send({ error: 'list 必须是数组' });
    }
    const list = body.list;
    if (!list.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0)) {
      return reply.code(400).send({ error: 'list 中每个元素必须是正整数' });
    }
    configService.setSuperAdminQQ(list as number[]);
    auditService.log('superadmin_update', 'system', `超级管理员列表: ${(list as number[]).join(', ')}`, (request.user as { username?: string })?.username, request.ip);
    return { success: true };
  });

  // GET /api/bots/:botId/config/export
  fastify.get<{ Params: { botId: string } }>('/api/bots/:botId/config/export', async (request, reply) => {
    const botId = parseInt(request.params.botId, 10);
    if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });
    return configService.exportAll(botId);
  });

  // POST /api/bots/:botId/config/import
  fastify.post<{ Params: { botId: string } }>('/api/bots/:botId/config/import', async (request, reply) => {
    const botId = parseInt(request.params.botId, 10);
    if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });
    const data = request.body;
    if (!data || typeof data !== 'object') {
      return reply.code(400).send({ error: '无效的配置数据' });
    }
    try {
      configService.importAll(botId, data);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '配置数据校验失败' });
    }
    auditService.log('config_import', String(botId), `导入配置`, (request.user as { username?: string })?.username, request.ip);
    return { success: true };
  });

  // GET /api/bots/:botId/config — get all config for a bot
  fastify.get<{ Params: { botId: string } }>('/api/bots/:botId/config', async (request, reply) => {
    const botId = parseInt(request.params.botId, 10);
    if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });
    return configService.getAllForBot(botId);
  });

  // GET /api/bots/:botId/config/:section
  fastify.get<{ Params: { botId: string; section: string } }>(
    '/api/bots/:botId/config/:section',
    async (request, reply) => {
      const botId = parseInt(request.params.botId, 10);
      if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });
      const { section } = request.params;
      if (!VALID_SECTIONS.includes(section as ConfigSection)) {
        return reply.code(400).send({ error: `无效的配置节: ${section}` });
      }
      return configService.get(botId, section);
    },
  );

  // PUT /api/bots/:botId/config/:section
  fastify.put<{ Params: { botId: string; section: string } }>(
    '/api/bots/:botId/config/:section',
    async (request, reply) => {
      const botId = parseInt(request.params.botId, 10);
      if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });
      const { section } = request.params;
      if (!VALID_SECTIONS.includes(section as ConfigSection)) {
        return reply.code(400).send({ error: `无效的配置节: ${section}` });
      }
      const value = request.body;
      if (!value || typeof value !== 'object') {
        return reply.code(400).send({ error: '无效的配置值' });
      }
      configService.set(botId, section, value);
      auditService.log('config_update', String(botId), `更新配置节: ${section}`, (request.user as { username?: string })?.username, request.ip);
      return { success: true };
    },
  );

  // GET /api/backup — export full system backup (bot configs + plugin configs + system settings)
  fastify.get('/api/backup', async () => {
    const allBots = db.select().from(schema.bots).all();
    const botConfigs: Record<number, unknown> = {};
    for (const bot of allBots) {
      botConfigs[bot.id] = configService.exportAll(bot.id);
    }

    const pluginRows = db.select().from(schema.plugins).all();
    const pluginStates = pluginRows.map(p => ({
      id: p.id, enabled: p.enabled, priority: p.priority,
    }));

    const pluginConfigs: Record<string, Record<string, unknown>> = {};
    const pcRows = db.select().from(schema.pluginConfig).all();
    for (const pc of pcRows) {
      if (!pluginConfigs[pc.pluginId]) pluginConfigs[pc.pluginId] = {};
      try { pluginConfigs[pc.pluginId][pc.key] = JSON.parse(pc.value); } catch { pluginConfigs[pc.pluginId][pc.key] = pc.value; }
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      superAdmins: configService.getSuperAdminQQ(),
      botConfigs,
      pluginStates,
      pluginConfigs,
    };
  });

  // POST /api/backup/restore — restore full system backup
  fastify.post('/api/backup/restore', async (request, reply) => {
    const data = request.body as Record<string, unknown>;
    if (!data || data.version !== 1) {
      return reply.code(400).send({ error: '无效的备份文件格式' });
    }

    try {
      if (Array.isArray(data.superAdmins)) {
        configService.setSuperAdminQQ(data.superAdmins as number[]);
      }

      if (data.botConfigs && typeof data.botConfigs === 'object') {
        for (const [botIdStr, cfg] of Object.entries(data.botConfigs as Record<string, unknown>)) {
          const botId = parseInt(botIdStr, 10);
          if (!isNaN(botId) && cfg && typeof cfg === 'object') {
            try { configService.importAll(botId, cfg); } catch { /* skip invalid */ }
          }
        }
      }

      if (Array.isArray(data.pluginStates)) {
        for (const ps of data.pluginStates as Array<{ id: string; enabled: number; priority: number }>) {
          if (!ps.id) continue;
          const exists = db.select().from(schema.plugins).where(eq(schema.plugins.id, ps.id)).get();
          if (exists) {
            db.update(schema.plugins).set({
              enabled: ps.enabled ?? exists.enabled,
              priority: ps.priority ?? exists.priority,
            }).where(eq(schema.plugins.id, ps.id)).run();
          }
        }
      }

      if (data.pluginConfigs && typeof data.pluginConfigs === 'object') {
        for (const [pluginId, values] of Object.entries(data.pluginConfigs as Record<string, Record<string, unknown>>)) {
          for (const [key, value] of Object.entries(values)) {
            db.insert(schema.pluginConfig)
              .values({ pluginId, key, value: JSON.stringify(value), updatedAt: new Date().toISOString() })
              .onConflictDoUpdate({
                target: [schema.pluginConfig.pluginId, schema.pluginConfig.key],
                set: { value: JSON.stringify(value), updatedAt: new Date().toISOString() },
              })
              .run();
          }
        }
      }

      auditService.log('backup_restore', 'system', '还原完整备份', (request.user as { username?: string })?.username, request.ip);
      return { success: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '还原失败' });
    }
  });

  // GET /api/audit-logs — query audit logs
  fastify.get<{ Querystring: { action?: string; search?: string; page?: string; limit?: string } }>(
    '/api/audit-logs', async (request) => {
      return auditService.query({
        action: request.query.action,
        search: request.query.search,
        page: parseInt(request.query.page ?? '1', 10) || 1,
        limit: parseInt(request.query.limit ?? '50', 10) || 50,
      });
    },
  );

  // GET /api/messages — query stored messages
  fastify.get<{ Querystring: { botId?: string; type?: string; groupId?: string; userId?: string; search?: string; page?: string; limit?: string } }>(
    '/api/messages', async (request) => {
      const { messageStoreService } = await import('../services/message-store.js');
      return messageStoreService.query({
        botId: request.query.botId ? parseInt(request.query.botId, 10) : undefined,
        messageType: request.query.type as 'private' | 'group' | undefined,
        groupId: request.query.groupId ? parseInt(request.query.groupId, 10) : undefined,
        userId: request.query.userId ? parseInt(request.query.userId, 10) : undefined,
        search: request.query.search,
        page: parseInt(request.query.page ?? '1', 10) || 1,
        limit: parseInt(request.query.limit ?? '50', 10) || 50,
      });
    },
  );
}
