import { nowISO } from '../utils/date.js';

export type NotificationType =
  | 'bot_connected'
  | 'bot_disconnected'
  | 'heartbeat_timeout'
  | 'plugin_error'
  | 'plugin_disabled'
  | 'login_failed';

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface Notification {
  id: number;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  timestamp: string;
}

const MAX_BUFFER = 200;

class NotificationService {
  private buffer: Notification[] = [];
  private nextId = 1;
  private broadcastFn: ((event: string, data: unknown) => void) | null = null;

  setBroadcast(fn: (event: string, data: unknown) => void): void {
    this.broadcastFn = fn;
  }

  add(type: NotificationType, severity: NotificationSeverity, title: string, message: string): Notification {
    const notification: Notification = {
      id: this.nextId++,
      type,
      severity,
      title,
      message,
      timestamp: nowISO(),
    };

    this.buffer.push(notification);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(-MAX_BUFFER);
    }

    if (this.broadcastFn) {
      this.broadcastFn('notification', notification);
    }

    return notification;
  }

  getRecent(limit = 50): Notification[] {
    return this.buffer.slice(-limit).reverse();
  }
}

export const notificationService = new NotificationService();
