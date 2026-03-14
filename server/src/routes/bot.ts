import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import type { ReverseWsManager } from '../ws/reverse-ws.js';
import { ConnectionState } from '../types/onebot.js';
import type { BotDetail, BotCreatePayload, BotUpdatePayload } from '../types/bot.js';
import { auditService } from '../services/audit.js';
import { logService } from '../services/log.js';
import { messageBufferService } from '../services/message-buffer.js';
import { configService } from '../services/config.js';
import { nowDatetime } from '../utils/date.js';

function botDisplayName(bot: { remark: string; selfId: number | null; id: number }): string {
  return bot.remark || (bot.selfId ? String(bot.selfId) : `Bot #${bot.id}`);
}

export function botRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager,
  reverseWsManager: ReverseWsManager,
): void {
  // List all bots (merge live connection data + DB persistent data)
  fastify.get('/api/bots', async () => {
    const dbBots = db.select().from(schema.bots).all();
    const result: BotDetail[] = [];

    for (const dbRecord of dbBots) {
      // Find live connection by selfId or by reverse WS botId
      let conn = dbRecord.selfId
        ? connectionManager.getConnectionBySelfId(dbRecord.selfId)
        : undefined;

      // Also check via reverseWsManager connectionId
      if (!conn) {
        const rwsConnId = reverseWsManager.getConnectionId(dbRecord.id);
        if (rwsConnId) {
          conn = connectionManager.getConnection(rwsConnId);
        }
      }

      result.push({
        id: dbRecord.id,
        selfId: dbRecord.selfId,
        nickname: conn?.botInfo?.nickname ?? '',
        remark: dbRecord.remark,
        description: dbRecord.description,
        avatarUrl: dbRecord.avatarUrl,
        wsHost: dbRecord.wsHost,
        wsPort: dbRecord.wsPort,
        hasToken: !!dbRecord.wsToken,
        enabled: !!dbRecord.enabled,
        online: conn?.state === ConnectionState.AUTHENTICATED,
        connectionId: conn?.id,
        state: conn?.state,
        connectedAt: conn?.connectedAt.toISOString(),
        lastHeartbeat: conn?.lastHeartbeat?.toISOString(),
        remoteAddress: conn?.remoteAddress,
        error: conn?.error,
      });
    }

    return { bots: result };
  });

  // Get single bot detail
  fastify.get<{ Params: { id: string } }>('/api/bots/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: '无效的 ID' });
    }

    const dbRecord = db.select().from(schema.bots).where(eq(schema.bots.id, id)).get();
    if (!dbRecord) {
      return reply.code(404).send({ error: 'Bot 不存在' });
    }

    let conn = dbRecord.selfId
      ? connectionManager.getConnectionBySelfId(dbRecord.selfId)
      : undefined;

    if (!conn) {
      const rwsConnId = reverseWsManager.getConnectionId(dbRecord.id);
      if (rwsConnId) {
        conn = connectionManager.getConnection(rwsConnId);
      }
    }

    const detail: BotDetail = {
      id: dbRecord.id,
      selfId: dbRecord.selfId,
      nickname: conn?.botInfo?.nickname ?? '',
      remark: dbRecord.remark,
      description: dbRecord.description,
      avatarUrl: dbRecord.avatarUrl,
      wsHost: dbRecord.wsHost,
      wsPort: dbRecord.wsPort,
      hasToken: !!dbRecord.wsToken,
      enabled: !!dbRecord.enabled,
      online: conn?.state === ConnectionState.AUTHENTICATED,
      connectionId: conn?.id,
      state: conn?.state,
      connectedAt: conn?.connectedAt.toISOString(),
      lastHeartbeat: conn?.lastHeartbeat?.toISOString(),
      remoteAddress: conn?.remoteAddress,
      error: conn?.error,
    };

    return detail;
  });

  // Create a new bot (reverse WS server)
  fastify.post<{ Body: BotCreatePayload }>('/api/bots', async (request, reply) => {
    const { wsHost, wsPort, wsToken } = request.body ?? {};

    if (!wsHost || !wsPort) {
      return reply.code(400).send({ error: '需要提供 wsHost 和 wsPort' });
    }

    if (typeof wsPort !== 'number' || wsPort < 1 || wsPort > 65535) {
      return reply.code(400).send({ error: 'wsPort 须为 1-65535' });
    }

    if (!wsToken) {
      return reply.code(400).send({ error: 'Access Token 不能为空，请设置鉴权 Token' });
    }

    const result = db.insert(schema.bots)
      .values({
        wsHost,
        wsPort,
        wsToken,
        enabled: 1,
      })
      .run();

    const botId = Number(result.lastInsertRowid);

    // Start reverse WS server for this bot
    try {
      await reverseWsManager.startServer(botId, wsHost, wsPort, wsToken);
    } catch (err) {
      // If server fails to start (e.g. port conflict), delete the bot record and return error
      db.delete(schema.bots).where(eq(schema.bots.id, botId)).run();
      const message = err instanceof Error ? err.message : 'WS 服务启动失败';
      return reply.code(400).send({ error: message });
    }

    auditService.log('bot_create', String(botId), `创建机器人 ${wsHost}:${wsPort}`, (request.user as { username?: string })?.username, request.ip);
    return { success: true, id: botId };
  });

  // Update bot info (remark / description / avatarUrl / wsHost / wsPort / wsToken)
  fastify.put<{ Params: { id: string }; Body: BotUpdatePayload }>(
    '/api/bots/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: '无效的 ID' });
      }

      const existing = db.select().from(schema.bots).where(eq(schema.bots.id, id)).get();
      if (!existing) {
        return reply.code(404).send({ error: 'Bot 不存在' });
      }

      const { remark, description, avatarUrl, wsHost, wsPort, wsToken } = request.body ?? {};

      if (wsPort !== undefined && (typeof wsPort !== 'number' || wsPort < 1 || wsPort > 65535)) {
        return reply.code(400).send({ error: 'wsPort 须为 1-65535' });
      }

      // Prevent clearing wsToken when bot is enabled
      if (wsToken !== undefined && wsToken === '' && existing.enabled) {
        return reply.code(400).send({ error: 'Bot 启用时不能清空 Access Token' });
      }

      const updates: Record<string, unknown> = {
        updatedAt: nowDatetime(),
      };
      if (remark !== undefined) updates.remark = remark;
      if (description !== undefined) updates.description = description;
      if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
      if (wsHost !== undefined) updates.wsHost = wsHost;
      if (wsPort !== undefined) updates.wsPort = wsPort;
      if (wsToken !== undefined) updates.wsToken = wsToken;

      db.update(schema.bots)
        .set(updates)
        .where(eq(schema.bots.id, id))
        .run();

      // Build change description for log
      const name = botDisplayName(existing);
      const changes: string[] = [];
      if (remark !== undefined && remark !== existing.remark) changes.push('备注');
      if (description !== undefined && description !== existing.description) changes.push('描述');
      if (wsHost !== undefined && wsHost !== existing.wsHost) changes.push(`主机: ${existing.wsHost} → ${wsHost}`);
      if (wsPort !== undefined && wsPort !== existing.wsPort) changes.push(`端口: ${existing.wsPort} → ${wsPort}`);
      if (wsToken !== undefined && wsToken !== existing.wsToken) changes.push('Token');

      // If WS config changed, restart the server
      const wsChanged =
        (wsHost !== undefined && wsHost !== existing.wsHost) ||
        (wsPort !== undefined && wsPort !== existing.wsPort) ||
        (wsToken !== undefined && wsToken !== existing.wsToken);

      if (wsChanged && existing.enabled) {
        const updated = db.select().from(schema.bots).where(eq(schema.bots.id, id)).get();
        if (updated) {
          await reverseWsManager.stopServer(id);
          try {
            await reverseWsManager.startServer(id, updated.wsHost, updated.wsPort, updated.wsToken);
          } catch (err) {
            // Rollback WS config in DB to previous values
            db.update(schema.bots)
              .set({
                wsHost: existing.wsHost,
                wsPort: existing.wsPort,
                wsToken: existing.wsToken,
                updatedAt: nowDatetime(),
              })
              .where(eq(schema.bots.id, id))
              .run();
            // Restart with old config
            try {
              await reverseWsManager.startServer(id, existing.wsHost, existing.wsPort, existing.wsToken);
            } catch { /* best-effort restore */ }
            const message = err instanceof Error ? err.message : 'WS 服务启动失败';
            return reply.code(400).send({ error: `${message}，已回滚到原配置` });
          }
        }
      }

      auditService.log('bot_update', String(id), changes.length > 0 ? changes.join(', ') : '更新机器人', (request.user as { username?: string })?.username, request.ip);
      return { success: true };
    },
  );

  // Delete bot record + stop server
  fastify.delete<{ Params: { id: string } }>('/api/bots/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: '无效的 ID' });
    }

    const existing = db.select().from(schema.bots).where(eq(schema.bots.id, id)).get();
    if (!existing) {
      return reply.code(404).send({ error: 'Bot 记录不存在' });
    }

    const name = botDisplayName(existing);
    await reverseWsManager.stopServer(id);
    configService.deleteForBot(id);
    db.delete(schema.bots).where(eq(schema.bots.id, id)).run();
    messageBufferService.clearBot(id);
    auditService.log('bot_delete', String(id), `删除机器人 [${name}]`, (request.user as { username?: string })?.username, request.ip);
    return { success: true };
  });

  // Enable bot (start server)
  fastify.post<{ Params: { id: string } }>('/api/bots/:id/enable', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: '无效的 ID' });
    }

    const bot = db.select().from(schema.bots).where(eq(schema.bots.id, id)).get();
    if (!bot) {
      return reply.code(404).send({ error: 'Bot 不存在' });
    }

    if (!bot.wsToken) {
      return reply.code(400).send({ error: 'Access Token 未设置，请先配置鉴权 Token' });
    }

    // Start server first — only set enabled=1 on success
    try {
      await reverseWsManager.startServer(id, bot.wsHost, bot.wsPort, bot.wsToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'WS 服务启动失败';
      return reply.code(400).send({ error: message });
    }

    db.update(schema.bots)
      .set({
        enabled: 1,
        updatedAt: nowDatetime(),
      })
      .where(eq(schema.bots.id, id))
      .run();

    logService.addLog('info', 'bot', `启用机器人 [${botDisplayName(bot)}]`);
    return { success: true };
  });

  // Disable bot (stop server)
  fastify.post<{ Params: { id: string } }>('/api/bots/:id/disable', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      return reply.code(400).send({ error: '无效的 ID' });
    }

    const bot = db.select().from(schema.bots).where(eq(schema.bots.id, id)).get();
    if (!bot) {
      return reply.code(404).send({ error: 'Bot 不存在' });
    }

    db.update(schema.bots)
      .set({
        enabled: 0,
        updatedAt: nowDatetime(),
      })
      .where(eq(schema.bots.id, id))
      .run();

    await reverseWsManager.stopServer(id);
    logService.addLog('info', 'bot', `禁用机器人 [${botDisplayName(bot)}]`);
    return { success: true };
  });

  // GET /api/bots/:id/ws-messages — per-bot WS message log
  fastify.get<{ Params: { id: string }; Querystring: { since?: string } }>(
    '/api/bots/:id/ws-messages',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: '无效的 ID' });
      }
      const sinceId = request.query.since ? parseInt(request.query.since, 10) : undefined;
      const messages = messageBufferService.getMessages(id, sinceId);
      return { messages };
    },
  );
}
