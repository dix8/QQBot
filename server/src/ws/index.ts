import type { FastifyBaseLogger } from 'fastify';
import { ConnectionManager } from './connection-manager.js';
import { EventHandler } from './event-handler.js';
import { OneBotClient } from './onebot-client.js';
import { logService } from '../services/log.js';
import { messageBufferService } from '../services/message-buffer.js';
import { ReverseWsManager } from './reverse-ws.js';

export interface WsServiceOptions {
  heartbeatTimeoutMs?: number;
  apiTimeoutMs?: number;
}

export interface WsService {
  connectionManager: ConnectionManager;
  oneBotClient: OneBotClient;
  eventHandler: EventHandler;
  reverseWsManager: ReverseWsManager;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createWsService(logger: FastifyBaseLogger, opts: WsServiceOptions): WsService {
  const connectionManager = new ConnectionManager(logger, {
    heartbeatTimeoutMs: opts.heartbeatTimeoutMs,
  });
  const oneBotClient = new OneBotClient(
    connectionManager,
    logger,
    opts.apiTimeoutMs,
  );
  const eventHandler = new EventHandler(connectionManager, oneBotClient, logger);
  const reverseWsManager = new ReverseWsManager(logger, connectionManager, eventHandler);

  // Wire up botId resolver so event handler can look up per-bot config
  eventHandler.setBotIdResolver((connectionId) => reverseWsManager.getBotIdByConnectionId(connectionId));

  // Wire up message buffer for per-bot WS message storage
  eventHandler.setMessageBuffer(messageBufferService);

  // Record outgoing send-message API calls for source tracking (de-duplication with message_sent)
  oneBotClient.setApiCallHook((connectionId, action, _params, source) => {
    if (action === 'send_private_msg' || action === 'send_group_msg' || action === 'send_msg') {
      eventHandler.recordApiSend(connectionId, source || '系统');
    }
  });

  // When a connection is authenticated, fetch bot info and ensure DB record
  connectionManager.on('connection:authenticated', async (id: string, selfId: number) => {
    try {
      // Update selfId on the bot record that owns this connection
      reverseWsManager.updateBotSelfId(id, selfId);

      const loginInfo = await oneBotClient.getLoginInfo(id);
      connectionManager.updateBotInfo(id, loginInfo);
      logService.addLog('info', 'connection', `Bot 已认证: ${loginInfo.nickname} (${loginInfo.user_id})`);
    } catch (err) {
      logger.error({ err, connectionId: id }, 'Failed to fetch login info after auth');
    }
  });

  // When a connection is removed, clean up its pending API requests and event handler state
  connectionManager.on('connection:removed', (id: string, reason?: string) => {
    oneBotClient.handleConnectionRemoved(id);
    eventHandler.cleanupConnection(id);
    logService.addLog('info', 'connection', `连接已断开: ${id.slice(0, 8)}... (${reason ?? '未知原因'})`);
  });

  // Log connection errors
  connectionManager.on('connection:error', (id: string, error: string) => {
    logService.addLog('error', 'connection', `连接错误: ${id.slice(0, 8)}... - ${error}`);
  });

  return {
    connectionManager,
    oneBotClient,
    eventHandler,
    reverseWsManager,
    async start() {
      // Initialize per-bot reverse WS servers
      await reverseWsManager.initialize();
    },
    async close() {
      await reverseWsManager.closeAll();
      connectionManager.closeAll();
      oneBotClient.cleanup();
    },
  };
}

export { ConnectionManager } from './connection-manager.js';
export { EventHandler } from './event-handler.js';
export { OneBotClient } from './onebot-client.js';
export { ReverseWsManager } from './reverse-ws.js';
