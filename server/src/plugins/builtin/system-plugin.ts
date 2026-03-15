import type { PluginInterface, PluginCommand, PluginEventContext } from '../../types/plugin.js';
import type { MessageEvent } from '../../types/onebot.js';
import type { OneBotClient } from '../../ws/onebot-client.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import type { ConfigService } from '../../services/config.js';
import type { PluginManager } from '../plugin-manager.js';
import type { BasicConfig, RuntimeConfig } from '../../types/config.js';
import { DEFAULT_CONFIG } from '../../types/config.js';
import { promanService } from '../../services/proman.js';
import os from 'node:os';

export interface SystemPluginDependencies {
  oneBotClient: OneBotClient;
  connectionManager: ConnectionManager;
  configService: ConfigService;
  pluginManager: PluginManager;
  botIdResolver: (connectionId: string) => number | undefined;
  appVersion: string;
}

export class SystemPlugin implements PluginInterface {
  private oneBotClient!: OneBotClient;
  private connectionManager!: ConnectionManager;
  private configService!: ConfigService;
  private pluginManager!: PluginManager;
  private botIdResolver!: (connectionId: string) => number | undefined;
  private appVersion!: string;
  private startTime = Date.now();

  setDependencies(deps: SystemPluginDependencies): void {
    this.oneBotClient = deps.oneBotClient;
    this.connectionManager = deps.connectionManager;
    this.configService = deps.configService;
    this.pluginManager = deps.pluginManager;
    this.botIdResolver = deps.botIdResolver;
    this.appVersion = deps.appVersion;
  }

  getCommands(): PluginCommand[] {
    return [
      { command: '/帮助', description: '显示可用指令列表', permission: 'all', aliases: ['/help'] },
      { command: '/状态', description: '查看系统运行状态', permission: 'all', aliases: ['/status'] },
      { command: '/关于', description: '查看当前 Bot 信息', permission: 'all', aliases: ['/about'] },
      { command: '/检测更新', description: '检测系统是否有新版本', permission: 'master', aliases: ['/checkupdate'] },
      { command: '/昵称', description: '查看/设置 Bot 昵称', usage: '/昵称 [新昵称]', permission: 'master' },
      { command: '/主人列表', description: '列出所有主人 QQ', permission: 'master' },
      { command: '/添加主人', description: '添加主人', usage: '/添加主人 @用户/QQ号', permission: 'super_admin' },
      { command: '/删除主人', description: '删除主人', usage: '/删除主人 @用户/QQ号', permission: 'super_admin' },
      { command: '/超管列表', description: '列出所有超级管理员 QQ', permission: 'super_admin' },
      { command: '/插件列表', description: '查看已安装插件', permission: 'super_admin' },
      { command: '/启用插件', description: '启用指定插件', usage: '/启用插件 <序号或插件ID>', permission: 'super_admin' },
      { command: '/禁用插件', description: '禁用指定插件', usage: '/禁用插件 <序号或插件ID>', permission: 'super_admin' },
      { command: '/配置', description: '查看当前 Bot 配置总览', permission: 'master' },
      { command: '/自动回复', description: '开关自动回复', usage: '/自动回复 [开/关]', permission: 'master' },
      { command: '/自动加好友', description: '开关自动同意好友请求', usage: '/自动加好友 [开/关]', permission: 'master' },
      { command: '/自动加群', description: '开关自动同意加群邀请', usage: '/自动加群 [开/关]', permission: 'master' },
      { command: '/自身指令', description: '开关 Bot 响应自己发的指令', usage: '/自身指令 [开/关]', permission: 'master' },
      { command: '/消息范围', description: '设置消息处理范围', usage: '/消息范围 [私聊/群聊/全部]', permission: 'master' },
      { command: '/黑名单', description: '查看用户黑名单', permission: 'master' },
      { command: '/拉黑', description: '添加用户到黑名单', usage: '/拉黑 @用户/QQ号', permission: 'master' },
      { command: '/解黑', description: '从黑名单移除用户', usage: '/解黑 @用户/QQ号', permission: 'master' },
      { command: '/群开关', description: '启用/禁用群指令响应', usage: '/群开关 [群号] [开/关]', permission: 'master' },
      { command: '/群过滤', description: '设置群过滤模式', usage: '/群过滤 [关闭/白名单/黑名单]', permission: 'master' },
      { command: '/群过滤列表', description: '查看群过滤列表', permission: 'master' },
      { command: '/添加过滤群', description: '添加群到过滤列表', usage: '/添加过滤群 <群号>', permission: 'master' },
      { command: '/删除过滤群', description: '从过滤列表移除群', usage: '/删除过滤群 <群号>', permission: 'master' },
      { command: '/在线时段', description: '设置在线时段', usage: '/在线时段 [开/关/起始时-结束时]', permission: 'master' },
      { command: '/频率限制', description: '设置消息频率限制', usage: '/频率限制 [开/关/条数 秒数]', permission: 'master' },
      { command: '/重试', description: '开关消息重试', usage: '/重试 [开/关]', permission: 'master' },
    ];
  }

  async onMessage(event: MessageEvent, ctx: PluginEventContext): Promise<void> {
    const connectionId = ctx.connectionId;
    const raw = event.raw_message?.trim();
    if (!raw || !raw.startsWith('/')) return;

    const botId = this.botIdResolver(connectionId);
    if (botId === undefined) return;

    const [cmd, ...args] = raw.split(/\s+/);
    const argStr = args.join(' ').trim();

    switch (cmd) {
      // 公共指令
      case '/帮助': case '/help':
        return this.cmdHelp(event, connectionId, botId);
      case '/状态': case '/status':
        return this.cmdStatus(event, connectionId);
      case '/关于': case '/about':
        return this.cmdAbout(event, connectionId, botId);
      case '/检测更新': case '/checkupdate':
        return this.cmdCheckUpdate(event, connectionId, botId);
      // 主人指令 — 原有
      case '/昵称':
        return this.cmdNickname(event, connectionId, botId, argStr);
      case '/主人列表':
        return this.cmdMasterList(event, connectionId, botId);
      // 超管指令
      case '/添加主人':
        return this.cmdMasterAdd(event, connectionId, botId, argStr);
      case '/删除主人':
        return this.cmdMasterRemove(event, connectionId, botId, argStr);
      case '/超管列表':
        return this.cmdSuperAdminList(event, connectionId, botId);
      case '/插件列表':
        return this.cmdPluginList(event, connectionId, botId);
      case '/启用插件':
        return this.cmdPluginToggle(event, connectionId, botId, argStr, true);
      case '/禁用插件':
        return this.cmdPluginToggle(event, connectionId, botId, argStr, false);
      // 主人指令 — 配置管理
      case '/配置':
        return this.cmdConfigOverview(event, connectionId, botId);
      case '/自动回复':
        return this.cmdToggleBasic(event, connectionId, botId, argStr, 'autoReply', '自动回复');
      case '/自动加好友':
        return this.cmdToggleBasic(event, connectionId, botId, argStr, 'autoApproveFriend', '自动加好友');
      case '/自动加群':
        return this.cmdToggleBasic(event, connectionId, botId, argStr, 'autoApproveGroup', '自动加群');
      case '/自身指令':
        return this.cmdToggleBasic(event, connectionId, botId, argStr, 'selfCommandEnabled', '自身指令');
      case '/消息范围':
        return this.cmdMessageScope(event, connectionId, botId, argStr);
      case '/黑名单':
        return this.cmdBlacklist(event, connectionId, botId);
      case '/拉黑':
        return this.cmdBlacklistAdd(event, connectionId, botId, argStr);
      case '/解黑':
        return this.cmdBlacklistRemove(event, connectionId, botId, argStr);
      case '/群开关':
        return this.cmdGroupToggle(event, connectionId, botId, argStr);
      case '/群过滤':
        return this.cmdGroupFilter(event, connectionId, botId, argStr);
      case '/群过滤列表':
        return this.cmdGroupFilterList(event, connectionId, botId);
      case '/添加过滤群':
        return this.cmdGroupFilterAdd(event, connectionId, botId, argStr);
      case '/删除过滤群':
        return this.cmdGroupFilterRemove(event, connectionId, botId, argStr);
      case '/在线时段':
        return this.cmdOnlineTime(event, connectionId, botId, argStr);
      case '/频率限制':
        return this.cmdRateLimit(event, connectionId, botId, argStr, args);
      case '/重试':
        return this.cmdRetry(event, connectionId, botId, argStr);
    }
  }

  // ==================== Helper ====================

  private async reply(event: MessageEvent, connectionId: string, text: string): Promise<void> {
    if (event.message_type === 'private') {
      await this.oneBotClient.sendPrivateMsg(connectionId, event.user_id, text);
    } else if (event.message_type === 'group') {
      await this.oneBotClient.sendGroupMsg(connectionId, (event as { group_id: number }).group_id, text);
    }
  }

  private isMaster(botId: number, userId: number): boolean {
    return this.configService.getMasterQQ(botId).includes(userId);
  }

  private isSuperAdmin(userId: number): boolean {
    return this.configService.getSuperAdminQQ().includes(userId);
  }

  private hasPermission(botId: number, userId: number, level: 'all' | 'master' | 'super_admin'): boolean {
    if (level === 'all') return true;
    if (level === 'master') return this.isSuperAdmin(userId) || this.isMaster(botId, userId);
    if (level === 'super_admin') return this.isSuperAdmin(userId);
    return false;
  }

  private requireMaster(event: MessageEvent, connectionId: string, botId: number): boolean {
    if (this.hasPermission(botId, event.user_id, 'master')) return true;
    this.reply(event, connectionId, '权限不足：仅主人可使用此指令');
    return false;
  }

  /** Extract target QQ from @mention or numeric argument */
  private resolveQQ(event: MessageEvent, argStr: string): number | null {
    const msg = event.message;
    if (Array.isArray(msg)) {
      const atSeg = msg.find((s) => s.type === 'at' && 'qq' in s.data && s.data.qq !== 'all');
      if (atSeg && 'qq' in atSeg.data) {
        const qq = parseInt(String(atSeg.data.qq), 10);
        if (!isNaN(qq)) return qq;
      }
    }
    if (/^\d{5,11}$/.test(argStr)) return parseInt(argStr, 10);
    return null;
  }

  private getBasic(botId: number): BasicConfig {
    return this.configService.get<BasicConfig>(botId, 'basic') ?? DEFAULT_CONFIG.basic;
  }

  private setBasic(botId: number, basic: BasicConfig): void {
    this.configService.set(botId, 'basic', basic);
  }

  private getRuntime(botId: number): RuntimeConfig {
    return this.configService.get<RuntimeConfig>(botId, 'runtime') ?? DEFAULT_CONFIG.runtime;
  }

  private setRuntime(botId: number, runtime: RuntimeConfig): void {
    this.configService.set(botId, 'runtime', runtime);
  }

  private static parseOnOff(s: string): boolean | null {
    if (s === '开' || s === 'on' || s === '1' || s === 'true') return true;
    if (s === '关' || s === 'off' || s === '0' || s === 'false') return false;
    return null;
  }

  private static onOff(v: boolean): string {
    return v ? '✅ 开启' : '❌ 关闭';
  }

  // ==================== Public Commands ====================

  private async cmdHelp(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    const userId = event.user_id;
    const isMasterUser = this.hasPermission(botId, userId, 'master');
    const isSuperAdminUser = this.hasPermission(botId, userId, 'super_admin');

    const lines = [
      '=== 基础指令 ===',
      '/帮助 — 显示可用指令列表',
      '/状态 — 查看系统运行状态',
      '/关于 — 查看当前 Bot 信息',
      '/检测更新 — 检测系统新版本',
    ];

    if (isMasterUser) {
      lines.push(
        '',
        '=== 主人指令 ===',
        '/昵称 [新昵称] — 查看/设置 Bot 昵称',
        '/主人列表 — 列出所有主人 QQ',
        '',
        '=== 配置管理 ===',
        '/配置 — 查看配置总览',
        '/自动回复 [开/关]',
        '/自动加好友 [开/关]',
        '/自动加群 [开/关]',
        '/自身指令 [开/关]',
        '/消息范围 [私聊/群聊/全部]',
        '/黑名单 — 查看黑名单',
        '/拉黑 @用户/QQ号 | /解黑 @用户/QQ号',
        '/群开关 [群号] [开/关] — 启用/禁用群指令',
        '/群过滤 [关闭/白名单/黑名单]',
        '/群过滤列表 — 查看过滤群列表',
        '/添加过滤群 <群号> | /删除过滤群 <群号>',
        '/在线时段 [开/关/起始-结束]',
        '/频率限制 [开/关/条数 秒数]',
        '/重试 [开/关]',
      );
    }

    if (isSuperAdminUser) {
      lines.push(
        '',
        '=== 超管指令 ===',
        '/超管列表 — 列出所有超级管理员',
        '/添加主人 @用户/QQ号 — 添加主人',
        '/删除主人 @用户/QQ号 — 删除主人',
        '/插件列表 — 查看已安装插件',
        '/启用插件 / /禁用插件 <序号或ID>',
      );
    }

    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdStatus(event: MessageEvent, connectionId: string): Promise<void> {
    const uptimeMs = Date.now() - this.startTime;
    const uptime = this.formatUptime(uptimeMs);

    const mem = process.memoryUsage();
    const rss = this.formatBytes(mem.rss);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      const { user, nice, sys, idle, irq } = cpu.times;
      totalTick += user + nice + sys + idle + irq;
      totalIdle += idle;
    }
    const cpuUsage = cpus.length > 0 ? ((1 - totalIdle / totalTick) * 100).toFixed(1) : '0';
    const cpuModel = cpus.length > 0 ? cpus[0]!.model.trim() : '未知';

    const connections = this.connectionManager.getAllConnections();
    const authenticated = connections.filter((c) => c.state === 'authenticated').length;

    const lines = [
      '=== 系统状态 ===',
      `运行时长: ${uptime}`,
      '',
      `CPU: ${cpuModel}`,
      `CPU 核心: ${cpus.length} 核`,
      `CPU 负载: ${cpuUsage}%`,
      '',
      `系统内存: ${this.formatBytes(usedMem)} / ${this.formatBytes(totalMem)} (${memPercent}%)`,
      `进程内存: ${rss}`,
      '',
      `连接数: ${authenticated}/${connections.length} 在线`,
      `系统: ${this.platformLabel()} | Node ${process.version}`,
    ];

    await this.reply(event, connectionId, lines.join('\n'));
  }

  private platformLabel(): string {
    const map: Record<string, string> = {
      win32: 'Windows',
      linux: 'Linux',
      darwin: 'macOS',
      freebsd: 'FreeBSD',
    };
    return map[os.platform()] || os.platform();
  }

  private async cmdAbout(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    const conn = this.connectionManager.getConnection(connectionId);
    const basic = this.configService.get<BasicConfig>(botId, 'basic');

    const lines = ['=== Bot 信息 ===', `QQBot 版本: v${this.appVersion}`];

    if (conn?.botInfo) {
      lines.push(`QQ: ${conn.botInfo.user_id}`);
      lines.push(`昵称: ${conn.botInfo.nickname}`);
    }

    if (basic?.nickname) {
      lines.push(`备注昵称: ${basic.nickname}`);
    }

    if (conn?.connectedAt) {
      lines.push(`连接时间: ${conn.connectedAt.toLocaleString()}`);
    }

    await this.reply(event, connectionId, lines.join('\n'));
  }

  // ==================== Master Commands — Original ====================

  private async cmdNickname(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const basic = this.getBasic(botId);

    if (!argStr) {
      await this.reply(event, connectionId, `当前昵称: ${basic.nickname ?? 'QQBot'}`);
      return;
    }

    this.setBasic(botId, { ...basic, nickname: argStr });
    await this.reply(event, connectionId, `昵称已更新为: ${argStr}`);
  }

  private async cmdMasterList(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;

    const masters = this.configService.getMasterQQ(botId);
    if (masters.length === 0) {
      await this.reply(event, connectionId, '当前没有设置主人 QQ');
      return;
    }

    const lines = ['=== 主人列表 ===', ...masters.map((qq, i) => `${i + 1}. ${qq}`)];
    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdSuperAdminList(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    const superAdmins = this.configService.getSuperAdminQQ();
    if (superAdmins.length === 0) {
      await this.reply(event, connectionId, '当前没有设置超级管理员');
      return;
    }

    const lines = ['=== 超级管理员列表 ===', ...superAdmins.map((qq, i) => `${i + 1}. ${qq}`), '', '超管增删请前往 Web 管理页面操作'];
    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdMasterAdd(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    const qq = this.resolveQQ(event, argStr);
    if (!qq) {
      await this.reply(event, connectionId, '请 @ 或输入 QQ 号，例如: /添加主人 @用户 或 /添加主人 123456');
      return;
    }

    const basic = this.getBasic(botId);
    if (basic.masterQQ.includes(qq)) {
      await this.reply(event, connectionId, `QQ ${qq} 已经是主人了`);
      return;
    }

    this.setBasic(botId, { ...basic, masterQQ: [...basic.masterQQ, qq] });
    await this.reply(event, connectionId, `已添加主人: ${qq}`);
  }

  private async cmdMasterRemove(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    const qq = this.resolveQQ(event, argStr);
    if (!qq) {
      await this.reply(event, connectionId, '请 @ 或输入 QQ 号，例如: /删除主人 @用户 或 /删除主人 123456');
      return;
    }

    const basic = this.getBasic(botId);
    if (!basic.masterQQ.includes(qq)) {
      await this.reply(event, connectionId, `QQ ${qq} 不在主人列表中`);
      return;
    }

    this.setBasic(botId, { ...basic, masterQQ: basic.masterQQ.filter((m) => m !== qq) });
    await this.reply(event, connectionId, `已删除主人: ${qq}`);
  }

  // ==================== Plugin Management ====================

  private getUserPlugins() {
    return this.pluginManager.getAllPlugins().filter((p) => !p.builtin);
  }

  private async cmdPluginList(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    const plugins = this.getUserPlugins();
    if (plugins.length === 0) {
      await this.reply(event, connectionId, '当前没有已安装的插件');
      return;
    }

    const lines = ['=== 插件列表 ==='];
    plugins.forEach((p, i) => {
      const status = p.loaded ? '✅运行中' : p.enabled ? '🟡已启用' : '⬚已禁用';
      lines.push(`${i + 1}. [${status}] ${p.name} v${p.version}`);
      lines.push(`   ID: ${p.id}`);
      if (p.description) lines.push(`   描述: ${p.description}`);
    });
    lines.push('', '使用 /启用插件 或 /禁用插件 + 序号或插件ID');
    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdPluginToggle(event: MessageEvent, connectionId: string, botId: number, argStr: string, enable: boolean): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    if (!argStr) {
      await this.reply(event, connectionId, `请输入序号或插件ID，例如: ${enable ? '/启用插件 1' : '/禁用插件 1'}\n使用 /插件列表 查看所有插件`);
      return;
    }

    const plugins = this.getUserPlugins();
    const index = /^\d+$/.test(argStr) ? parseInt(argStr, 10) : NaN;
    const target = !isNaN(index) && index >= 1 && index <= plugins.length
      ? plugins[index - 1]
      : plugins.find((p) => p.id === argStr);

    if (!target) {
      await this.reply(event, connectionId, `未找到插件: ${argStr}\n使用 /插件列表 查看所有插件`);
      return;
    }

    if (enable && target.enabled) {
      await this.reply(event, connectionId, `插件 ${target.name} 已经是启用状态`);
      return;
    }
    if (!enable && !target.enabled) {
      await this.reply(event, connectionId, `插件 ${target.name} 已经是禁用状态`);
      return;
    }

    try {
      if (enable) {
        await this.pluginManager.enablePlugin(target.id);
        await this.reply(event, connectionId, `已启用插件: ${target.name}`);
      } else {
        await this.pluginManager.disablePlugin(target.id);
        await this.reply(event, connectionId, `已禁用插件: ${target.name}`);
      }
    } catch (err) {
      await this.reply(event, connectionId, `操作失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ==================== Config Overview ====================

  private async cmdConfigOverview(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const b = this.getBasic(botId);
    const r = this.getRuntime(botId);
    const scopeMap: Record<string, string> = { private: '仅私聊', group: '仅群聊', both: '全部' };
    const filterMap: Record<string, string> = { none: '关闭', whitelist: '白名单', blacklist: '黑名单' };

    const lines = [
      '=== Bot 配置总览 ===',
      '',
      '— 基础配置 —',
      `昵称: ${b.nickname}`,
      `自动回复: ${SystemPlugin.onOff(b.autoReply)}`,
      `自动加好友: ${SystemPlugin.onOff(b.autoApproveFriend)}`,
      `自动加群: ${SystemPlugin.onOff(b.autoApproveGroup)}`,
      `消息范围: ${scopeMap[b.messageScope] ?? b.messageScope}`,
      `自身指令: ${SystemPlugin.onOff(b.selfCommandEnabled)}`,
      `黑名单: ${b.blacklistUsers.length} 人`,
      `群过滤: ${filterMap[b.groupFilterMode] ?? b.groupFilterMode} (${b.groupFilterList.length} 个群)`,
      '',
      '— 运行时配置 —',
      `在线时段: ${SystemPlugin.onOff(r.onlineTime.enabled)}${r.onlineTime.enabled ? ` (${r.onlineTime.startHour}:00 - ${r.onlineTime.endHour}:00)` : ''}`,
      `频率限制: ${SystemPlugin.onOff(r.rateLimit.enabled)}${r.rateLimit.enabled ? ` (${r.rateLimit.maxMessages}条/${r.rateLimit.windowSeconds}秒)` : ''}`,
      `消息重试: ${SystemPlugin.onOff(r.retry.enabled)}${r.retry.enabled ? ` (最多${r.retry.maxRetries}次)` : ''}`,
    ];

    await this.reply(event, connectionId, lines.join('\n'));
  }

  // ==================== Toggle Commands ====================

  private async cmdToggleBasic(
    event: MessageEvent, connectionId: string, botId: number,
    argStr: string, field: keyof BasicConfig, label: string,
  ): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const basic = this.getBasic(botId);

    if (!argStr) {
      await this.reply(event, connectionId, `${label}: ${SystemPlugin.onOff(basic[field] as boolean)}\n用法: /${label} 开/关`);
      return;
    }

    const val = SystemPlugin.parseOnOff(argStr);
    if (val === null) {
      await this.reply(event, connectionId, `无效参数，请输入 开 或 关`);
      return;
    }

    this.setBasic(botId, { ...basic, [field]: val });
    await this.reply(event, connectionId, `${label}已${val ? '开启' : '关闭'}`);
  }

  // ==================== Message Scope ====================

  private async cmdMessageScope(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const basic = this.getBasic(botId);
    const scopeMap: Record<string, string> = { private: '仅私聊', group: '仅群聊', both: '全部' };

    if (!argStr) {
      await this.reply(event, connectionId, `消息范围: ${scopeMap[basic.messageScope] ?? basic.messageScope}\n用法: /消息范围 私聊/群聊/全部`);
      return;
    }

    const inputMap: Record<string, 'private' | 'group' | 'both'> = {
      '私聊': 'private', 'private': 'private',
      '群聊': 'group', 'group': 'group',
      '全部': 'both', 'both': 'both', '所有': 'both',
    };
    const scope = inputMap[argStr];
    if (!scope) {
      await this.reply(event, connectionId, '无效参数，请输入: 私聊 / 群聊 / 全部');
      return;
    }

    this.setBasic(botId, { ...basic, messageScope: scope });
    await this.reply(event, connectionId, `消息范围已设为: ${scopeMap[scope]}`);
  }

  // ==================== Blacklist ====================

  private async cmdBlacklist(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const basic = this.getBasic(botId);

    if (basic.blacklistUsers.length === 0) {
      await this.reply(event, connectionId, '黑名单为空\n使用 /拉黑 <QQ号> 添加');
      return;
    }

    const lines = ['=== 用户黑名单 ===', ...basic.blacklistUsers.map((qq, i) => `${i + 1}. ${qq}`), '', '使用 /解黑 <QQ号> 移除'];
    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdBlacklistAdd(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const qq = this.resolveQQ(event, argStr);
    if (!qq) {
      await this.reply(event, connectionId, '请 @ 或输入 QQ 号，例如: /拉黑 @用户 或 /拉黑 123456');
      return;
    }

    const basic = this.getBasic(botId);
    if (basic.blacklistUsers.includes(qq)) {
      await this.reply(event, connectionId, `QQ ${qq} 已在黑名单中`);
      return;
    }

    this.setBasic(botId, { ...basic, blacklistUsers: [...basic.blacklistUsers, qq] });
    await this.reply(event, connectionId, `已将 ${qq} 加入黑名单`);
  }

  private async cmdBlacklistRemove(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const qq = this.resolveQQ(event, argStr);
    if (!qq) {
      await this.reply(event, connectionId, '请 @ 或输入 QQ 号，例如: /解黑 @用户 或 /解黑 123456');
      return;
    }

    const basic = this.getBasic(botId);
    if (!basic.blacklistUsers.includes(qq)) {
      await this.reply(event, connectionId, `QQ ${qq} 不在黑名单中`);
      return;
    }

    this.setBasic(botId, { ...basic, blacklistUsers: basic.blacklistUsers.filter((u) => u !== qq) });
    await this.reply(event, connectionId, `已将 ${qq} 从黑名单移除`);
  }

  // ==================== Group Toggle ====================

  private async cmdGroupToggle(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const basic = this.getBasic(botId);

    let targetGroup: number | undefined;
    let action: 'on' | 'off' | undefined;

    const tokens = argStr.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      if (/^(开|启用|on)$/i.test(t)) action = 'on';
      else if (/^(关|禁用|off)$/i.test(t)) action = 'off';
      else if (/^\d{5,}$/.test(t)) targetGroup = parseInt(t, 10);
    }

    // Default to current group if in a group chat
    if (!targetGroup && event.message_type === 'group' && 'group_id' in event) {
      targetGroup = (event as { group_id: number }).group_id;
    }

    if (!targetGroup) {
      await this.reply(event, connectionId,
        '用法: /群开关 [群号] 开/关\n' +
        '在群聊中可省略群号，直接: /群开关 开 或 /群开关 关');
      return;
    }

    // Determine current enabled state
    const mode = basic.groupFilterMode ?? 'none';
    const filterList = basic.groupFilterList ?? [];
    let currentlyEnabled = true;
    if (mode === 'whitelist') currentlyEnabled = filterList.includes(targetGroup);
    else if (mode === 'blacklist') currentlyEnabled = !filterList.includes(targetGroup);

    // If no explicit action, show status
    if (!action) {
      const statusText = currentlyEnabled ? '已启用' : '已禁用';
      await this.reply(event, connectionId, `群 ${targetGroup} 当前状态: ${statusText}\n使用 /群开关 开 或 /群开关 关 切换`);
      return;
    }

    const wantEnabled = action === 'on';
    if (wantEnabled === currentlyEnabled) {
      await this.reply(event, connectionId, `群 ${targetGroup} 已经是${wantEnabled ? '启用' : '禁用'}状态`);
      return;
    }

    // Apply the change
    let newList = [...filterList];
    let newMode = mode;

    if (mode === 'none') {
      if (!wantEnabled) {
        newMode = 'blacklist';
        newList = [targetGroup];
      }
    } else if (mode === 'whitelist') {
      if (wantEnabled) {
        if (!newList.includes(targetGroup)) newList.push(targetGroup);
      } else {
        newList = newList.filter((id) => id !== targetGroup);
      }
    } else if (mode === 'blacklist') {
      if (!wantEnabled) {
        if (!newList.includes(targetGroup)) newList.push(targetGroup);
      } else {
        newList = newList.filter((id) => id !== targetGroup);
      }
    }

    this.setBasic(botId, {
      ...basic,
      groupFilterMode: newMode as BasicConfig['groupFilterMode'],
      groupFilterList: newList,
    });

    const actionText = wantEnabled ? '启用' : '禁用';
    await this.reply(event, connectionId, `群 ${targetGroup} 已${actionText}`);
  }

  // ==================== Group Filter ====================

  private async cmdGroupFilter(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const basic = this.getBasic(botId);
    const modeMap: Record<string, string> = { none: '关闭', whitelist: '白名单', blacklist: '黑名单' };

    if (!argStr) {
      await this.reply(event, connectionId,
        `群过滤模式: ${modeMap[basic.groupFilterMode] ?? basic.groupFilterMode}\n` +
        `过滤列表: ${basic.groupFilterList.length} 个群\n` +
        `用法: /群过滤 关闭/白名单/黑名单`,
      );
      return;
    }

    const inputMap: Record<string, 'none' | 'whitelist' | 'blacklist'> = {
      '关闭': 'none', '关': 'none', 'none': 'none', 'off': 'none',
      '白名单': 'whitelist', 'whitelist': 'whitelist', '白': 'whitelist',
      '黑名单': 'blacklist', 'blacklist': 'blacklist', '黑': 'blacklist',
    };
    const mode = inputMap[argStr];
    if (!mode) {
      await this.reply(event, connectionId, '无效参数，请输入: 关闭 / 白名单 / 黑名单');
      return;
    }

    this.setBasic(botId, { ...basic, groupFilterMode: mode });
    await this.reply(event, connectionId, `群过滤模式已设为: ${modeMap[mode]}`);
  }

  private async cmdGroupFilterList(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const basic = this.getBasic(botId);
    const modeMap: Record<string, string> = { none: '关闭', whitelist: '白名单', blacklist: '黑名单' };

    if (basic.groupFilterList.length === 0) {
      await this.reply(event, connectionId, `群过滤列表为空 (模式: ${modeMap[basic.groupFilterMode]})\n使用 /添加过滤群 <群号> 添加`);
      return;
    }

    const lines = [
      `=== 群过滤列表 (${modeMap[basic.groupFilterMode]}模式) ===`,
      ...basic.groupFilterList.map((g, i) => `${i + 1}. ${g}`),
      '',
      '使用 /添加过滤群 或 /删除过滤群 管理',
    ];
    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdGroupFilterAdd(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const groupId = parseInt(argStr, 10);
    if (!groupId || isNaN(groupId)) {
      await this.reply(event, connectionId, '请输入有效的群号，例如: /添加过滤群 123456');
      return;
    }

    const basic = this.getBasic(botId);
    if (basic.groupFilterList.includes(groupId)) {
      await this.reply(event, connectionId, `群 ${groupId} 已在过滤列表中`);
      return;
    }

    this.setBasic(botId, { ...basic, groupFilterList: [...basic.groupFilterList, groupId] });
    await this.reply(event, connectionId, `已将群 ${groupId} 加入过滤列表`);
  }

  private async cmdGroupFilterRemove(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const groupId = parseInt(argStr, 10);
    if (!groupId || isNaN(groupId)) {
      await this.reply(event, connectionId, '请输入有效的群号，例如: /删除过滤群 123456');
      return;
    }

    const basic = this.getBasic(botId);
    if (!basic.groupFilterList.includes(groupId)) {
      await this.reply(event, connectionId, `群 ${groupId} 不在过滤列表中`);
      return;
    }

    this.setBasic(botId, { ...basic, groupFilterList: basic.groupFilterList.filter((g) => g !== groupId) });
    await this.reply(event, connectionId, `已将群 ${groupId} 从过滤列表移除`);
  }

  // ==================== Runtime Config ====================

  private async cmdOnlineTime(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const runtime = this.getRuntime(botId);
    const ot = runtime.onlineTime;

    if (!argStr) {
      await this.reply(event, connectionId,
        `在线时段: ${SystemPlugin.onOff(ot.enabled)}\n` +
        `时间: ${ot.startHour}:00 - ${ot.endHour}:00\n` +
        `用法: /在线时段 开/关 或 /在线时段 8-22`,
      );
      return;
    }

    const onOff = SystemPlugin.parseOnOff(argStr);
    if (onOff !== null) {
      this.setRuntime(botId, { ...runtime, onlineTime: { ...ot, enabled: onOff } });
      await this.reply(event, connectionId, `在线时段已${onOff ? '开启' : '关闭'} (${ot.startHour}:00 - ${ot.endHour}:00)`);
      return;
    }

    const match = argStr.match(/^(\d{1,2})\s*[-—~到]\s*(\d{1,2})$/);
    if (match) {
      const start = parseInt(match[1]!, 10);
      const end = parseInt(match[2]!, 10);
      if (start >= 0 && start <= 23 && end >= 0 && end <= 23) {
        this.setRuntime(botId, { ...runtime, onlineTime: { enabled: true, startHour: start, endHour: end } });
        await this.reply(event, connectionId, `在线时段已设为 ${start}:00 - ${end}:00 并开启`);
        return;
      }
    }

    await this.reply(event, connectionId, '无效参数\n用法: /在线时段 开/关 或 /在线时段 8-22');
  }

  private async cmdRateLimit(event: MessageEvent, connectionId: string, botId: number, argStr: string, args: string[]): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const runtime = this.getRuntime(botId);
    const rl = runtime.rateLimit;

    if (!argStr) {
      await this.reply(event, connectionId,
        `频率限制: ${SystemPlugin.onOff(rl.enabled)}\n` +
        `限制: ${rl.maxMessages} 条 / ${rl.windowSeconds} 秒\n` +
        `用法: /频率限制 开/关 或 /频率限制 20 60`,
      );
      return;
    }

    const onOff = SystemPlugin.parseOnOff(argStr);
    if (onOff !== null) {
      this.setRuntime(botId, { ...runtime, rateLimit: { ...rl, enabled: onOff } });
      await this.reply(event, connectionId, `频率限制已${onOff ? '开启' : '关闭'}`);
      return;
    }

    if (args.length >= 2) {
      const maxMsg = parseInt(args[0]!, 10);
      const windowSec = parseInt(args[1]!, 10);
      if (maxMsg > 0 && windowSec > 0) {
        this.setRuntime(botId, { ...runtime, rateLimit: { enabled: true, maxMessages: maxMsg, windowSeconds: windowSec } });
        await this.reply(event, connectionId, `频率限制已设为 ${maxMsg} 条/${windowSec} 秒 并开启`);
        return;
      }
    }

    await this.reply(event, connectionId, '无效参数\n用法: /频率限制 开/关 或 /频率限制 <条数> <秒数>');
  }

  private async cmdRetry(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;
    const runtime = this.getRuntime(botId);
    const rt = runtime.retry;

    if (!argStr) {
      await this.reply(event, connectionId,
        `消息重试: ${SystemPlugin.onOff(rt.enabled)}\n` +
        `最多 ${rt.maxRetries} 次，间隔 ${rt.retryDelayMs}ms\n` +
        `用法: /重试 开/关`,
      );
      return;
    }

    const val = SystemPlugin.parseOnOff(argStr);
    if (val === null) {
      await this.reply(event, connectionId, '无效参数，请输入 开 或 关');
      return;
    }

    this.setRuntime(botId, { ...runtime, retry: { ...rt, enabled: val } });
    await this.reply(event, connectionId, `消息重试已${val ? '开启' : '关闭'}`);
  }

  // ==================== Update Check ====================

  private async cmdCheckUpdate(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.requireMaster(event, connectionId, botId)) return;

    try {
      const result = await promanService.checkUpdate(this.appVersion);
      if (result.hasUpdate) {
        await this.reply(event, connectionId,
          `发现新版本 v${result.latestVersion}\n详细内容请前往管理系统查看`,
        );
      } else {
        await this.reply(event, connectionId, '当前已是最新版本');
      }
    } catch {
      await this.reply(event, connectionId, '检测更新失败，请稍后再试');
    }
  }

  // ==================== Utilities ====================

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}天`);
    if (hours > 0) parts.push(`${hours}小时`);
    parts.push(`${minutes}分钟`);
    return parts.join('');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

}
