import type { FastifyInstance } from 'fastify';
import type { ConnectionManager } from '../ws/connection-manager.js';
import type { OneBotClient } from '../ws/onebot-client.js';
import type { ReverseWsManager } from '../ws/reverse-ws.js';
import { configService } from '../services/config.js';
import { logService } from '../services/log.js';
import type { BasicConfig } from '../types/config.js';

export interface GroupInfo {
  group_id: number;
  group_name: string;
  member_count: number;
  max_member_count: number;
  enabled: boolean;
}

export function groupRoutes(
  fastify: FastifyInstance,
  connectionManager: ConnectionManager,
  oneBotClient: OneBotClient,
  reverseWsManager: ReverseWsManager,
): void {
  function resolveConnectionId(botId: number): string | null {
    return reverseWsManager.getConnectionId(botId) ?? null;
  }

  fastify.get<{ Params: { botId: string } }>(
    '/api/bots/:botId/groups',
    async (request, reply) => {
      const botId = parseInt(request.params.botId, 10);
      if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });

      const connId = resolveConnectionId(botId);
      if (!connId) {
        return reply.code(404).send({ error: 'Bot 未连接' });
      }

      try {
        const rawGroups = await oneBotClient.getGroupList(connId);
        const basic = configService.get<BasicConfig>(botId, 'basic');
        const mode = basic?.groupFilterMode ?? 'none';
        const filterList = basic?.groupFilterList ?? [];

        const groups: GroupInfo[] = (rawGroups as Array<Record<string, unknown>>).map((g) => {
          const groupId = Number(g.group_id);
          let enabled = true;
          if (mode === 'whitelist') {
            enabled = filterList.includes(groupId);
          } else if (mode === 'blacklist') {
            enabled = !filterList.includes(groupId);
          }

          return {
            group_id: groupId,
            group_name: String(g.group_name ?? ''),
            member_count: Number(g.member_count ?? 0),
            max_member_count: Number(g.max_member_count ?? 0),
            enabled,
          };
        });

        return { groups, filterMode: mode };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.code(502).send({ error: message });
      }
    },
  );

  fastify.put<{ Params: { botId: string; groupId: string }; Body: { enabled: boolean } }>(
    '/api/bots/:botId/groups/:groupId/toggle',
    async (request, reply) => {
      const botId = parseInt(request.params.botId, 10);
      const groupId = parseInt(request.params.groupId, 10);
      if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });
      if (isNaN(groupId)) return reply.code(400).send({ error: '无效的 groupId' });

      const { enabled } = request.body ?? {};
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled 必须是布尔值' });
      }

      const basic = configService.get<BasicConfig>(botId, 'basic');
      const currentMode = basic?.groupFilterMode ?? 'none';
      let filterList = basic?.groupFilterList ? [...basic.groupFilterList] : [];

      if (currentMode === 'none') {
        if (!enabled) {
          // First time disabling a group: switch to blacklist mode, add this group
          filterList = [groupId];
          configService.set(botId, 'basic', {
            ...basic,
            groupFilterMode: 'blacklist',
            groupFilterList: filterList,
          });
        }
        // If enabling when mode=none, nothing to do - all are already enabled
      } else if (currentMode === 'whitelist') {
        if (enabled && !filterList.includes(groupId)) {
          filterList.push(groupId);
        } else if (!enabled) {
          filterList = filterList.filter((id) => id !== groupId);
        }
        configService.set(botId, 'basic', { ...basic, groupFilterList: filterList });
      } else if (currentMode === 'blacklist') {
        if (!enabled && !filterList.includes(groupId)) {
          filterList.push(groupId);
        } else if (enabled) {
          filterList = filterList.filter((id) => id !== groupId);
        }
        configService.set(botId, 'basic', { ...basic, groupFilterList: filterList });
      }

      const action = enabled ? '启用' : '禁用';
      logService.addLog('info', 'config', `群 ${groupId} 已${action} (botId=${botId})`);
      return { success: true };
    },
  );

  // Batch update: set all groups enabled/disabled state at once
  fastify.put<{ Params: { botId: string }; Body: { enabledGroups: number[] } }>(
    '/api/bots/:botId/groups/batch',
    async (request, reply) => {
      const botId = parseInt(request.params.botId, 10);
      if (isNaN(botId)) return reply.code(400).send({ error: '无效的 botId' });

      const { enabledGroups } = request.body ?? {};
      if (!Array.isArray(enabledGroups)) {
        return reply.code(400).send({ error: 'enabledGroups 必须是数组' });
      }

      const basic = configService.get<BasicConfig>(botId, 'basic');

      if (enabledGroups.length === 0) {
        // All disabled: blacklist doesn't work for "all", use whitelist with empty list
        configService.set(botId, 'basic', {
          ...basic,
          groupFilterMode: 'whitelist',
          groupFilterList: [],
        });
      } else {
        configService.set(botId, 'basic', {
          ...basic,
          groupFilterMode: 'whitelist',
          groupFilterList: enabledGroups,
        });
      }

      logService.addLog('info', 'config', `群过滤列表已更新 (botId=${botId}, 启用 ${enabledGroups.length} 个群)`);
      return { success: true };
    },
  );
}
