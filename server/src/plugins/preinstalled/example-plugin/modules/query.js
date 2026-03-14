import { replyMsg, resolveTargetQQ, isMaster, friendlyError } from './utils.js';

export async function handleGroupList(ctx, event) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  try {
    const groups = await ctx.callApi('get_group_list');
    if (!Array.isArray(groups) || groups.length === 0) {
      return replyMsg(ctx, event, '当前没有加入任何群');
    }
    const lines = [`=== 群列表 (共 ${groups.length} 个) ===`];
    const show = groups.slice(0, 20);
    for (const g of show) {
      lines.push(`${g.group_id} — ${g.group_name || '(未知)'} (${g.member_count || '?'}人)`);
    }
    if (groups.length > 20) lines.push(`... 等共 ${groups.length} 个群`);
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '获取群列表失败'));
  }
}

export async function handleGroupMemberList(ctx, event) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  try {
    const members = await ctx.callApi('get_group_member_list', { group_id: event.group_id });
    if (!Array.isArray(members) || members.length === 0) {
      return replyMsg(ctx, event, '获取群成员列表为空');
    }
    const owner = members.filter((m) => m.role === 'owner');
    const admins = members.filter((m) => m.role === 'admin');
    const lines = [
      '=== 群成员统计 ===',
      `总人数: ${members.length}`,
      `群主: ${owner.map((m) => `${m.card || m.nickname}(${m.user_id})`).join(', ') || '无'}`,
      `管理员: ${admins.length} 人`,
    ];
    if (admins.length > 0 && admins.length <= 20) {
      for (const m of admins) {
        lines.push(`  ${m.card || m.nickname}(${m.user_id})`);
      }
    }
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '获取群成员列表失败'));
  }
}

export async function handleGetMemberInfo(ctx, event, args) {
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  const targetQQ = resolveTargetQQ(event, args);
  if (!targetQQ) return replyMsg(ctx, event, '请 @ 或输入要查询的用户QQ号，例如: /查群员 @用户 或 /查群员 123456');
  try {
    const info = await ctx.callApi('get_group_member_info', { group_id: event.group_id, user_id: targetQQ, no_cache: true });
    const joinTime = info.join_time ? new Date(info.join_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知';
    const lastSent = info.last_sent_time ? new Date(info.last_sent_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知';
    const roleMap = { owner: '群主', admin: '管理员', member: '成员' };
    const lines = [
      '=== 群成员信息 ===',
      `QQ: ${info.user_id}`,
      `昵称: ${info.nickname || '未知'}`,
      `群名片: ${info.card || '(无)'}`,
      `身份: ${roleMap[info.role] || info.role || '未知'}`,
      `入群时间: ${joinTime}`,
      `最后发言: ${lastSent}`,
      `等级: ${info.level || '未知'}`,
    ];
    if (info.title) lines.push(`头衔: ${info.title}`);
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('1200') || msg.includes('not found')) {
      await replyMsg(ctx, event, `该用户(${targetQQ})不在本群中`);
    } else {
      await replyMsg(ctx, event, friendlyError(err, '查询群成员失败'));
    }
  }
}

export async function handleFriendList(ctx, event) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  try {
    const friends = await ctx.callApi('get_friend_list');
    if (!Array.isArray(friends) || friends.length === 0) {
      return replyMsg(ctx, event, '好友列表为空');
    }
    const lines = [`=== 好友列表 (共 ${friends.length} 人) ===`];
    const show = friends.slice(0, 20);
    for (const f of show) {
      lines.push(`${f.user_id} — ${f.remark || f.nickname || '(未知)'}`);
    }
    if (friends.length > 20) lines.push(`... 等共 ${friends.length} 人`);
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '获取好友列表失败'));
  }
}

export async function handleStrangerInfo(ctx, event, qqStr) {
  if (!qqStr || !/^\d+$/.test(qqStr)) return replyMsg(ctx, event, '用法: /查用户 <QQ号>');
  try {
    const info = await ctx.callApi('get_stranger_info', { user_id: parseInt(qqStr, 10), no_cache: true });
    const sexMap = { male: '男', female: '女' };
    const lines = [
      '=== 用户信息 ===',
      `QQ: ${info.user_id}`,
      `昵称: ${info.nickname || '未知'}`,
      `性别: ${sexMap[info.sex] || '未知'}`,
      `年龄: ${info.age || '未知'}`,
    ];
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('1200') || msg.includes('not found')) {
      await replyMsg(ctx, event, `未找到该用户(${qqStr})的信息`);
    } else {
      await replyMsg(ctx, event, friendlyError(err, '查询用户失败'));
    }
  }
}

export async function handleGroupHonor(ctx, event) {
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  try {
    const honor = await ctx.callApi('get_group_honor_info', { group_id: event.group_id, type: 'all' });
    const lines = ['=== 群荣誉信息 ==='];
    if (honor.current_talkative) {
      const t = honor.current_talkative;
      lines.push(`当前龙王: ${t.nickname || t.user_id} (${t.day_count || 0}天)`);
    }
    if (honor.talkative_list?.length > 0) {
      lines.push('', '历史龙王:');
      for (const t of honor.talkative_list.slice(0, 5)) {
        lines.push(`  ${t.nickname || t.user_id} — ${t.day_count || 0}天`);
      }
    }
    if (honor.performer_list?.length > 0) {
      lines.push('', '群聊之火:');
      for (const p of honor.performer_list.slice(0, 5)) {
        lines.push(`  ${p.nickname || p.user_id}`);
      }
    }
    if (honor.emotion_list?.length > 0) {
      lines.push('', '快乐源泉:');
      for (const e of honor.emotion_list.slice(0, 5)) {
        lines.push(`  ${e.nickname || e.user_id}`);
      }
    }
    if (lines.length === 1) lines.push('暂无荣誉信息');
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '获取群荣誉失败'));
  }
}

export async function handleGroupFiles(ctx, event) {
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  try {
    const result = await ctx.callApi('get_group_root_files', { group_id: event.group_id });
    const files = result?.files || [];
    const folders = result?.folders || [];
    const lines = ['=== 群文件 ==='];
    if (folders.length > 0) {
      lines.push(`📁 文件夹 (${folders.length} 个):`);
      for (const f of folders.slice(0, 10)) lines.push(`  📁 ${f.folder_name}`);
      if (folders.length > 10) lines.push(`  ... 共 ${folders.length} 个文件夹`);
    }
    if (files.length > 0) {
      lines.push(`📄 文件 (${files.length} 个):`);
      for (const f of files.slice(0, 10)) {
        const size = f.file_size < 1024 * 1024
          ? `${(f.file_size / 1024).toFixed(1)}KB`
          : `${(f.file_size / (1024 * 1024)).toFixed(1)}MB`;
        lines.push(`  📄 ${f.file_name} (${size})`);
      }
      if (files.length > 10) lines.push(`  ... 共 ${files.length} 个文件`);
    }
    if (files.length === 0 && folders.length === 0) lines.push('群文件为空');
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '获取群文件失败'));
  }
}

export async function handleGroupFileInfo(ctx, event) {
  if (event.message_type !== 'group') return replyMsg(ctx, event, '此指令仅在群聊中可用');
  try {
    const info = await ctx.callApi('get_group_file_system_info', { group_id: event.group_id });
    const formatSize = (bytes) => {
      if (!bytes) return '0B';
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
    };
    const lines = [
      '=== 群文件系统 ===',
      `文件数: ${info.file_count || 0}`,
      `已用空间: ${formatSize(info.used_space)}`,
      `总空间: ${formatSize(info.total_space)}`,
    ];
    await replyMsg(ctx, event, lines.join('\n'));
  } catch (err) {
    await replyMsg(ctx, event, friendlyError(err, '获取群文件信息失败'));
  }
}
