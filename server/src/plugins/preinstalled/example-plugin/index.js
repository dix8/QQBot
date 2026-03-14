import { setAppContext, clearAppContext, getTarget, getPureText } from './modules/utils.js';
import { handlePing, handleEcho, handleInfo, handleTime, handleLike } from './modules/basic.js';
import { loadCheckinData, handleCheckin, handleCheckinRank } from './modules/checkin.js';
import {
  handleBan, handleUnban, handleKick, handleWholeBan,
  handleSetCard, handleGroupNotice, handleSetGroupName,
  handleSetGroupAdmin, handleSetSpecialTitle, handleLeaveGroup,
  handleDeleteMsg, handleGroupHistory, handleMarkRead,
} from './modules/admin.js';
import {
  handleGroupList, handleGroupMemberList, handleGetMemberInfo,
  handleFriendList, handleStrangerInfo, handleGroupHonor,
  handleGroupFiles, handleGroupFileInfo,
} from './modules/query.js';
import { handleNotice, cacheMessage, clearMessageCache } from './modules/notice.js';
import { handleMenu, handleFeatureList, handleFeatureToggle } from './modules/features.js';
import { CronExpressionParser } from 'cron-parser';

let appCtx = null;            // PluginAppContext (no Bot binding)

const repeatTracker = new Map();

// ── 定时任务精确调度 ──
const scheduledTimers = new Map();   // Map<key, cancelFn>
let configWatchTimer = 0;
let lastScheduleSnapshot = '';
let scheduleRevision = 0;            // 调度代际，每次 rebuild/unload 自增
const MAX_TIMEOUT_DELAY = 2147483647; // ~24.8 天

/** 解析任务中的群列表，支持 "all" → 获取所有启用群 */
async function resolveGroupIds(ctx, rawGroupIds) {
  if (!rawGroupIds.includes('all')) {
    return rawGroupIds.filter(id => typeof id === 'number');
  }
  try {
    const rawGroups = await ctx.callApi('get_group_list');
    if (!Array.isArray(rawGroups)) return [];
    const basic = ctx.getBotConfig('basic');
    const mode = basic?.groupFilterMode ?? 'none';
    const filterList = basic?.groupFilterList ?? [];
    return rawGroups
      .map(g => Number(g.group_id))
      .filter(gid => {
        if (mode === 'whitelist') return filterList.includes(gid);
        if (mode === 'blacklist') return !filterList.includes(gid);
        return true;
      });
  } catch (err) {
    appCtx?.logger.warn(`获取群列表失败: ${err.message || err}`);
    return [];
  }
}

/** 从任务中获取消息文本（支持 messages 数组随机选取） */
function pickTaskMessage(task) {
  if (Array.isArray(task.messages) && task.messages.length > 0) {
    return task.messages[Math.floor(Math.random() * task.messages.length)];
  }
  return task.message || null;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function renderTemplate(msg) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const pad = (n) => String(n).padStart(2, '0');
  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  const Y = now.getFullYear();
  const M = pad(now.getMonth() + 1);
  const D = pad(now.getDate());
  return msg
    .replace(/\{time}/g, `${h}:${m}`)
    .replace(/\{hour}/g, h)
    .replace(/\{minute}/g, m)
    .replace(/\{date}/g, `${Y}-${M}-${D}`)
    .replace(/\{datetime}/g, `${Y}-${M}-${D} ${h}:${m}`)
    .replace(/\{weekday}/g, WEEKDAY_NAMES[now.getDay()]);
}

/** 计算任务的下一次触发时间，非法任务直接抛错 */
function getNextRun(task) {
  if (task.type === 'cron') {
    if (typeof task.cron !== 'string' || !task.cron.trim()) {
      throw new Error('cron 表达式为空');
    }
    const expr = CronExpressionParser.parse(task.cron, {
      tz: 'Asia/Shanghai',
      currentDate: new Date(),
    });
    return expr.next().toDate();
  }
  if (typeof task.hour !== 'number' || typeof task.minute !== 'number') {
    throw new Error(`hour/minute 缺失或类型错误 (hour=${task.hour}, minute=${task.minute})`);
  }
  if (task.hour < 0 || task.hour > 23 || task.minute < 0 || task.minute > 59) {
    throw new Error(`hour/minute 范围非法 (hour=${task.hour}, minute=${task.minute})`);
  }
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const target = new Date(now);
  target.setHours(task.hour, task.minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  const offset = target.getTime() - now.getTime();
  return new Date(Date.now() + offset);
}

/**
 * 安全 setTimeout，支持超长延时分段等待。
 * 使用 appContext 的 managed timers。
 * 返回 cancel() 函数；cancel 后任何后续分段和 onFire 都不会执行。
 */
function armAt(app, targetTime, onFire) {
  let cancelled = false;
  let currentTimerId = null;

  function step() {
    if (cancelled) return;
    const delay = targetTime.getTime() - Date.now();
    if (delay <= 0) {
      currentTimerId = app.setTimeout(() => {
        if (!cancelled) onFire();
      }, 0);
      return;
    }
    const wait = Math.min(delay, MAX_TIMEOUT_DELAY);
    currentTimerId = app.setTimeout(() => {
      if (!cancelled) step();
    }, wait);
  }

  step();

  return function cancel() {
    cancelled = true;
    if (currentTimerId !== null) {
      app.clearTimeout(currentTimerId);
      currentTimerId = null;
    }
  };
}

/** 清理所有已挂起的任务定时器 */
function clearScheduledTimers() {
  for (const cancelFn of scheduledTimers.values()) {
    cancelFn();
  }
  scheduledTimers.clear();
}

/**
 * 根据任务配置确定性地解析 Bot 连接上下文。
 * - 若任务配置了 self_id → 按 QQ 号查找对应连接
 * - 若未配置 self_id → 仅当恰好有唯一连接时自动使用
 */
function resolveTaskContext(app, task) {
  if (task.self_id) {
    return app.forBot(task.self_id);
  }
  const bots = app.getConnectedBots();
  if (bots.length === 0) {
    throw new Error('当前无可用 Bot 连接');
  }
  if (bots.length > 1) {
    const ids = bots.map(b => b.selfId).join(', ');
    throw new Error(`当前有 ${bots.length} 个 Bot 连接 (${ids})，请在任务配置中指定 self_id`);
  }
  return app.forConnection(bots[0].connectionId);
}

/** 为单条任务创建调度 */
function scheduleTask(app, key, task, rev) {
  const nextRun = getNextRun(task);

  const cancelFn = armAt(app, nextRun, async () => {
    // revision 已失效，旧回调直接退出
    if (rev !== scheduleRevision) return;

    const label = task.type === 'cron' ? `Cron (${task.cron})` : `定时 (${task.hour}:${task.minute})`;

    let ctx;
    try {
      ctx = resolveTaskContext(app, task);
    } catch (err) {
      app.logger.warn(`[任务 ${key}] ${label} ${err.message || err}，跳过本次执行`);
      if (rev === scheduleRevision) {
        try { scheduleTask(app, key, task, rev); } catch (e) {
          app.logger.warn(`[任务 ${key}] 重新调度失败: ${e.message || e}`);
        }
      }
      return;
    }

    try {
      const msgText = pickTaskMessage(task);
      if (!msgText) {
        app.logger.warn(`[任务 ${key}] ${label} 消息内容为空，跳过`);
      } else {
        const msg = renderTemplate(msgText);
        const rawGroupIds = Array.isArray(task.group_ids) ? task.group_ids : task.group_id ? [task.group_id] : [];
        const groupIds = await resolveGroupIds(ctx, rawGroupIds);

        if (rev !== scheduleRevision) return;

        if (groupIds.length === 0) {
          app.logger.warn(`[任务 ${key}] ${label} 目标群列表为空，跳过发送`);
        } else {
          const results = await Promise.allSettled(
            groupIds.map(gid => ctx.sendMessage('group', gid, msg))
          );
          const ok = results.filter(r => r.status === 'fulfilled').length;
          const fail = results.length - ok;
          if (fail > 0) {
            app.logger.warn(`[任务 ${key}] ${label} 发送到 ${ok} 个群成功, ${fail} 个失败`);
          } else {
            app.logger.info(`[任务 ${key}] ${label} 已发送到 ${ok} 个群`);
          }
        }
      }
    } catch (err) {
      app.logger.warn(`[任务 ${key}] ${label} 执行失败: ${err.message || err}`);
    }

    // 只有 revision 仍然有效才重新调度下一次
    if (rev !== scheduleRevision) return;
    try {
      scheduleTask(app, key, task, rev);
    } catch (err) {
      app.logger.warn(`[任务 ${key}] 重新调度失败: ${err.message || err}`);
    }
  });

  scheduledTimers.set(key, cancelFn);
}

/** 读取调度相关配置的快照（用于变更检测） */
function readScheduleSnapshot(app) {
  return JSON.stringify({
    enabled: app.getConfig('enableScheduledMsg') ?? false,
    tasks: app.getConfig('scheduledMessages') ?? '[]',
  });
}

/** 重建全部任务调度 */
function rebuildSchedule(app) {
  scheduleRevision += 1;
  const rev = scheduleRevision;
  clearScheduledTimers();

  const enabled = app.getConfig('enableScheduledMsg') ?? false;
  if (!enabled) {
    app.logger.debug('定时消息已关闭，清除全部调度');
    return;
  }

  let tasks;
  try {
    const raw = app.getConfig('scheduledMessages') ?? '[]';
    tasks = JSON.parse(raw);
  } catch (err) {
    app.logger.warn(`定时消息配置 JSON 解析失败: ${err.message || err}`);
    return;
  }
  if (!Array.isArray(tasks)) {
    app.logger.warn(`定时消息配置不是数组，跳过调度`);
    return;
  }

  let scheduled = 0;
  let skipped = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const rawGroupIds = Array.isArray(task.group_ids) ? task.group_ids : task.group_id ? [task.group_id] : [];
    if (rawGroupIds.length === 0) {
      app.logger.debug(`[任务 ${i}] 无目标群，跳过`);
      skipped++;
      continue;
    }
    try {
      scheduleTask(app, String(i), task, rev);
      scheduled++;
    } catch (err) {
      app.logger.warn(`[任务 ${i}] 调度失败: ${err.message || err}`);
      skipped++;
    }
  }
  app.logger.info(`定时任务调度完成: ${scheduled} 条生效, ${skipped} 条跳过 (revision=${rev})`);
}

export default {
  async onLoad(app) {
    appCtx = app;
    setAppContext(app);
    app.logger.info('示例插件已加载');

    loadCheckinData(app.dataDir);
    app.logger.info('签到数据已加载');

    app.setInterval(() => {
      app.logger.debug('示例插件心跳');
    }, 60000);

    // 精确调度定时任务
    rebuildSchedule(app);

    // 配置变更观察器：检测到配置变化时重建调度
    lastScheduleSnapshot = readScheduleSnapshot(app);
    configWatchTimer = app.setInterval(() => {
      const snapshot = readScheduleSnapshot(app);
      if (snapshot !== lastScheduleSnapshot) {
        lastScheduleSnapshot = snapshot;
        app.logger.info('定时任务配置变更，重建调度');
        rebuildSchedule(app);
      }
    }, 5000);
  },

  async onUnload() {
    // 先让旧 revision 失效，确保所有挂起回调不再执行
    scheduleRevision += 1;
    if (appCtx) {
      clearScheduledTimers();
      if (configWatchTimer) appCtx.clearInterval(configWatchTimer);
      configWatchTimer = 0;
      lastScheduleSnapshot = '';
      appCtx.logger.info('示例插件已卸载');
    }
    repeatTracker.clear();
    clearMessageCache();
    appCtx = null;
    clearAppContext();
  },

  async onMessage(event, ctx) {
    cacheMessage(event);

    const text = event.raw_message?.trim();
    if (!text) return;

    // 基础指令
    if (text === '/ping') return handlePing(ctx, event);
    if (text === '/菜单' || text === '/menu') return handleMenu(ctx, event);
    if (text.startsWith('/echo ')) return handleEcho(ctx, event, text.slice(6));
    if (text === '/echo') return ctx.sendMessage(event.message_type, getTarget(event), '用法: /echo <内容>');
    if (text === '/info') return handleInfo(ctx, event);
    if (text === '/time') return handleTime(ctx, event);
    if (text === '/赞我' || text === '/赞' || text === '/点赞') return handleLike(ctx, event);

    // 签到
    if (text === '/签到') {
      if (ctx.getConfig('enableCheckin') ?? false) await handleCheckin(ctx, event);
      return;
    }
    if (text === '/签到排行') {
      if (ctx.getConfig('enableCheckin') ?? false) await handleCheckinRank(ctx, event);
      return;
    }

    // 功能管理
    if (text === '/功能列表') return handleFeatureList(ctx, event);
    if (text.startsWith('/开启 ')) return handleFeatureToggle(ctx, event, text.slice(4), true);
    if (text.startsWith('/关闭 ')) return handleFeatureToggle(ctx, event, text.slice(4), false);

    // 信息查询
    if (text === '/查群员' || text.startsWith('/查群员 ')) {
      const args = text.slice(4).trim().split(/\s+/).filter(Boolean);
      return handleGetMemberInfo(ctx, event, args);
    }
    if (text.startsWith('/查用户 ')) return handleStrangerInfo(ctx, event, text.slice(4).trim());
    if (text === '/查用户') return ctx.sendMessage(event.message_type, getTarget(event), '用法: /查用户 <QQ号>');
    if (text === '/群荣誉') return handleGroupHonor(ctx, event);
    if (text === '/群文件信息') return handleGroupFileInfo(ctx, event);
    if (text === '/群文件') return handleGroupFiles(ctx, event);
    if (text === '/已读') return handleMarkRead(ctx, event);
    if (text === '/群列表') return handleGroupList(ctx, event);
    if (text === '/群成员') return handleGroupMemberList(ctx, event);
    if (text === '/好友列表') return handleFriendList(ctx, event);
    if (text === '/群历史' || text.startsWith('/群历史 ')) return handleGroupHistory(ctx, event, text.slice(4).trim());

    // 撤回（需要从纯文本匹配，因为回复消息时 raw_message 包含 CQ 码）
    if (getPureText(event) === '/撤回') await handleDeleteMsg(ctx, event);

    // 群管理指令
    const enableGroupAdmin = ctx.getConfig('enableGroupAdmin') ?? true;
    if (enableGroupAdmin) {
      const [cmd, ...args] = text.split(/\s+/);
      const argStr = args.join(' ').trim();
      switch (cmd) {
        case '/禁言': await handleBan(ctx, event, args); break;
        case '/解禁': await handleUnban(ctx, event, args); break;
        case '/踢': await handleKick(ctx, event, args); break;
        case '/全员禁言': await handleWholeBan(ctx, event, true); break;
        case '/解除全员禁言': await handleWholeBan(ctx, event, false); break;
        case '/群名片': await handleSetCard(ctx, event, args, argStr); break;
        case '/群公告': await handleGroupNotice(ctx, event, argStr); break;
        case '/改群名': await handleSetGroupName(ctx, event, argStr); break;
        case '/设管理': await handleSetGroupAdmin(ctx, event, true, args); break;
        case '/取消管理': await handleSetGroupAdmin(ctx, event, false, args); break;
        case '/头衔': await handleSetSpecialTitle(ctx, event, args, argStr); break;
        case '/退群': await handleLeaveGroup(ctx, event, argStr); break;
      }
    }

    // 复读检测 — 仅群聊
    if (event.message_type === 'group' && text) {
      const enableRepeat = ctx.getConfig('enableRepeat') ?? false;
      if (enableRepeat) {
        const groupId = event.group_id;
        const prev = repeatTracker.get(groupId);
        if (prev && prev.text === text) {
          prev.count += 1;
          const threshold = ctx.getConfig('repeatThreshold') ?? 3;
          if (prev.count >= threshold && !prev.replied) {
            prev.replied = true;
            await ctx.sendMessage('group', groupId, text);
          }
        } else {
          repeatTracker.set(groupId, { text, count: 1, replied: false });
        }
      }
    }
  },

  async onNotice(event, ctx) {
    await handleNotice(ctx, event);
  },
};
