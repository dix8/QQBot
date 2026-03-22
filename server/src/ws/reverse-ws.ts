import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { ConnectionManager } from './connection-manager.js';
import type { EventHandler } from './event-handler.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logService } from '../services/log.js';
import { nowDatetime } from '../utils/date.js';

interface PerBotServer {
  botId: number;
  httpServer: HttpServer;
  wss: WebSocketServer;
  connectionId?: string;
}

export class ReverseWsManager {
  private servers = new Map<number, PerBotServer>();
  private logger: FastifyBaseLogger;
  private connectionManager: ConnectionManager;
  private eventHandler: EventHandler;
  private closed = false;

  constructor(
    logger: FastifyBaseLogger,
    connectionManager: ConnectionManager,
    eventHandler: EventHandler,
  ) {
    this.logger = logger;
    this.connectionManager = connectionManager;
    this.eventHandler = eventHandler;

    // When a connection is removed from ConnectionManager, clear the stored connectionId
    this.connectionManager.on('connection:removed', (connectionId: string) => {
      for (const [, server] of this.servers) {
        if (server.connectionId === connectionId) {
          server.connectionId = undefined;
          break;
        }
      }
    });
  }

  /** Start reverse WS servers for all enabled bots from database */
  async initialize(): Promise<void> {
    const bots = db.select().from(schema.bots).all();
    for (const bot of bots) {
      if (bot.enabled) {
        await this.startServer(bot.id, bot.wsHost, bot.wsPort, bot.wsToken);
      }
    }
  }

  /** Start a per-bot reverse WS server */
  async startServer(botId: number, wsHost: string, wsPort: number, wsToken: string): Promise<void> {
    if (this.closed) return;
    // If already running, stop first
    await this.stopServer(botId);

    const httpServer = createServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('WebSocket connections only');
    });

    const wss = new WebSocketServer({ noServer: true });

    const perBot: PerBotServer = { botId, httpServer, wss };
    this.servers.set(botId, perBot);

    // Handle upgrade manually so WSS errors don't crash the process
    httpServer.on('upgrade', (request, socket, head) => {
      const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host}`);
      if (pathname.toLowerCase() === '/qqbot') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        this.logger.warn(
          { botId, pathname, ip: request.socket.remoteAddress },
          'Reverse WS: rejected upgrade to invalid path',
        );
        socket.destroy();
      }
    });

    wss.on('error', (err) => {
      this.logger.error({ err, botId }, 'Reverse WS: WebSocketServer error');
    });

    wss.on('connection', (socket: WebSocket, request) => {
      // Token verification — always required
      const authHeader = request.headers.authorization;
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      const queryToken = url.searchParams.get('access_token');
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : queryToken;

      if (wsToken && token !== wsToken) {
        this.logger.warn(
          { botId, ip: request.socket.remoteAddress },
          'Reverse WS: auth failed',
        );
        socket.close(4001, 'Unauthorized');
        return;
      }

      // Enforce single connection: kick old connection if exists
      if (perBot.connectionId) {
        this.logger.info(
          { botId, oldConnectionId: perBot.connectionId },
          'Reverse WS: new connection replacing existing one',
        );
        this.connectionManager.removeConnection(perBot.connectionId, 'replaced by new connection');
        perBot.connectionId = undefined;
      }

      const connectionId = randomUUID();
      const remoteAddress = request.socket.remoteAddress ?? 'unknown';

      perBot.connectionId = connectionId;
      this.logger.info({ botId, connectionId, remoteAddress }, 'Reverse WS: connected');
      logService.addLog('info', 'connection', `反向 WS 新连接: botId=${botId} 来自 ${remoteAddress}`);

      this.connectionManager.addConnection(connectionId, socket, remoteAddress, (data) => {
        this.eventHandler.handleRawMessage(connectionId, data);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        this.servers.delete(botId);
        wss.close();
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${wsPort} 已被占用`));
        } else {
          reject(err);
        }
      };
      httpServer.once('error', onError);
      httpServer.listen(wsPort, wsHost, () => {
        httpServer.removeListener('error', onError);
        this.logger.info(`Reverse WS server for bot ${botId} listening on ws://${wsHost}:${wsPort}/qqbot`);
        logService.addLog('info', 'connection', `反向 WS 服务启动: botId=${botId} ws://${wsHost}:${wsPort}/qqbot`);
        resolve();
      });
    });
  }

  /** Stop a per-bot reverse WS server */
  async stopServer(botId: number): Promise<void> {
    const perBot = this.servers.get(botId);
    if (!perBot) return;

    // Remove any active connection
    if (perBot.connectionId) {
      this.connectionManager.removeConnection(perBot.connectionId, 'server stopped');
      perBot.connectionId = undefined;
    }

    // Close WebSocket server and HTTP server
    perBot.wss.close();
    await new Promise<void>((resolve) => {
      perBot.httpServer.close(() => resolve());
    });

    this.servers.delete(botId);
    this.logger.info({ botId }, 'Reverse WS: server stopped');
    logService.addLog('info', 'connection', `反向 WS 服务停止: botId=${botId}`);
  }

  /** Get the connectionId for a botId, if connected */
  getConnectionId(botId: number): string | undefined {
    return this.servers.get(botId)?.connectionId;
  }

  /** Called when a connection is authenticated - update DB with selfId */
  updateBotSelfId(connectionId: string, selfId: number): void {
    for (const [botId, server] of this.servers) {
      if (server.connectionId === connectionId) {
        db.update(schema.bots)
          .set({
            selfId,
            updatedAt: nowDatetime(),
          })
          .where(eq(schema.bots.id, botId))
          .run();
        this.logger.info({ botId, connectionId, selfId }, 'Reverse WS: updated bot selfId');
        break;
      }
    }
  }

  /** Get the botId associated with a connectionId */
  getBotIdByConnectionId(connectionId: string): number | undefined {
    for (const [botId, server] of this.servers) {
      if (server.connectionId === connectionId) return botId;
    }
    return undefined;
  }

  /** Close all per-bot servers (on server shutdown) */
  async closeAll(): Promise<void> {
    this.closed = true;
    const stopPromises: Promise<void>[] = [];
    for (const botId of this.servers.keys()) {
      stopPromises.push(this.stopServer(botId));
    }
    await Promise.all(stopPromises);
  }
}
