// ── Shared utilities for example plugin ──
// No global context. All ctx-dependent functions receive ctx explicitly.

let appCtx;

export function setAppContext(app) { appCtx = app; }
export function getAppContext() { return appCtx; }
export function clearAppContext() { appCtx = null; }

export function getTarget(event) {
  return event.message_type === 'private' ? event.user_id : event.group_id;
}

export async function replyMsg(ctx, event, text) {
  await ctx.sendMessage(event.message_type, getTarget(event), text);
}

export function getAtTarget(event) {
  const message = event.message;
  if (!Array.isArray(message)) return undefined;
  const atSeg = message.find((seg) => seg.type === 'at' && seg.data?.qq !== 'all');
  if (atSeg) {
    const qq = parseInt(String(atSeg.data?.qq), 10);
    return isNaN(qq) ? undefined : qq;
  }
  return undefined;
}

export function resolveTargetQQ(event, args) {
  const atTarget = getAtTarget(event);
  if (atTarget) return atTarget;
  if (args && args.length > 0 && /^\d{5,11}$/.test(args[0])) {
    return parseInt(args[0], 10);
  }
  return undefined;
}

export function getReplyMessageId(event) {
  const message = event.message;
  if (!Array.isArray(message)) return undefined;
  const replySeg = message.find((seg) => seg.type === 'reply');
  if (replySeg) {
    const id = parseInt(String(replySeg.data?.id), 10);
    return isNaN(id) ? undefined : id;
  }
  return undefined;
}

export function getPureText(event) {
  const message = event.message;
  if (!Array.isArray(message)) return event.raw_message?.trim() || '';
  return message
    .filter((seg) => seg.type === 'text')
    .map((seg) => seg.data?.text || '')
    .join('')
    .trim();
}

export function isMaster(ctx, userId) {
  const superAdmins = ctx.getBotConfig('superAdmins');
  if (Array.isArray(superAdmins) && superAdmins.includes(userId)) return true;
  const basic = ctx.getBotConfig('basic');
  if (basic && Array.isArray(basic.masterQQ)) return basic.masterQQ.includes(userId);
  return false;
}

export function formatMessageContent(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (!Array.isArray(message) || message.length === 0) return '';

  return message.map((seg) => {
    switch (seg.type) {
      case 'text': return seg.data?.text || '';
      case 'image': return '[图片]';
      case 'face': return '[表情]';
      case 'at': return seg.data?.qq === 'all' ? '@全体成员' : `@${seg.data?.qq}`;
      case 'reply': return '';
      case 'record': return '[语音]';
      case 'video': return '[视频]';
      case 'json': return '[JSON消息]';
      case 'xml': return '[XML消息]';
      case 'forward': return '[转发消息]';
      case 'file': return '[文件]';
      case 'mface': return '[表情包]';
      case 'rps': return '[猜拳]';
      case 'dice': return '[骰子]';
      case 'poke': return '[戳一戳]';
      case 'share': return `[分享: ${seg.data?.title || ''}]`;
      case 'music': return '[音乐]';
      case 'location': return '[位置]';
      default: return `[${seg.type}]`;
    }
  }).join('');
}

const ERROR_MAP = [
  { codes: ['1200'], hint: '目标不存在或无权限操作' },
  { codes: ['1400'], hint: '请求参数有误' },
  { codes: ['1403', '403'], hint: 'Bot 权限不足，请确认 Bot 是否为管理员' },
  { codes: ['1404', '404'], hint: '目标不存在' },
];

export function friendlyError(err, context) {
  const msg = String(err?.message || err);
  for (const { codes, hint } of ERROR_MAP) {
    if (codes.some((c) => msg.includes(c))) {
      return context ? `${context}: ${hint}` : hint;
    }
  }
  return context ? `${context}: ${msg}` : msg;
}
