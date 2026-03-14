import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

let checkinData = {};

function getTodayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

export function loadCheckinData(dataDir) {
  const file = join(dataDir, 'checkin.json');
  if (!existsSync(file)) { checkinData = {}; return; }
  try {
    checkinData = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    checkinData = {};
  }
}

function saveCheckinData(dataDir) {
  const file = join(dataDir, 'checkin.json');
  writeFileSync(file, JSON.stringify(checkinData), 'utf-8');
}

export function getCheckinData() { return checkinData; }

export async function handleCheckin(ctx, event) {
  if (event.message_type !== 'group') {
    await ctx.sendMessage('private', event.user_id, '签到功能仅支持群聊');
    return;
  }
  const groupId = String(event.group_id);
  const userId = String(event.user_id);
  const today = getTodayStr();

  if (!checkinData[groupId]) checkinData[groupId] = {};
  const userData = checkinData[groupId][userId] || { total: 0, streak: 0, lastDate: '' };

  if (userData.lastDate === today) {
    await ctx.sendMessage('group', event.group_id, [
      { type: 'at', data: { qq: String(event.user_id) } },
      { type: 'text', data: { text: ' 你今天已经签到过了！' } },
    ]);
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const isConsecutive = userData.lastDate === yesterdayStr;

  userData.total += 1;
  userData.streak = isConsecutive ? userData.streak + 1 : 1;
  userData.lastDate = today;
  checkinData[groupId][userId] = userData;
  saveCheckinData(ctx.dataDir);

  await ctx.sendMessage('group', event.group_id, [
    { type: 'at', data: { qq: String(event.user_id) } },
    { type: 'text', data: { text: ` 签到成功！\n连续签到: ${userData.streak} 天\n累计签到: ${userData.total} 天` } },
  ]);
}

export async function handleCheckinRank(ctx, event) {
  if (event.message_type !== 'group') {
    await ctx.sendMessage('private', event.user_id, '签到排行仅支持群聊');
    return;
  }
  const groupId = String(event.group_id);
  const groupData = checkinData[groupId];
  if (!groupData || Object.keys(groupData).length === 0) {
    await ctx.sendMessage('group', event.group_id, '本群暂无签到记录');
    return;
  }

  const sorted = Object.entries(groupData)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  const lines = sorted.map(([uid, data], i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} ${uid} — 累计 ${data.total} 天，连续 ${data.streak} 天`;
  });

  await ctx.sendMessage('group', event.group_id, `签到排行榜 Top10\n${lines.join('\n')}`);
}
