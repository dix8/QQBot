import type { FastifyInstance } from 'fastify';
import type { ConnectionManager } from '../ws/connection-manager.js';
import type { OneBotClient } from '../ws/onebot-client.js';

export function connectionRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager,
  oneBotClient: OneBotClient,
): void {
  // List all connections
  fastify.get('/api/connections', async () => {
    const connections = connectionManager.getAllConnections();
    return {
      connections: connections.map((c) => connectionManager.toConnectionInfo(c)),
      activeCount: connections.length,
    };
  });

  // Get single connection details
  fastify.get<{ Params: { id: string } }>('/api/connections/:id', async (request, reply) => {
    const connection = connectionManager.getConnection(request.params.id);
    if (!connection) {
      return reply.code(404).send({ error: '连接不存在' });
    }
    return connectionManager.toConnectionInfo(connection);
  });

  // Force disconnect a connection
  fastify.delete<{ Params: { id: string } }>('/api/connections/:id', async (request, reply) => {
    const connection = connectionManager.getConnection(request.params.id);
    if (!connection) {
      return reply.code(404).send({ error: '连接不存在' });
    }
    connectionManager.removeConnection(request.params.id, 'force disconnected via API');
    return { success: true };
  });

  // Proxy any OneBot API call
  fastify.post<{
    Params: { id: string };
    Body: { action: string; params?: Record<string, unknown> };
  }>('/api/connections/:id/api', async (request, reply) => {
    const connection = connectionManager.getConnection(request.params.id);
    if (!connection) {
      return reply.code(404).send({ error: '连接不存在' });
    }

    const { action, params } = request.body;
    if (!action) {
      return reply.code(400).send({ error: '缺少 action 字段' });
    }

    const DANGEROUS_ACTIONS = new Set([
      'set_restart', 'clean_cache', 'set_group_leave',
      'set_friend_add_request', 'set_group_add_request',
      'delete_msg', 'set_group_kick', 'set_group_ban',
      'set_group_whole_ban',
    ]);
    if (DANGEROUS_ACTIONS.has(action)) {
      fastify.log.warn({ action, connectionId: request.params.id }, 'Dangerous API action called via proxy');
    }

    try {
      const data = await oneBotClient.callApi(request.params.id, action, params ?? {});
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(502).send({ error: message });
    }
  });

  // Get first active connection's bot info
  fastify.get('/api/bot/info', async (_request, reply) => {
    const connections = connectionManager.getAllConnections();
    const active = connections.find((c) => c.botInfo);
    if (!active) {
      return reply.code(404).send({ error: '没有活跃的 Bot 连接' });
    }
    return {
      connectionId: active.id,
      ...active.botInfo,
    };
  });

  // Get group list
  fastify.get('/api/bot/groups', async (_request, reply) => {
    const connections = connectionManager.getAllConnections();
    const active = connections.find((c) => c.botInfo);
    if (!active) {
      return reply.code(404).send({ error: '没有活跃的 Bot 连接' });
    }

    try {
      const groups = await oneBotClient.getGroupList(active.id);
      return { groups };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(502).send({ error: message });
    }
  });

  // Get friend list
  fastify.get('/api/bot/friends', async (_request, reply) => {
    const connections = connectionManager.getAllConnections();
    const active = connections.find((c) => c.botInfo);
    if (!active) {
      return reply.code(404).send({ error: '没有活跃的 Bot 连接' });
    }

    try {
      const friends = await oneBotClient.getFriendList(active.id);
      return { friends };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(502).send({ error: message });
    }
  });
}
