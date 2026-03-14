import { nowISO } from '../utils/date.js';

export interface BotWsMessage {
  id: number;
  timestamp: string;
  type: string;
  summary: string;
  detail?: string;
  source?: string;
}

const MAX_PER_BOT = 500;

export class MessageBufferService {
  private buffers = new Map<number, BotWsMessage[]>();
  private nextId = 1;

  addMessage(botId: number, type: string, summary: string, detail?: string, source?: string): void {
    let buffer = this.buffers.get(botId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(botId, buffer);
    }
    buffer.push({
      id: this.nextId++,
      timestamp: nowISO(),
      type,
      summary,
      detail,
      source,
    });
    if (buffer.length > MAX_PER_BOT) {
      buffer.splice(0, buffer.length - MAX_PER_BOT);
    }
  }

  getMessages(botId: number, sinceId?: number): BotWsMessage[] {
    const buffer = this.buffers.get(botId) ?? [];
    if (sinceId !== undefined) {
      return buffer.filter((m) => m.id > sinceId);
    }
    return [...buffer];
  }

  clearBot(botId: number): void {
    this.buffers.delete(botId);
  }
}

export const messageBufferService = new MessageBufferService();
