import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBufferService } from '../../services/message-buffer.js';

describe('MessageBufferService', () => {
  let buffer: MessageBufferService;

  beforeEach(() => {
    buffer = new MessageBufferService();
  });

  it('adds and retrieves messages', () => {
    buffer.addMessage(1, 'info', 'hello');
    const msgs = buffer.getMessages(1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].summary).toBe('hello');
    expect(msgs[0].type).toBe('info');
  });

  it('returns empty array for unknown bot', () => {
    expect(buffer.getMessages(999)).toEqual([]);
  });

  it('preserves optional fields', () => {
    buffer.addMessage(1, 'error', 'fail', 'stack trace', 'plugin-x');
    const msg = buffer.getMessages(1)[0];
    expect(msg.detail).toBe('stack trace');
    expect(msg.source).toBe('plugin-x');
  });

  it('respects MAX_PER_BOT=500 capacity limit', () => {
    for (let i = 0; i < 600; i++) {
      buffer.addMessage(1, 'info', `msg-${i}`);
    }
    const msgs = buffer.getMessages(1);
    expect(msgs).toHaveLength(500);
    expect(msgs[0].summary).toBe('msg-100');
    expect(msgs[499].summary).toBe('msg-599');
  });

  it('getSince returns only messages after given id', () => {
    buffer.addMessage(1, 'info', 'first');
    buffer.addMessage(1, 'info', 'second');
    buffer.addMessage(1, 'info', 'third');

    const all = buffer.getMessages(1);
    const sinceId = all[0].id;
    const newer = buffer.getMessages(1, sinceId);
    expect(newer).toHaveLength(2);
    expect(newer[0].summary).toBe('second');
    expect(newer[1].summary).toBe('third');
  });

  it('isolates messages between bots', () => {
    buffer.addMessage(1, 'info', 'bot1-msg');
    buffer.addMessage(2, 'info', 'bot2-msg');
    expect(buffer.getMessages(1)).toHaveLength(1);
    expect(buffer.getMessages(2)).toHaveLength(1);
    expect(buffer.getMessages(1)[0].summary).toBe('bot1-msg');
    expect(buffer.getMessages(2)[0].summary).toBe('bot2-msg');
  });

  it('clearBot removes messages for specific bot only', () => {
    buffer.addMessage(1, 'info', 'bot1');
    buffer.addMessage(2, 'info', 'bot2');
    buffer.clearBot(1);
    expect(buffer.getMessages(1)).toEqual([]);
    expect(buffer.getMessages(2)).toHaveLength(1);
  });

  it('getMessages returns a copy, not internal reference', () => {
    buffer.addMessage(1, 'info', 'test');
    const msgs = buffer.getMessages(1);
    msgs.length = 0;
    expect(buffer.getMessages(1)).toHaveLength(1);
  });
});
