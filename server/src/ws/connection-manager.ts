import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import {
  ConnectionState,
  type BotInfo,
  type NapCatConnectionInfo,
} from '../types/onebot.js';

export interface ConnectionEvents {
  'connection:added': [id: string];
  'connection:removed': [id: string, reason?: string];
  'connection:authenticated': [id: string, selfId: number];
  'connection:error': [id: string, error: string];
  'connection:heartbeat-timeout': [id: string];
  [key: string]: unknown[];
}

type TypedEmitter<T extends Record<string, unknown[]>> = {
  on<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): TypedEmitter<T>;
  emit<K extends keyof T & string>(event: K, ...args: T[K]): boolean;
};

export interface ManagedConnection {
  id: string;
  socket: WebSocket;
  remoteAddress: string;
  state: ConnectionState;
  selfId?: number;
  connectedAt: Date;
  lastHeartbeat?: Date;
  botInfo?: BotInfo;
  heartbeatTimer?: ReturnType<typeof setTimeout>;
  error?: string;
}

export interface ConnectionManagerOptions {
  heartbeatTimeoutMs?: number;
}

export class ConnectionManager extends (EventEmitter as new () => EventEmitter & TypedEmitter<ConnectionEvents>) {
  private connections = new Map<string, ManagedConnection>();
  private selfIdIndex = new Map<number, string>();
  private heartbeatTimeoutMs: number;
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger, options: ConnectionManagerOptions = {}) {
    super();
    this.logger = logger;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 60000;
  }

  addConnection(
    id: string,
    socket: WebSocket,
    remoteAddress: string,
    onMessage: (data: string) => void,
  ): void {
    const connection: ManagedConnection = {
      id,
      socket,
      remoteAddress,
      state: ConnectionState.CONNECTED,
      connectedAt: new Date(),
    };

    this.connections.set(id, connection);
    this.startHeartbeatTimer(id);

    socket.on('message', (raw: Buffer | string) => {
      try {
        const data = typeof raw === 'string' ? raw : raw.toString('utf-8');
        onMessage(data);
      } catch (err) {
        this.logger.error({ err, connectionId: id }, 'Failed to process WebSocket message');
      }
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.logger.info(
        { connectionId: id, code, reason: reason.toString() },
        'WebSocket connection closed',
      );
      this.removeConnection(id, `closed (code: ${code})`);
    });

    socket.on('error', (err: Error) => {
      this.logger.error({ err, connectionId: id }, 'WebSocket error');
      this.markError(id, err.message);
    });

    this.logger.info({ connectionId: id, remoteAddress }, 'New WebSocket connection');
    this.emit('connection:added', id);
  }

  removeConnection(id: string, reason?: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;

    if (connection.heartbeatTimer) {
      clearTimeout(connection.heartbeatTimer);
    }

    if (connection.selfId !== undefined) {
      this.selfIdIndex.delete(connection.selfId);
    }

    // Close socket if still open
    if (
      connection.socket.readyState === connection.socket.OPEN ||
      connection.socket.readyState === connection.socket.CONNECTING
    ) {
      connection.socket.close(1000, reason ?? 'removed');
    }

    this.connections.delete(id);
    this.logger.info({ connectionId: id, reason }, 'Connection removed');
    this.emit('connection:removed', id, reason);
  }

  getConnection(id: string): ManagedConnection | undefined {
    return this.connections.get(id);
  }

  getConnectionBySelfId(selfId: number): ManagedConnection | undefined {
    const connectionId = this.selfIdIndex.get(selfId);
    if (!connectionId) return undefined;
    return this.connections.get(connectionId);
  }

  getAllConnections(): ManagedConnection[] {
    return Array.from(this.connections.values());
  }

  getActiveCount(): number {
    return this.connections.size;
  }

  updateHeartbeat(id: string, status?: Record<string, unknown>, interval?: number): void {
    const connection = this.connections.get(id);
    if (!connection) return;

    connection.lastHeartbeat = new Date();
    this.startHeartbeatTimer(id, interval);
  }

  updateBotInfo(id: string, botInfo: BotInfo): void {
    const connection = this.connections.get(id);
    if (!connection) return;

    connection.botInfo = botInfo;
    this.logger.info(
      { connectionId: id, userId: botInfo.user_id, nickname: botInfo.nickname },
      'Bot info updated',
    );
  }

  markAuthenticated(id: string, selfId: number): void {
    const connection = this.connections.get(id);
    if (!connection) return;

    // If another connection exists for this selfId, kick the old one
    const existingId = this.selfIdIndex.get(selfId);
    if (existingId && existingId !== id) {
      this.logger.warn(
        { oldConnectionId: existingId, newConnectionId: id, selfId },
        'Duplicate selfId detected, closing old connection',
      );
      this.removeConnection(existingId, 'replaced by new connection');
    }

    connection.state = ConnectionState.AUTHENTICATED;
    connection.selfId = selfId;
    this.selfIdIndex.set(selfId, id);

    this.logger.info({ connectionId: id, selfId }, 'Connection authenticated');
    this.emit('connection:authenticated', id, selfId);
  }

  markError(id: string, error: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;

    connection.state = ConnectionState.ERROR;
    connection.error = error;
    this.emit('connection:error', id, error);
  }

  closeAll(): void {
    for (const id of this.connections.keys()) {
      this.removeConnection(id, 'server shutdown');
    }
  }

  toConnectionInfo(connection: ManagedConnection): NapCatConnectionInfo {
    return {
      id: connection.id,
      selfId: connection.selfId,
      state: connection.state,
      connectedAt: connection.connectedAt.toISOString(),
      lastHeartbeat: connection.lastHeartbeat?.toISOString(),
      remoteAddress: connection.remoteAddress,
      botInfo: connection.botInfo,
      error: connection.error,
    };
  }

  private startHeartbeatTimer(id: string, intervalMs?: number): void {
    const connection = this.connections.get(id);
    if (!connection) return;

    if (connection.heartbeatTimer) {
      clearTimeout(connection.heartbeatTimer);
    }

    const timeout = intervalMs
      ? Math.max(intervalMs * 2, this.heartbeatTimeoutMs)
      : this.heartbeatTimeoutMs;

    connection.heartbeatTimer = setTimeout(() => {
      this.logger.warn({ connectionId: id, timeoutMs: timeout }, 'Heartbeat timeout');
      this.emit('connection:heartbeat-timeout', id);
      this.removeConnection(id, 'heartbeat timeout');
    }, timeout);
  }
}
