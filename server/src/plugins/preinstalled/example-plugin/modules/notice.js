function randomPokeReply(ctx) {
  const raw = ctx.getConfig('pokeReplies') ?? '别戳了！|戳你一下！|干嘛戳我 >_<|再戳就坏了！|你好呀~';
  const replies = raw.split('|').map((s) => s.trim()).filter(Boolean);
  if (replies.length === 0) return '别戳了！';
  return replies[Math.floor(Math.random() * replies.length)];
}

export async function handleNotice(ctx, event) {
  // 戳一戳回应
  if (event.notice_type === 'notify' && event.sub_type === 'poke') {
    const enablePokeReply = ctx.getConfig('enablePokeReply') ?? true;
    if (enablePokeReply && event.target_id === event.self_id && event.group_id) {
      const reply = randomPokeReply(ctx);
      await ctx.sendMessage('group', event.group_id, [
        { type: 'at', data: { qq: String(event.user_id) } },
        { type: 'text', data: { text: ` ${reply}` } },
      ]);
    }
  }

  // 进群欢迎
  if (event.notice_type === 'group_increase' && event.group_id && event.user_id) {
    const enableWelcome = ctx.getConfig('enableWelcome') ?? true;
    if (enableWelcome) {
      const welcomeMsg = ctx.getConfig('welcomeMsg') ?? '欢迎加入！';
      await ctx.sendMessage('group', event.group_id, [
        { type: 'at', data: { qq: String(event.user_id) } },
        { type: 'text', data: { text: ` ${welcomeMsg}` } },
      ]);
    }
  }

  // 防撤回（群聊）
  if (event.notice_type === 'group_recall' && event.group_id) {
    const enableAntiRecall = ctx.getConfig('enableAntiRecall') ?? false;
    if (enableAntiRecall && event.message_id) {
      try {
        const cached = messageCache.get(event.message_id);
        let senderName, messageSegs, sendTime;
        if (cached) {
          senderName = cached.sender;
          messageSegs = cached.message;
          sendTime = new Date(cached.time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          messageCache.delete(event.message_id);
        } else {
          const msgData = await ctx.callApi('get_msg', { message_id: event.message_id });
          senderName = msgData.sender?.nickname || String(event.user_id);
          messageSegs = (Array.isArray(msgData.message) && msgData.message.length > 0)
            ? msgData.message
            : (msgData.raw_message ? [{ type: 'text', data: { text: msgData.raw_message } }] : null);
          sendTime = new Date((msgData.time ?? 0) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        }

        const operatorId = event.operator_id;
        const isSelfRecall = operatorId === event.user_id;
        const recallDesc = isSelfRecall
          ? `${senderName}(${event.user_id}) 撤回了一条消息`
          : `管理员(${operatorId}) 撤回了 ${senderName}(${event.user_id}) 的一条消息`;

        const nodes = [
          { type: 'node', data: { user_id: '10000', nickname: '消息内容', content: [{ type: 'text', data: { text: `${recallDesc}\n时间: ${sendTime}` } }] } },
          { type: 'node', data: { user_id: '10000', nickname: '消息内容', content: messageSegs || [{ type: 'text', data: { text: '(无法获取消息内容)' } }] } },
        ];

        await ctx.callApi('send_group_forward_msg', { group_id: event.group_id, messages: nodes });
      } catch (err) {
        ctx.logger.warn(`防撤回处理失败: ${err.message || err}`);
      }
    }
  }

  // 私聊防撤回
  if (event.notice_type === 'friend_recall' && event.user_id) {
    const enableAntiRecall = ctx.getConfig('enableAntiRecall') ?? false;
    if (enableAntiRecall && event.message_id) {
      try {
        const cached = messageCache.get(event.message_id);
        let senderName, messageSegs, sendTime;
        if (cached) {
          senderName = cached.sender;
          messageSegs = cached.message;
          sendTime = new Date(cached.time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          messageCache.delete(event.message_id);
        } else {
          const msgData = await ctx.callApi('get_msg', { message_id: event.message_id });
          senderName = msgData.sender?.nickname || String(event.user_id);
          messageSegs = (Array.isArray(msgData.message) && msgData.message.length > 0)
            ? msgData.message
            : (msgData.raw_message ? [{ type: 'text', data: { text: msgData.raw_message } }] : null);
          sendTime = new Date((msgData.time ?? 0) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        }
        await ctx.sendMessage('private', event.user_id, `${senderName}(${event.user_id}) 撤回了一条消息\n时间: ${sendTime}\n内容:`);
        if (messageSegs) {
          await ctx.sendMessage('private', event.user_id, messageSegs);
        } else {
          await ctx.sendMessage('private', event.user_id, '(无法获取消息内容)');
        }
      } catch (err) {
        ctx.logger.warn(`私聊防撤回处理失败: ${err.message || err}`);
      }
    }
  }

  // 退群/被踢通知
  if (event.notice_type === 'group_decrease' && event.group_id && event.user_id) {
    const enableLeaveNotice = ctx.getConfig('enableLeaveNotice') ?? true;
    if (enableLeaveNotice) {
      let msg;
      if (event.sub_type === 'kick') {
        const operatorId = event.operator_id;
        msg = `成员 ${event.user_id} 被${operatorId ? ` ${operatorId} ` : ''}移出了群聊`;
      } else {
        msg = `成员 ${event.user_id} 退出了群聊`;
      }
      await ctx.sendMessage('group', event.group_id, msg);
    }
  }

  // 管理员变动通知
  if (event.notice_type === 'group_admin' && event.group_id && event.user_id) {
    const enableAdminNotice = ctx.getConfig('enableAdminNotice') ?? true;
    if (enableAdminNotice) {
      const action = event.sub_type === 'set' ? '被设为管理员' : '被取消管理员';
      await ctx.sendMessage('group', event.group_id, `成员 ${event.user_id} ${action}`);
    }
  }

  // 禁言通知（user_id 为 0 表示全员禁言/解禁，单独处理）
  if (event.notice_type === 'group_ban' && event.group_id) {
    const enableBanNotice = ctx.getConfig('enableBanNotice') ?? true;
    if (enableBanNotice) {
      const isWholeBan = !event.user_id || event.user_id === 0;
      if (isWholeBan) {
        const action = event.sub_type === 'ban' ? '开启了全员禁言' : '解除了全员禁言';
        await ctx.sendMessage('group', event.group_id,
          `${event.operator_id || '管理员'} ${action}`);
      } else if (event.sub_type === 'ban') {
        const duration = event.duration;
        const minutes = duration ? Math.floor(duration / 60) : 0;
        const durationText = minutes >= 1440
          ? `${Math.floor(minutes / 1440)} 天`
          : minutes >= 60
            ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
            : `${minutes} 分钟`;
        await ctx.sendMessage('group', event.group_id,
          `成员 ${event.user_id} 被 ${event.operator_id || '管理员'} 禁言 ${durationText}`);
      } else if (event.sub_type === 'lift_ban') {
        await ctx.sendMessage('group', event.group_id,
          `成员 ${event.user_id} 被 ${event.operator_id || '管理员'} 解除禁言`);
      }
    }
  }

  // 好友添加欢迎
  if (event.notice_type === 'friend_add' && event.user_id) {
    const enableFriendWelcome = ctx.getConfig('enableFriendWelcome') ?? true;
    if (enableFriendWelcome) {
      const welcomeMsg = ctx.getConfig('friendWelcomeMsg') ?? '你好！很高兴认识你~';
      await ctx.sendMessage('private', event.user_id, welcomeMsg);
    }
  }

  // 群文件上传通知
  if (event.notice_type === 'group_upload' && event.group_id) {
    const enableFileNotice = ctx.getConfig('enableFileNotice') ?? false;
    if (enableFileNotice) {
      const file = event.file;
      const fileName = file?.name || '未知文件';
      const fileSize = file?.size;
      const sizeText = fileSize
        ? fileSize < 1024 * 1024
          ? `${(fileSize / 1024).toFixed(1)}KB`
          : `${(fileSize / (1024 * 1024)).toFixed(1)}MB`
        : '未知大小';
      await ctx.sendMessage('group', event.group_id,
        `${event.user_id} 上传了文件: ${fileName} (${sizeText})`);
    }
  }

  // 荣誉变更通知
  if (event.notice_type === 'notify' && event.sub_type === 'honor' && event.group_id) {
    const enableHonorNotice = ctx.getConfig('enableHonorNotice') ?? true;
    if (enableHonorNotice) {
      const honorMap = { talkative: '龙王', performer: '群聊之火', emotion: '快乐源泉' };
      const honorName = honorMap[event.honor_type] || event.honor_type || '未知荣誉';
      await ctx.sendMessage('group', event.group_id, `恭喜 ${event.user_id} 获得「${honorName}」荣誉！`);
    }
  }

}

// 消息缓存（防撤回用），由 index.js 调用
const messageCache = new Map();
const MESSAGE_CACHE_MAX = 500;

export function cacheMessage(event) {
  if (!event.message_id) return;
  const senderName = event.sender?.card || event.sender?.nickname || String(event.user_id);
  const message = Array.isArray(event.message) && event.message.length > 0
    ? event.message
    : (event.raw_message ? [{ type: 'text', data: { text: event.raw_message } }] : null);
  if (message) {
    messageCache.set(event.message_id, {
      sender: senderName,
      userId: event.user_id,
      message,
      time: event.time || Math.floor(Date.now() / 1000),
    });
    if (messageCache.size > MESSAGE_CACHE_MAX) {
      const firstKey = messageCache.keys().next().value;
      messageCache.delete(firstKey);
    }
  }
}

export function clearMessageCache() {
  messageCache.clear();
}
