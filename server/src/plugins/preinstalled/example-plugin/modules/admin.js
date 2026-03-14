import { replyMsg, getAtTarget, resolveTargetQQ, isMaster, getReplyMessageId, friendlyError } from './utils.js';

export async function handleBan(ctx, event, args) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const targetQQ = resolveTargetQQ(event, args);
  if (!targetQQ) return replyMsg(ctx, event, '请 @ 或输入要禁言的用户QQ号，例如: /禁言 @用户 10 或 /禁言 123456 10');
  const extraArgs = getAtTarget(event) ? args : args.slice(1);
  const durationArg = extraArgs.find((a) => /^\d+$/.test(a));
  const minutes = durationArg ? parseInt(durationArg, 10) : 10;
  const durationSec = Math.max(1, Math.min(minutes, 43200)) * 60;
  try {
    await ctx.callApi('set_group_ban', { group_id: event.group_id, user_id: targetQQ, duration: durationSec });
    await replyMsg(ctx, event, `已禁言 ${targetQQ}，时长 ${minutes} 分钟`);
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '禁言失败'));
  }
}

export async function handleUnban(ctx, event, args) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const targetQQ = resolveTargetQQ(event, args);
  if (!targetQQ) return replyMsg(ctx, event, '请 @ 或输入要解禁的用户QQ号，例如: /解禁 @用户 或 /解禁 123456');
  try {
    await ctx.callApi('set_group_ban', { group_id: event.group_id, user_id: targetQQ, duration: 0 });
    await replyMsg(ctx, event, `已解除 ${targetQQ} 的禁言`);
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '解禁失败'));
  }
}

export async function handleKick(ctx, event, args) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const targetQQ = resolveTargetQQ(event, args);
  if (!targetQQ) return replyMsg(ctx, event, '请 @ 或输入要踢出的用户QQ号，例如: /踢 @用户 或 /踢 123456');
  try {
    await ctx.callApi('set_group_kick', { group_id: event.group_id, user_id: targetQQ, reject_add_request: false });
    await replyMsg(ctx, event, `已将 ${targetQQ} 踢出群聊`);
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '踢人失败'));
  }
}

export async function handleWholeBan(ctx, event, enable) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  try {
    await ctx.callApi('set_group_whole_ban', { group_id: event.group_id, enable });
    await replyMsg(ctx, event, enable ? '已开启全员禁言' : '已解除全员禁言');
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '全员禁言操作失败'));
  }
}

export async function handleSetCard(ctx, event, args, argStr) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const targetQQ = resolveTargetQQ(event, args);
  if (!targetQQ) return replyMsg(ctx, event, '请 @ 或输入要设置名片的用户QQ号，例如: /群名片 @用户 新名片 或 /群名片 123456 新名片');
  const card = getAtTarget(event)
    ? argStr.replace(/\[CQ:at,[^\]]*\]/g, '').trim()
    : args.slice(1).join(' ').trim();
  if (!card) return replyMsg(ctx, event, '请输入新名片内容，例如: /群名片 @用户 新名片 或 /群名片 123456 新名片');
  try {
    await ctx.callApi('set_group_card', { group_id: event.group_id, user_id: targetQQ, card });
    await replyMsg(ctx, event, `已将 ${targetQQ} 的群名片设置为: ${card}`);
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '设置名片失败'));
  }
}

export async function handleGroupNotice(ctx, event, content) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  if (!content) return replyMsg(ctx, event, '用法: /群公告 <公告内容>');
  try {
    await ctx.callApi('_send_group_notice', { group_id: event.group_id, content });
    await replyMsg(ctx, event, '群公告已发布');
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '发布群公告失败'));
  }
}

export async function handleSetGroupName(ctx, event, name) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  if (!name) return replyMsg(ctx, event, '用法: /改群名 <新群名>');
  try {
    await ctx.callApi('set_group_name', { group_id: event.group_id, group_name: name });
    await replyMsg(ctx, event, `群名已修改为: ${name}`);
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '修改群名失败'));
  }
}

export async function handleSetGroupAdmin(ctx, event, enable, args) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const targetQQ = resolveTargetQQ(event, args);
  if (!targetQQ) return replyMsg(ctx, event, `请 @ 或输入要${enable ? '设为' : '取消'}管理员的用户QQ号`);
  try {
    await ctx.callApi('set_group_admin', { group_id: event.group_id, user_id: targetQQ, enable });
    await replyMsg(ctx, event, `已${enable ? '设置' : '取消'} ${targetQQ} ${enable ? '为' : '的'}管理员`);
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '设置管理员失败'));
  }
}

export async function handleSetSpecialTitle(ctx, event, args, argStr) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const targetQQ = resolveTargetQQ(event, args);
  if (!targetQQ) return replyMsg(ctx, event, '请 @ 或输入要设置头衔的用户QQ号，例如: /头衔 @用户 头衔 或 /头衔 123456 头衔');
  const title = getAtTarget(event)
    ? argStr.replace(/\[CQ:at,[^\]]*\]/g, '').trim()
    : args.slice(1).join(' ').trim();
  try {
    await ctx.callApi('set_group_special_title', { group_id: event.group_id, user_id: targetQQ, special_title: title, duration: -1 });
    await replyMsg(ctx, event, title ? `已将 ${targetQQ} 的头衔设置为: ${title}` : `已清除 ${targetQQ} 的头衔`);
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '设置头衔失败'));
  }
}

export async function handleLeaveGroup(ctx, event, argStr) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  let groupId;
  if (argStr && /^\d+$/.test(argStr)) {
    groupId = parseInt(argStr, 10);
  } else if (event.message_type === 'group') {
    groupId = event.group_id;
  } else {
    return replyMsg(ctx, event, '用法: /退群 <群号>');
  }
  try {
    if (groupId !== event.group_id) {
      await replyMsg(ctx, event, `正在退出群 ${groupId}...`);
    }
    await ctx.callApi('set_group_leave', { group_id: groupId, is_dismiss: false });
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '退群失败'));
  }
}

export async function handleDeleteMsg(ctx, event) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  const replyId = getReplyMessageId(event);
  if (!replyId) return replyMsg(ctx, event, '请回复要撤回的消息后输入 /撤回');
  try {
    await ctx.callApi('delete_msg', { message_id: replyId });
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '撤回失败'));
  }
}

export async function handleGroupHistory(ctx, event, countStr) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const count = Math.min(Math.max(parseInt(countStr, 10) || 5, 1), 50);
  try {
    const result = await ctx.callApi('get_group_msg_history', { group_id: event.group_id, count });
    const messages = result?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return replyMsg(ctx, event, '没有获取到历史消息');
    }
    const recent = messages.slice(-count);
    const nodes = recent.map((msg) => {
      const nickname = msg.sender?.card || msg.sender?.nickname || String(msg.user_id);
      const userId = String(msg.user_id ?? '10000');
      const content = Array.isArray(msg.message) && msg.message.length > 0
        ? msg.message
        : [{ type: 'text', data: { text: msg.raw_message || '(无法获取内容)' } }];
      return { type: 'node', data: { user_id: userId, nickname, content } };
    });
    await ctx.callApi('send_group_forward_msg', { group_id: event.group_id, messages: nodes });
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '获取历史消息失败'));
  }
}

export async function handleMarkRead(ctx, event) {
  try {
    if (event.message_type === 'group') {
      await ctx.callApi('mark_msg_as_read', { group_id: event.group_id });
    } else {
      await ctx.callApi('mark_msg_as_read', { user_id: event.user_id });
    }
    await replyMsg(ctx, event, '已标记消息为已读');
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '标记已读失败'));
  }
}
