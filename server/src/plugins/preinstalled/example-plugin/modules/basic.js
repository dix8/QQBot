import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getTarget, replyMsg, friendlyError } from './utils.js';

function readCounter(ctx) {
  const file = join(ctx.dataDir, 'counter.json');
  if (!existsSync(file)) return 0;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')).count || 0;
  } catch {
    return 0;
  }
}

function writeCounter(ctx, count) {
  const file = join(ctx.dataDir, 'counter.json');
  writeFileSync(file, JSON.stringify({ count }), 'utf-8');
}

export async function handlePing(ctx, event) {
  await ctx.sendMessage(event.message_type, getTarget(event), 'pong 🏓');
}

export async function handleEcho(ctx, event, content) {
  const maxLen = ctx.getConfig('maxEchoLen') ?? 100;
  if (content.length > maxLen) {
    await ctx.sendMessage(event.message_type, getTarget(event),
      `消息太长了（${content.length}/${maxLen}），不复读`);
    return;
  }

  const mode = ctx.getConfig('echoMode') ?? 'text';
  if (mode === 'raw') {
    await ctx.sendMessage(event.message_type, getTarget(event), event.message);
  } else {
    await ctx.sendMessage(event.message_type, getTarget(event), content);
  }
}

export async function handleInfo(ctx, event) {
  try {
    const info = await ctx.callApi('get_login_info');
    const basic = ctx.getBotConfig('basic');
    const botNickname = basic?.nickname;
    const lines = [
      'Bot 信息:',
      `QQ: ${info.user_id}`,
      `QQ昵称: ${info.nickname}`,
    ];
    if (botNickname) {
      lines.push(`Bot昵称: ${botNickname}`);
    }
    await ctx.sendMessage(event.message_type, getTarget(event), lines.join('\n'));
  } catch (err) {
    await ctx.sendMessage(event.message_type, getTarget(event),
      friendlyError(err, '获取信息失败'));
  }
}

export async function handleTime(ctx, event) {
  const count = readCounter(ctx) + 1;
  writeCounter(ctx, count);
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  await ctx.sendMessage(event.message_type, getTarget(event),
    `当前时间: ${now}\n/time 已被调用 ${count} 次`);
}

function readLikeRecord(ctx) {
  const file = join(ctx.dataDir, 'likes.json');
  if (!existsSync(file)) return { date: '', users: {} };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { date: '', users: {} };
  }
}

function writeLikeRecord(ctx, record) {
  const file = join(ctx.dataDir, 'likes.json');
  writeFileSync(file, JSON.stringify(record), 'utf-8');
}

function getTodayStr() {
  return new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
}

export async function handleLike(ctx, event) {
  const today = getTodayStr();
  const record = readLikeRecord(ctx);
  if (record.date !== today) {
    record.date = today;
    record.users = {};
  }

  const uid = String(event.user_id);
  if (record.users[uid]) {
    return ctx.sendMessage(event.message_type, getTarget(event),
      '今天已经给你点过赞啦，明天再来吧~');
  }

  try {
    await ctx.callApi('send_like', { user_id: event.user_id, times: 10 });
    record.users[uid] = true;
    writeLikeRecord(ctx, record);
    await ctx.sendMessage(event.message_type, getTarget(event), '已给你点赞 10 次 👍');
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('1200') || msg.includes('already')) {
      record.users[uid] = true;
      writeLikeRecord(ctx, record);
      await ctx.sendMessage(event.message_type, getTarget(event),
        '今天已经给你点过赞啦，明天再来吧~');
    } else {
      await ctx.sendMessage(event.message_type, getTarget(event),
        friendlyError(err, '点赞失败'));
    }
  }
}
