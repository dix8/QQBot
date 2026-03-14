import type { FastifyBaseLogger } from 'fastify';
import type {
  OneBotEvent,
  OneBotActionResponse,
  MetaEvent,
  MessageEvent,
  MessageSentEvent,
  NoticeEvent,
  RequestEvent,
  HeartbeatEvent,
  LifecycleEvent,
} from '../types/onebot.js';
import type { ConnectionManager } from './connection-manager.js';
import type { OneBotClient } from './onebot-client.js';
import type { ConfigService } from '../services/config.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import type { MessageBufferService } from '../services/message-buffer.js';
import { logService } from '../services/log.js';
import { statsService } from '../services/stats.js';
import { messageStoreService } from '../services/message-store.js';
import { db, schema } from '../db/index.js';
import { sql, eq } from 'drizzle-orm';
import type { BasicConfig, MessageConfig, RuntimeConfig } from '../types/config.js';
import { ConnectionState } from '../types/onebot.js';

export class EventHandler {
  private configService?: ConfigService;
  private pluginManager?: PluginManager;
  private botIdResolver?: (connectionId: string) => number | undefined;
  private messageBuffer?: MessageBufferService;

  /** Queue of sources for API-initiated sends, used to tag message_sent events */
  private recentApiSends = new Map<string, Array<{ source: string; timestamp: number }>>();

  /** Rate limit tracking: botId -> timestamps of recent messages */
  private rateLimitCounters = new Map<number, number[]>();

  constructor(
    private connectionManager: ConnectionManager,
    private oneBotClient: OneBotClient,
    private logger: FastifyBaseLogger,
  ) {}

  setConfigService(cs: ConfigService): void {
    this.configService = cs;
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
  }

  setBotIdResolver(resolver: (connectionId: string) => number | undefined): void {
    this.botIdResolver = resolver;
  }

  setMessageBuffer(mb: MessageBufferService): void {
    this.messageBuffer = mb;
  }

  /** Clean up state for a disconnected connection */
  cleanupConnection(connectionId: string): void {
    this.recentApiSends.delete(connectionId);
  }

  /** Record an API-initiated send for source tracking (called from API hook) */
  recordApiSend(connectionId: string, source: string): void {
    let queue = this.recentApiSends.get(connectionId);
    if (!queue) {
      queue = [];
      this.recentApiSends.set(connectionId, queue);
    }
    queue.push({ source, timestamp: Date.now() });
    // Cleanup entries older than 30s
    const cutoff = Date.now() - 30000;
    while (queue.length > 0 && queue[0].timestamp < cutoff) {
      queue.shift();
    }
  }

  /** Match a message_sent event with a recent API send, returning the source if found */
  private popApiSendSource(connectionId: string): string | undefined {
    const queue = this.recentApiSends.get(connectionId);
    if (!queue || queue.length === 0) return undefined;
    // Remove expired entries from front
    const cutoff = Date.now() - 30000;
    while (queue.length > 0 && queue[0].timestamp < cutoff) {
      queue.shift();
    }
    if (queue.length === 0) return undefined;
    return queue.shift()!.source;
  }

  handleRawMessage(connectionId: string, data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.logger.warn({ connectionId, data: data.slice(0, 200) }, 'Invalid JSON from WebSocket');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      this.logger.warn({ connectionId }, 'Non-object message from WebSocket');
      return;
    }

    const msg = parsed as Record<string, unknown>;

    // API responses have a retcode field
    if ('retcode' in msg && 'status' in msg) {
      try {
        this.oneBotClient.handleResponse(msg as unknown as OneBotActionResponse);
      } catch (err) {
        this.logger.error({ err, connectionId }, 'Error handling API response');
      }
      return;
    }

    // Events have a post_type field
    if ('post_type' in msg) {
      try {
        this.handleEvent(connectionId, msg as unknown as OneBotEvent);
      } catch (err) {
        this.logger.error({ err, connectionId }, 'Error handling event');
      }
      return;
    }

    this.logger.debug({ connectionId, keys: Object.keys(msg) }, 'Unknown message type');
  }

  /** Write a message to the per-bot buffer */
  private bufferMessage(connectionId: string, type: string, summary: string, detail?: string, source?: string): void {
    if (!this.messageBuffer || !this.botIdResolver) return;
    const botId = this.botIdResolver(connectionId);
    if (botId !== undefined) {
      this.messageBuffer.addMessage(botId, type, summary, detail, source);
    }
  }

  private handleEvent(connectionId: string, event: OneBotEvent): void {
    // Before authentication (lifecycle connect), only allow meta_events through
    if (event.post_type !== 'meta_event') {
      const conn = this.connectionManager.getConnection(connectionId);
      if (!conn || conn.state !== ConnectionState.AUTHENTICATED) {
        this.logger.debug(
          { connectionId, post_type: event.post_type },
          'Dropping event from unauthenticated connection',
        );
        return;
      }
    }

    switch (event.post_type) {
      case 'meta_event':
        this.handleMetaEvent(connectionId, event);
        break;
      case 'message':
        this.handleMessageEvent(connectionId, event);
        break;
      case 'message_sent':
        this.handleMessageSentEvent(connectionId, event as unknown as MessageSentEvent);
        break;
      case 'notice':
        this.handleNoticeEvent(connectionId, event);
        break;
      case 'request':
        this.handleRequestEvent(connectionId, event);
        break;
      default:
        this.logger.debug(
          { connectionId, post_type: (event as Record<string, unknown>).post_type },
          'Unknown post_type',
        );
    }
  }

  private handleMetaEvent(connectionId: string, event: MetaEvent): void {
    switch (event.meta_event_type) {
      case 'heartbeat':
        this.handleHeartbeat(connectionId, event as HeartbeatEvent);
        break;
      case 'lifecycle':
        this.handleLifecycle(connectionId, event as LifecycleEvent);
        break;
      default:
        this.logger.debug(
          { connectionId, meta_event_type: (event as Record<string, unknown>).meta_event_type },
          'Unknown meta_event_type',
        );
    }
  }

  private handleHeartbeat(connectionId: string, event: HeartbeatEvent): void {
    this.connectionManager.updateHeartbeat(connectionId, event.status, event.interval);
  }

  private handleLifecycle(connectionId: string, event: LifecycleEvent): void {
    this.logger.info(
      { connectionId, subType: event.sub_type, selfId: event.self_id },
      'Lifecycle event',
    );
    logService.addLog('info', 'connection', `生命周期事件: ${event.sub_type} (selfId: ${event.self_id})`);
    this.bufferMessage(connectionId, 'lifecycle', `${event.sub_type} (selfId: ${event.self_id})`);

    if (event.sub_type === 'connect') {
      this.connectionManager.markAuthenticated(connectionId, event.self_id);
    }
  }

  private handleMessageEvent(connectionId: string, event: MessageEvent): void {
    const rawMessage = typeof event.raw_message === 'string' ? event.raw_message : '';
    const senderDisplay = event.sender?.card || event.sender?.nickname || String(event.user_id);

    if (event.message_type === 'private') {
      this.logger.info(
        { connectionId, messageType: 'private', userId: event.user_id, messageId: event.message_id },
        'Private message received',
      );
      this.bufferMessage(
        connectionId,
        'private',
        `[${senderDisplay}(${event.user_id})]: ${rawMessage.slice(0, 200)}`,
        rawMessage,
      );
    } else {
      this.logger.info(
        { connectionId, messageType: 'group', groupId: event.group_id, userId: event.user_id, messageId: event.message_id },
        'Group message received',
      );
      this.bufferMessage(
        connectionId,
        'group',
        `[${event.group_id}] [${senderDisplay}(${event.user_id})]: ${rawMessage.slice(0, 200)}`,
        rawMessage,
      );
    }

    this.dispatchMessageLogic(connectionId, event);

    const botId = this.botIdResolver?.(connectionId);
    messageStoreService.store(event, botId);
  }

  /** Process keyword auto-reply and plugin dispatch (without buffering) */
  private dispatchMessageLogic(connectionId: string, event: MessageEvent): void {
    const rawMessage = typeof event.raw_message === 'string' ? event.raw_message : '';

    // Record stats for dashboard
    const groupId = event.message_type === 'group' ? (event as { group_id: number }).group_id : undefined;
    statsService.recordReceived(groupId, event.user_id);

    // Check message scope config (per-bot)
    if (this.configService && this.botIdResolver) {
      const botId = this.botIdResolver(connectionId);
      if (botId !== undefined) {
        const basic = this.configService.get<BasicConfig>(botId, 'basic');
        if (basic) {
          // S1: User blacklist — drop messages from blacklisted users
          if (basic.blacklistUsers?.length > 0 && basic.blacklistUsers.includes(event.user_id)) {
            this.logger.debug({ userId: event.user_id }, 'Message from blacklisted user, dropping');
            return;
          }

          // S2: Group filter — whitelist/blacklist mode
          if (event.message_type === 'group' && basic.groupFilterMode && basic.groupFilterMode !== 'none') {
            const groupId = event.group_id;
            const filterList = basic.groupFilterList ?? [];
            const inList = filterList.includes(groupId);
            if (basic.groupFilterMode === 'whitelist' && !inList) {
              this.logger.debug({ groupId }, 'Group not in whitelist, dropping');
              return;
            }
            if (basic.groupFilterMode === 'blacklist' && inList) {
              this.logger.debug({ groupId }, 'Group in blacklist, dropping');
              return;
            }
          }

          if (basic.messageScope === 'private' && event.message_type === 'group') return;
          if (basic.messageScope === 'group' && event.message_type === 'private') return;
        }

        // Check online time
        if (this.isOutsideOnlineTime(connectionId)) return;

        // Check rate limit
        const runtime = this.configService.get<RuntimeConfig>(botId, 'runtime');
        if (runtime?.rateLimit?.enabled) {
          const now = Date.now();
          const windowMs = runtime.rateLimit.windowSeconds * 1000;
          let timestamps = this.rateLimitCounters.get(botId);
          if (!timestamps) {
            timestamps = [];
            this.rateLimitCounters.set(botId, timestamps);
          }
          // Remove expired entries
          const cutoff = now - windowMs;
          while (timestamps.length > 0 && timestamps[0] < cutoff) {
            timestamps.shift();
          }
          if (timestamps.length >= runtime.rateLimit.maxMessages) {
            this.logger.debug({ botId, count: timestamps.length }, 'Rate limit exceeded, dropping message');
            return;
          }
          timestamps.push(now);
        }

        // Keyword auto-reply
        if (basic?.autoReply) {
          const msgConfig = this.configService.get<MessageConfig>(botId, 'message');
          if (msgConfig?.keywordRules) {
            for (const rule of msgConfig.keywordRules) {
              if (!rule.enabled) continue;
              const matched = this.matchKeyword(rawMessage, rule.keyword, rule.matchType);
              if (matched) {
                this.sendReply(connectionId, event, rule.reply);
                break;
              }
            }
          }
        }
      }
    }

    // Dispatch to plugins
    if (this.pluginManager) {
      this.pluginManager.dispatchMessage(event, connectionId).catch((err) => {
        this.logger.error({ err }, 'Error dispatching message to plugins');
      });
    }
  }

  private handleMessageSentEvent(connectionId: string, event: MessageSentEvent): void {
    const rawMessage = typeof event.raw_message === 'string' ? event.raw_message : '';
    const senderDisplay = event.sender?.card || event.sender?.nickname || String(event.user_id);

    // Check if this was sent by our API (keyword reply / plugin) vs. typed in QQ client
    const source = this.popApiSendSource(connectionId);

    // Increment sent message count for this bot
    statsService.recordSent();
    if (this.botIdResolver) {
      const botId = this.botIdResolver(connectionId);
      if (botId !== undefined) {
        db.update(schema.bots)
          .set({ sentMessageCount: sql`sent_message_count + 1` })
          .where(eq(schema.bots.id, botId))
          .run();
      }
    }

    // Buffer the message for display
    if (event.message_type === 'private') {
      this.logger.info(
        { connectionId, messageType: 'send_private', userId: event.user_id, messageId: event.message_id },
        'Bot sent private message',
      );
      this.bufferMessage(
        connectionId,
        'send_private',
        `[${senderDisplay}(${event.user_id})]: ${rawMessage.slice(0, 200)}`,
        rawMessage,
        source,
      );
    } else {
      this.logger.info(
        { connectionId, messageType: 'send_group', groupId: (event as { group_id: number }).group_id, userId: event.user_id, messageId: event.message_id },
        'Bot sent group message',
      );
      this.bufferMessage(
        connectionId,
        'send_group',
        `[${(event as { group_id: number }).group_id}] [${senderDisplay}(${event.user_id})]: ${rawMessage.slice(0, 200)}`,
        rawMessage,
        source,
      );
    }

    // Only re-dispatch for messages typed in QQ client (not our own API replies)
    // This prevents infinite loops and duplicate processing
    if (!source && this.configService && this.botIdResolver) {
      const botId = this.botIdResolver(connectionId);
      if (botId !== undefined) {
        const basic = this.configService.get<BasicConfig>(botId, 'basic');
        if (basic?.selfCommandEnabled) {
          // Dispatch for keyword/plugin processing (no buffering)
          const asMessageEvent = {
            ...event,
            post_type: 'message' as const,
          } as unknown as MessageEvent;
          this.dispatchMessageLogic(connectionId, asMessageEvent);
        }
      }
    }
  }

  /** Check if the bot is currently outside its configured online time window */
  private isOutsideOnlineTime(connectionId: string): boolean {
    if (!this.configService || !this.botIdResolver) return false;
    const botId = this.botIdResolver(connectionId);
    if (botId === undefined) return false;
    const runtime = this.configService.get<RuntimeConfig>(botId, 'runtime');
    if (!runtime?.onlineTime?.enabled) return false;
    const hour = new Date().getHours();
    const { startHour, endHour } = runtime.onlineTime;
    if (startHour <= endHour) {
      return hour < startHour || hour >= endHour;
    } else {
      return hour >= endHour && hour < startHour;
    }
  }

  private handleNoticeEvent(connectionId: string, event: NoticeEvent): void {
    this.logger.info(
      { connectionId, noticeType: event.notice_type, subType: event.sub_type },
      'Notice event received',
    );
    this.bufferMessage(
      connectionId,
      'notice',
      `${event.notice_type}${event.sub_type ? '/' + event.sub_type : ''}`,
    );

    // Dispatch to plugins (skip if outside online time)
    if (this.pluginManager && !this.isOutsideOnlineTime(connectionId)) {
      this.pluginManager.dispatchNotice(event, connectionId).catch((err) => {
        this.logger.error({ err }, 'Error dispatching notice to plugins');
      });
    }
  }

  private handleRequestEvent(connectionId: string, event: RequestEvent): void {
    this.logger.info(
      { connectionId, requestType: event.request_type, userId: event.user_id },
      'Request event received',
    );
    this.bufferMessage(
      connectionId,
      'request',
      `${event.request_type} (user: ${event.user_id})`,
    );

    // System-level auto-approve friend requests
    if (event.request_type === 'friend' && this.configService && this.botIdResolver) {
      const botId = this.botIdResolver(connectionId);
      if (botId !== undefined) {
        const basic = this.configService.get<BasicConfig>(botId, 'basic');
        if (basic?.autoApproveFriend) {
          this.oneBotClient.callApi(connectionId, 'set_friend_add_request', {
            flag: event.flag,
            approve: true,
          }).then(() => {
            logService.addLog('info', 'system', `已自动通过好友请求: ${event.user_id}`);
          }).catch((err) => {
            this.logger.error({ err, userId: event.user_id }, 'Failed to auto-approve friend request');
          });
        }
      }
    }

    // System-level auto-approve group invites
    if (event.request_type === 'group' && event.sub_type === 'invite' && this.configService && this.botIdResolver) {
      const botId = this.botIdResolver(connectionId);
      if (botId !== undefined) {
        const basic = this.configService.get<BasicConfig>(botId, 'basic');
        if (basic?.autoApproveGroup) {
          this.oneBotClient.callApi(connectionId, 'set_group_add_request', {
            flag: event.flag,
            sub_type: 'invite',
            approve: true,
          }).then(() => {
            logService.addLog('info', 'system', `已自动通过入群邀请: 群${event.group_id} (邀请人: ${event.user_id})`);
          }).catch((err) => {
            this.logger.error({ err, userId: event.user_id }, 'Failed to auto-approve group invite');
          });
        }
      }
    }

    // Dispatch to plugins (skip if outside online time)
    if (this.pluginManager && !this.isOutsideOnlineTime(connectionId)) {
      this.pluginManager.dispatchRequest(event, connectionId).catch((err) => {
        this.logger.error({ err }, 'Error dispatching request to plugins');
      });
    }
  }

  private matchKeyword(message: string, keyword: string, matchType: string): boolean {
    switch (matchType) {
      case 'exact':
        return message === keyword;
      case 'contains':
        return message.includes(keyword);
      case 'regex':
        // ReDoS protection: reject overly long patterns
        if (keyword.length > 200) {
          this.logger.warn({ patternLength: keyword.length }, 'Keyword regex pattern too long, skipping');
          return false;
        }
        try {
          return new RegExp(keyword).test(message);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  private sendReply(connectionId: string, event: MessageEvent, reply: string): void {
    if (event.message_type === 'private') {
      this.oneBotClient.sendPrivateMsg(connectionId, event.user_id, reply, '关键词回复').catch((err) => {
        this.logger.error({ err }, 'Failed to send keyword reply');
      });
    } else if ('group_id' in event) {
      this.oneBotClient.sendGroupMsg(connectionId, event.group_id, reply, '关键词回复').catch((err) => {
        this.logger.error({ err }, 'Failed to send keyword reply');
      });
    }
  }
}
