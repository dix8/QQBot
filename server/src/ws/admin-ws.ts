import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import { validateAndConsumeWsTicket } from '../routes/auth.js';
import { authService } from '../services/auth.js';

interface AdminClient {
  socket: WebSocket;
  alive: boolean;
  userId: number;
  tokenVersion: number;
}

export class AdminWsManager {
  private clients = new Set<AdminClient>();
  private logger: FastifyBaseLogger;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  /** Check if a client's session is still valid (tokenVersion matches DB, not on default password) */
  private isClientSessionValid(client: AdminClient): boolean {
    if (authService.getTokenVersion(client.userId) !== client.tokenVersion) return false;
    if (authService.isDefaultPassword(client.userId)) return false;
    return true;
  }

  /** Immediately close all admin WS connections belonging to the given userId */
  invalidateUserSessions(userId: number, reason?: string): void {
    const msg = reason ?? 'Session invalidated';
    for (const client of this.clients) {
      if (client.userId === userId) {
        client.socket.close(4004, msg);
        this.clients.delete(client);
        this.logger.info({ userId }, `Admin WS session invalidated: ${msg}`);
      }
    }
  }

  register(fastify: FastifyInstance): void {
    fastify.get('/ws/admin', { websocket: true }, (socket, request) => {
      const ticket = (request.query as Record<string, string>).ticket;
      if (!ticket) {
        socket.close(4001, 'Missing ticket');
        return;
      }

      const user = validateAndConsumeWsTicket(ticket);
      if (!user) {
        socket.close(4003, 'Invalid or expired ticket');
        return;
      }

      const client: AdminClient = { socket, alive: true, userId: user.userId, tokenVersion: user.tokenVersion };
      this.clients.add(client);
      this.logger.info(`Admin WS client connected (total: ${this.clients.size})`);

      socket.on('pong', () => {
        client.alive = true;
      });

      socket.on('close', () => {
        this.clients.delete(client);
        this.logger.info(`Admin WS client disconnected (total: ${this.clients.size})`);
      });

      socket.on('error', () => {
        this.clients.delete(client);
      });
    });

    this.pingTimer = setInterval(() => {
      const dead: AdminClient[] = [];
      for (const client of this.clients) {
        if (!client.alive) {
          dead.push(client);
          continue;
        }
        // Validate session: close if password changed or default password
        if (!this.isClientSessionValid(client)) {
          dead.push(client);
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
      for (const client of dead) {
        client.socket.close(4004, 'Session invalidated');
        this.clients.delete(client);
      }
    }, 30_000);
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify({ event, data });
    const stale: AdminClient[] = [];
    for (const client of this.clients) {
      if (!this.isClientSessionValid(client)) {
        stale.push(client);
        continue;
      }
      if (client.socket.readyState === 1) {
        client.socket.send(payload);
      }
    }
    // Clean up stale clients discovered during broadcast
    for (const client of stale) {
      client.socket.close(4004, 'Session invalidated');
      this.clients.delete(client);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const client of this.clients) {
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();
  }
}
