import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { replyMsg, isMaster } from './utils.js';

export const TOGGLE_FEATURES = [
  ['enableGroupAdmin', '群管理指令'],
  ['enableWelcome', '入群欢迎'],
  ['enableLeaveNotice', '退群通知'],
  ['enablePokeReply', '戳一戳回应'],
  ['enableAntiRecall', '防撤回'],
  ['enableAdminNotice', '管理员变动通知'],
  ['enableBanNotice', '禁言通知'],
  ['enableFriendWelcome', '新好友欢迎'],
  ['enableFileNotice', '群文件上传通知'],
  ['enableHonorNotice', '荣誉变更通知'],
  ['enableRepeat', '复读检测'],
  ['enableCheckin', '每日签到'],
  ['enableScheduledMsg', '定时消息'],
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const _manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf-8'));
const configDefaults = Object.create(null);
for (const item of _manifest.configSchema || []) {
  if (item.key && item.default !== undefined) configDefaults[item.key] = item.default;
}

export async function handleFeatureList(ctx, event) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  const lines = ['=== 功能开关列表 ==='];
  TOGGLE_FEATURES.forEach(([key, label], i) => {
    const enabled = ctx.getConfig(key) ?? configDefaults[key] ?? false;
    const status = enabled ? '✅' : '❌';
    lines.push(`${status} ${i + 1}. ${label}`);
  });
  lines.push('', '使用 /开启 <序号或功能名> 或 /关闭 <序号或功能名> 切换');
  await replyMsg(ctx, event, lines.join('\n'));
}

function findFeature(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx >= 0 && idx < TOGGLE_FEATURES.length) return TOGGLE_FEATURES[idx];
    return null;
  }
  return TOGGLE_FEATURES.find(([, label]) => label === trimmed) || null;
}

export async function handleFeatureToggle(ctx, event, name, enable) {
  if (!isMaster(ctx, event.user_id)) return replyMsg(ctx, event, '权限不足：仅主人可使用此指令');
  if (!name) return replyMsg(ctx, event, `用法: ${enable ? '/开启' : '/关闭'} <序号或功能名>\n使用 /功能列表 查看所有功能`);
  const feature = findFeature(name);
  if (!feature) return replyMsg(ctx, event, `未找到功能「${name}」\n使用 /功能列表 查看所有功能`);
  const [key, label] = feature;
  const current = ctx.getConfig(key) ?? configDefaults[key] ?? false;
  if (enable && current) return replyMsg(ctx, event, `「${label}」已经是开启状态`);
  if (!enable && !current) return replyMsg(ctx, event, `「${label}」已经是关闭状态`);
  ctx.setConfig(key, enable);
  await replyMsg(ctx, event, `已${enable ? '开启' : '关闭'}「${label}」`);
}

export async function handleMenu(ctx, event) {
  const lines = [
    '=== 示例插件菜单 ===',
    '/ping — 测试 Bot 是否在线',
    '/echo <内容> — 复读消息',
    '/info — 查看 Bot 信息',
    '/time — 当前时间和调用次数',
    '/赞我 — 给你点赞 10 次',
  ];

  const enableCheckin = ctx.getConfig('enableCheckin') ?? false;
  if (enableCheckin) {
    lines.push('/签到 — 每日签到（群聊）');
    lines.push('/签到排行 — 本群签到排行');
  }

  lines.push(
    '',
    '=== 查询 ===',
    '/查群员 @用户/QQ号 — 查看群成员信息',
    '/查用户 <QQ号> — 查看用户信息',
    '/群荣誉 — 查看群荣誉',
    '/群文件 — 查看群文件列表',
    '/群文件信息 — 查看群文件系统信息',
    '/已读 — 标记消息已读',
  );

  if (isMaster(ctx, event.user_id)) {
    lines.push(
      '/群列表 — 查看 Bot 加入的群',
      '/群成员 — 查看本群成员统计',
      '/好友列表 — 查看 Bot 好友列表',
    );

    const enableGroupAdmin = ctx.getConfig('enableGroupAdmin') ?? true;
    if (enableGroupAdmin) {
      lines.push(
        '',
        '=== 群管理 ===',
        '/禁言 @用户/QQ号 [分钟] — 禁言（默认10分钟）',
        '/解禁 @用户/QQ号 — 解除禁言',
        '/踢 @用户/QQ号 — 踢出群聊',
        '/全员禁言 / /解除全员禁言',
        '/群名片 @用户/QQ号 新名片',
        '/群公告 <内容> — 发布群公告',
        '/改群名 <新群名> — 修改群名',
        '/设管理 @用户/QQ号 / /取消管理 @用户/QQ号',
        '/头衔 @用户/QQ号 <头衔> — 设置专属头衔',
        '/退群 [群号] — 退出群聊',
        '/撤回 — 回复消息后撤回',
        '/群历史 [数量] — 查看历史消息',
      );
    }

    lines.push(
      '',
      '=== 功能管理 ===',
      '/功能列表 — 查看功能开关状态',
      '/开启 <功能名> / /关闭 <功能名>',
    );
  }

  await replyMsg(ctx, event, lines.join('\n'));
}
