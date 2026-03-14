import { mkdirSync, existsSync, rmSync, cpSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import { eq, and, asc } from 'drizzle-orm';
import { logService } from '../services/log.js';
import { nowISO } from '../utils/date.js';
import { env } from '../config/env.js';
import { configService } from '../services/config.js';
import type {
  PluginManifest,
  PluginInterface,
  PluginAppContext,
  PluginEventContext,
  PluginLogger,
  PluginInfo,
  PluginPermission,
  PluginConfigItem,
  PluginCommand,
} from '../types/plugin.js';
import { detectCommands, mergeCommands } from './command-detector.js';
import type { MessageEvent, NoticeEvent, RequestEvent } from '../types/onebot.js';
import type { OneBotClient } from '../ws/onebot-client.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

const MAX_CONSECUTIVE_ERRORS = 5;

interface LoadedPlugin {
  id: string;
  name: string;
  instance: PluginInterface;
  priority: number;
  errorCount: number;
  appContext: PluginAppContext;
  dispose: () => void;
  cacheDir?: string;
}

export class PluginManager {
  private loaded = new Map<string, LoadedPlugin>();
  private builtinPlugins = new Map<string, LoadedPlugin>();
  private disablingSet = new Set<string>();
  private logger: FastifyBaseLogger;
  private oneBotClient?: OneBotClient;
  private connectionManager?: ConnectionManager;
  private onPluginAutoDisabled?: (pluginName: string) => void;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
    mkdirSync(env.PLUGINS_DIR, { recursive: true });
  }

  /** Register a built-in plugin (call before initialize) */
  registerBuiltinPlugin(id: string, name: string, instance: PluginInterface, priority: number = 0): void {
    const { appContext, dispose } = this.createAppContext(id, name, []);
    const plugin: LoadedPlugin = { id, name, instance, priority, errorCount: 0, appContext, dispose };
    this.builtinPlugins.set(id, plugin);
    this.loaded.set(id, plugin);
    this.logger.info({ pluginId: id, name }, 'Built-in plugin registered');
    logService.addLog('info', 'plugin', `内置插件已注册: ${name}`);
  }

  setOneBotClient(client: OneBotClient): void {
    this.oneBotClient = client;
  }

  setConnectionManager(cm: ConnectionManager): void {
    this.connectionManager = cm;
  }

  setAutoDisableCallback(fn: (pluginName: string) => void): void {
    this.onPluginAutoDisabled = fn;
  }

  /** Install preinstalled plugins (once per plugin, respects user deletion) */
  async installPreinstalledPlugins(): Promise<void> {
    const currentFile = fileURLToPath(import.meta.url);
    const preinstalledDir = join(resolve(currentFile, '..'), 'preinstalled');
    if (!existsSync(preinstalledDir)) return;

    let entries: string[];
    try {
      entries = readdirSync(preinstalledDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return;
    }

    for (const dirName of entries) {
      const pluginSrcDir = join(preinstalledDir, dirName);
      const manifestPath = join(pluginSrcDir, 'manifest.json');
      if (!existsSync(manifestPath)) continue;

      let manifest: { name?: string };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch {
        this.logger.warn({ dirName }, 'Failed to parse preinstalled plugin manifest');
        continue;
      }

      if (!manifest.name) continue;

      const markerKey = `preinstalled:${manifest.name}`;
      const existing = db.select()
        .from(schema.botConfig)
        .where(eq(schema.botConfig.key, markerKey))
        .get();

      if (existing) {
        // Already installed — re-sync source files & commands in case they changed
        const pluginId = (manifest as Record<string, unknown>).id as string | undefined;
        if (pluginId) {
          const targetDir = join(env.PLUGINS_DIR, pluginId);
          if (existsSync(targetDir)) {
            cpSync(pluginSrcDir, targetDir, { recursive: true });
          }
        }
        this.syncPreinstalledCommands(pluginSrcDir, manifest);
        continue;
      }

      try {
        await this.installPlugin(pluginSrcDir);
        db.insert(schema.botConfig)
          .values({ key: markerKey, value: 'installed', updatedAt: nowISO() })
          .run();
        this.logger.info({ name: manifest.name }, 'Preinstalled plugin installed');
        logService.addLog('info', 'plugin', `预装插件已安装: ${manifest.name}`);
      } catch (err) {
        this.logger.error({ err, name: manifest.name }, 'Failed to install preinstalled plugin');
        logService.addLog('error', 'plugin', `预装插件安装失败: ${manifest.name}`, String(err));
      }
    }
  }

  private syncPreinstalledCommands(pluginSrcDir: string, manifest: { name?: string; id?: string; entry?: string; commands?: PluginCommand[] }): void {
    if (!manifest.id) return;
    const record = db.select().from(schema.plugins).where(eq(schema.plugins.id, manifest.id)).get();
    if (!record) return;

    const VALID_CMD_PERMISSIONS = new Set(['all', 'master', 'super_admin']);
    const manifestCommands: PluginCommand[] = (manifest.commands ?? []).filter(
      (cmd: PluginCommand) => cmd.command && VALID_CMD_PERMISSIONS.has(cmd.permission),
    );

    const entryFile = manifest.entry ?? record.entryFile;
    const entryPath = join(pluginSrcDir, entryFile);
    let finalCommands = manifestCommands;
    if (existsSync(entryPath)) {
      const entrySource = readFileSync(entryPath, 'utf-8');
      const detected = detectCommands(entrySource);
      finalCommands = mergeCommands(manifestCommands, detected);
    }

    const newJson = JSON.stringify(finalCommands);
    if (newJson !== record.commands) {
      db.update(schema.plugins)
        .set({ commands: newJson, updatedAt: nowISO() })
        .where(eq(schema.plugins.id, manifest.id))
        .run();
      this.logger.info({ name: manifest.name }, 'Preinstalled plugin commands synced');
    }
  }

  async initialize(): Promise<void> {
    const cacheBase = join(env.PLUGINS_DIR, '.cache');
    rmSync(cacheBase, { recursive: true, force: true });
    mkdirSync(cacheBase, { recursive: true });

    const rows = db.select()
      .from(schema.plugins)
      .where(eq(schema.plugins.enabled, 1))
      .all();

    for (const row of rows) {
      try {
        await this.loadPlugin(row.id);
      } catch (err) {
        this.logger.error({ err, pluginId: row.id }, 'Failed to load plugin on startup');
        logService.addLog('error', 'plugin', `插件加载失败: ${row.name}`, String(err));
      }
    }
  }

  async installPlugin(extractedDir: string): Promise<PluginInfo> {
    const manifestPath = join(extractedDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error('manifest.json 不存在');
    }

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      throw new Error('manifest.json 解析失败');
    }

    if (!manifest.name || !manifest.version || !manifest.entry) {
      throw new Error('manifest.json 缺少必要字段 (name, version, entry)');
    }

    if (!manifest.id) {
      throw new Error('manifest.json 缺少必要字段 id');
    }

    const PLUGIN_ID_PREFIX = 'qqbot_plugin_';
    if (!manifest.id.startsWith(PLUGIN_ID_PREFIX)) {
      throw new Error(`插件 id 必须以 "${PLUGIN_ID_PREFIX}" 开头，当前值: ${manifest.id}`);
    }

    if (!/^[a-z0-9_]+$/.test(manifest.id)) {
      throw new Error('插件 id 只能包含小写字母、数字和下划线');
    }

    const VALID_PERMISSIONS: Set<string> = new Set(['sendMessage', 'callApi', 'getConfig', 'setConfig']);
    const permissions: PluginPermission[] = (manifest.permissions ?? []).filter((p: string) => {
      if (!VALID_PERMISSIONS.has(p)) {
        this.logger.warn({ pluginName: manifest.name, permission: p }, 'Unknown plugin permission ignored');
        return false;
      }
      return true;
    }) as PluginPermission[];

    const entryPath = join(extractedDir, manifest.entry);
    if (!resolve(entryPath).startsWith(resolve(extractedDir))) {
      throw new Error('插件入口文件路径非法');
    }
    if (!existsSync(entryPath)) {
      throw new Error(`入口文件不存在: ${manifest.entry}`);
    }

    // Validate configSchema
    const VALID_CONFIG_TYPES = new Set(['string', 'number', 'boolean', 'select']);
    const configSchema: PluginConfigItem[] = (manifest.configSchema ?? []).filter((item) => {
      if (!item.key || !item.label || !VALID_CONFIG_TYPES.has(item.type)) {
        this.logger.warn({ pluginName: manifest.name, item }, 'Invalid configSchema item ignored');
        return false;
      }
      return true;
    });

    // Validate commands
    const VALID_CMD_PERMISSIONS = new Set(['all', 'master', 'super_admin']);
    const commands: PluginCommand[] = (manifest.commands ?? []).filter((cmd) => {
      if (!cmd.command || !VALID_CMD_PERMISSIONS.has(cmd.permission)) {
        this.logger.warn({ pluginName: manifest.name, cmd }, 'Invalid command item ignored');
        return false;
      }
      return true;
    });

    // Auto-detect commands from entry file source code
    const entrySource = readFileSync(entryPath, 'utf-8');
    const detected = detectCommands(entrySource);
    const finalCommands = mergeCommands(commands, detected);

    // Check if plugin already exists (by manifest id)
    const existing = db.select({ id: schema.plugins.id })
      .from(schema.plugins)
      .where(eq(schema.plugins.id, manifest.id))
      .get();

    const pluginId = manifest.id;
    const pluginDir = join(env.PLUGINS_DIR, pluginId);

    // If updating, unload first
    const wasEnabled = existing ? (db.select().from(schema.plugins).where(eq(schema.plugins.id, manifest.id)).get()?.enabled === 1) : false;
    if (existing) {
      await this.unloadPlugin(existing.id);
      rmSync(pluginDir, { recursive: true, force: true });
    }

    // Copy files to plugin directory
    cpSync(extractedDir, pluginDir, { recursive: true });

    const now = nowISO();
    if (existing) {
      db.update(schema.plugins)
        .set({
          version: manifest.version,
          description: manifest.description ?? null,
          author: manifest.author ?? null,
          repo: manifest.repo ?? null,
          entryFile: manifest.entry,
          permissions: JSON.stringify(permissions),
          configSchema: JSON.stringify(configSchema),
          commands: JSON.stringify(finalCommands),
          updatedAt: now,
        })
        .where(eq(schema.plugins.id, pluginId))
        .run();
    } else {
      db.insert(schema.plugins)
        .values({
          id: pluginId,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? null,
          author: manifest.author ?? null,
          repo: manifest.repo ?? null,
          entryFile: manifest.entry,
          enabled: 0,
          priority: 100,
          permissions: JSON.stringify(permissions),
          configSchema: JSON.stringify(configSchema),
          commands: JSON.stringify(finalCommands),
          installedAt: now,
          updatedAt: now,
        })
        .run();
    }

    logService.addLog('info', 'plugin', `插件已安装: ${manifest.name} v${manifest.version}`);

    // Auto-reload if plugin was previously enabled
    if (wasEnabled) {
      try {
        await this.loadPlugin(pluginId);
        logService.addLog('info', 'plugin', `插件已自动重载: ${manifest.name}`);
      } catch (err) {
        // Disable on reload failure
        db.update(schema.plugins)
          .set({ enabled: 0, updatedAt: nowISO() })
          .where(eq(schema.plugins.id, pluginId))
          .run();
        this.logger.error({ err, pluginId }, 'Failed to auto-reload plugin after update, disabled');
        logService.addLog('error', 'plugin', `插件更新后重载失败，已自动禁用: ${manifest.name}`, String(err));
      }
    }

    return this.getPluginInfo(pluginId)!;
  }

  async loadPlugin(id: string): Promise<void> {
    if (this.loaded.has(id)) return;

    const record = db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
    if (!record) throw new Error(`插件不存在: ${id}`);

    const pluginDir = join(env.PLUGINS_DIR, id);
    const entryCheck = join(pluginDir, record.entryFile);
    if (!resolve(entryCheck).startsWith(resolve(pluginDir))) {
      throw new Error('插件入口文件路径非法');
    }
    if (!existsSync(entryCheck)) {
      throw new Error(`插件入口文件不存在: ${entryCheck}`);
    }

    // Copy to unique cache dir so every file gets a fresh URL, fully bypassing ESM module cache
    const cacheDir = join(env.PLUGINS_DIR, '.cache', `${id}_${Date.now()}`);
    const dataDirAbs = resolve(pluginDir, 'data');
    cpSync(pluginDir, cacheDir, {
      recursive: true,
      filter: (src) => {
        const s = resolve(src);
        return s !== dataDirAbs && !s.startsWith(dataDirAbs + sep);
      },
    });

    const entryPath = join(cacheDir, record.entryFile);
    const entryUrl = pathToFileURL(entryPath).href;
    const mod = await import(entryUrl);
    const instance: PluginInterface = mod.default ?? mod;

    const permissions: PluginPermission[] = JSON.parse(record.permissions || '[]');
    const { appContext, dispose } = this.createAppContext(id, record.name, permissions);

    if (instance.onLoad) {
      await instance.onLoad(appContext);
    }

    this.loaded.set(id, {
      id,
      name: record.name,
      instance,
      priority: record.priority,
      errorCount: 0,
      appContext,
      dispose,
      cacheDir,
    });

    this.logger.info({ pluginId: id, name: record.name }, 'Plugin loaded');
    logService.addLog('info', 'plugin', `插件已加载: ${record.name}`);
  }

  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.loaded.get(id);
    if (!plugin) return;

    try {
      if (plugin.instance.onUnload) {
        await plugin.instance.onUnload();
      }
    } catch (err) {
      this.logger.error({ err, pluginId: id }, 'Error during plugin unload');
    }

    // Dispose context: clear managed timers + mark context as disposed
    plugin.dispose();

    if (plugin.cacheDir) {
      rmSync(plugin.cacheDir, { recursive: true, force: true });
    }

    this.loaded.delete(id);
    this.logger.info({ pluginId: id }, 'Plugin unloaded');
  }

  async enablePlugin(id: string): Promise<void> {
    if (this.builtinPlugins.has(id)) throw new Error('内置插件不可操作');
    db.update(schema.plugins)
      .set({ enabled: 1, updatedAt: nowISO() })
      .where(eq(schema.plugins.id, id))
      .run();
    try {
      await this.loadPlugin(id);
    } catch (err) {
      // Rollback: set enabled=0 if load fails
      db.update(schema.plugins)
        .set({ enabled: 0, updatedAt: nowISO() })
        .where(eq(schema.plugins.id, id))
        .run();
      throw err;
    }
    logService.addLog('info', 'plugin', `插件已启用: ${id}`);
  }

  async disablePlugin(id: string): Promise<void> {
    if (this.builtinPlugins.has(id)) throw new Error('内置插件不可禁用');
    db.update(schema.plugins)
      .set({ enabled: 0, updatedAt: nowISO() })
      .where(eq(schema.plugins.id, id))
      .run();
    await this.unloadPlugin(id);
    logService.addLog('info', 'plugin', `插件已禁用: ${id}`);
  }

  async deletePlugin(id: string): Promise<void> {
    if (this.builtinPlugins.has(id)) throw new Error('内置插件不可删除');
    await this.unloadPlugin(id);
    db.delete(schema.plugins).where(eq(schema.plugins.id, id)).run();
    db.delete(schema.pluginConfig).where(eq(schema.pluginConfig.pluginId, id)).run();
    const pluginDir = join(env.PLUGINS_DIR, id);
    rmSync(pluginDir, { recursive: true, force: true });
    logService.addLog('info', 'plugin', `插件已删除: ${id}`);
  }

  async reloadPlugin(id: string): Promise<void> {
    const record = db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
    if (!record) return;

    const wasEnabled = record.enabled === 1;
    await this.unloadPlugin(id);

    const pluginDir = join(env.PLUGINS_DIR, id);
    const manifestPath = join(pluginDir, 'manifest.json');
    if (!existsSync(manifestPath)) throw new Error(`插件 ${record.name}: manifest.json 不存在`);

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      throw new Error(`插件 ${record.name}: manifest.json 解析失败`);
    }

    const entryFile = manifest.entry || record.entryFile;
    const entryPath = join(pluginDir, entryFile);
    if (!existsSync(entryPath)) throw new Error(`插件 ${record.name}: 入口文件不存在 ${entryFile}`);

    const VALID_PERMISSIONS: Set<string> = new Set(['sendMessage', 'callApi', 'getConfig', 'setConfig']);
    const permissions = (manifest.permissions ?? []).filter((p: string) =>
      VALID_PERMISSIONS.has(p),
    ) as PluginPermission[];

    const VALID_CONFIG_TYPES = new Set(['string', 'number', 'boolean', 'select']);
    const configSchema: PluginConfigItem[] = (manifest.configSchema ?? []).filter(
      (item) => item.key && item.label && VALID_CONFIG_TYPES.has(item.type),
    );

    const VALID_CMD_PERMISSIONS = new Set(['all', 'master', 'super_admin']);
    const commands: PluginCommand[] = (manifest.commands ?? []).filter(
      (cmd) => cmd.command && VALID_CMD_PERMISSIONS.has(cmd.permission),
    );

    const entrySource = readFileSync(entryPath, 'utf-8');
    const detected = detectCommands(entrySource);
    const finalCommands = mergeCommands(commands, detected);

    const now = nowISO();
    db.update(schema.plugins)
      .set({
        name: manifest.name || record.name,
        version: manifest.version || record.version,
        description: manifest.description ?? record.description,
        author: manifest.author ?? record.author,
        repo: manifest.repo ?? record.repo ?? null,
        entryFile,
        permissions: JSON.stringify(permissions),
        configSchema: JSON.stringify(configSchema),
        commands: JSON.stringify(finalCommands),
        updatedAt: now,
      })
      .where(eq(schema.plugins.id, id))
      .run();

    if (wasEnabled) {
      await this.loadPlugin(id);
    }

    logService.addLog('info', 'plugin', `插件已重载: ${manifest.name || record.name}`);
  }

  async reloadAllPlugins(): Promise<{ total: number; failed: string[] }> {
    const rows = db.select().from(schema.plugins).all();
    const failed: string[] = [];

    for (const row of rows) {
      try {
        await this.reloadPlugin(row.id);
      } catch (err) {
        failed.push(`${row.name}: ${err instanceof Error ? err.message : String(err)}`);
        this.logger.error({ err, pluginId: row.id }, 'Failed to reload plugin');
      }
    }

    logService.addLog('info', 'plugin', `批量重载完成: ${rows.length} 个插件, ${failed.length} 个失败`);
    return { total: rows.length, failed };
  }

  updatePriority(id: string, priority: number): void {
    if (this.builtinPlugins.has(id)) throw new Error('内置插件优先级不可修改');
    db.update(schema.plugins)
      .set({ priority, updatedAt: nowISO() })
      .where(eq(schema.plugins.id, id))
      .run();
    const plugin = this.loaded.get(id);
    if (plugin) {
      plugin.priority = priority;
    }
  }

  async dispatchMessage(event: MessageEvent, connectionId: string): Promise<void> {
    const plugins = this.getSortedPlugins();
    for (const plugin of plugins) {
      if (!plugin.instance.onMessage) continue;
      try {
        const ctx = plugin.appContext.forConnection(connectionId);
        await plugin.instance.onMessage(event, ctx);
        plugin.errorCount = 0;
      } catch (err) {
        this.handlePluginError(plugin, err);
      }
    }
  }

  async dispatchNotice(event: NoticeEvent, connectionId: string): Promise<void> {
    const plugins = this.getSortedPlugins();
    for (const plugin of plugins) {
      if (!plugin.instance.onNotice) continue;
      try {
        const ctx = plugin.appContext.forConnection(connectionId);
        await plugin.instance.onNotice(event, ctx);
        plugin.errorCount = 0;
      } catch (err) {
        this.handlePluginError(plugin, err);
      }
    }
  }

  async dispatchRequest(event: RequestEvent, connectionId: string): Promise<void> {
    const plugins = this.getSortedPlugins();
    for (const plugin of plugins) {
      if (!plugin.instance.onRequest) continue;
      try {
        const ctx = plugin.appContext.forConnection(connectionId);
        await plugin.instance.onRequest(event, ctx);
        plugin.errorCount = 0;
      } catch (err) {
        this.handlePluginError(plugin, err);
      }
    }
  }

  getAllPlugins(): PluginInfo[] {
    const builtinInfos: PluginInfo[] = Array.from(this.builtinPlugins.values()).map((p) => ({
      id: p.id,
      name: p.name,
      version: '1.0.0',
      description: '系统内置插件',
      author: 'System',
      repo: null,
      enabled: true,
      priority: p.priority,
      loaded: true,
      errorCount: p.errorCount,
      installedAt: '',
      updatedAt: '',
      builtin: true,
      hasIcon: false,
      hasReadme: false,
      commands: p.instance.getCommands?.() ?? [],
      permissions: [] as PluginPermission[],
      configSchema: [] as PluginConfigItem[],
    }));
    const rows = db.select()
      .from(schema.plugins)
      .orderBy(asc(schema.plugins.priority))
      .all();
    const userInfos = rows.map((r) => this.recordToInfo(r));
    return [...builtinInfos, ...userInfos];
  }

  getPluginInfo(id: string): PluginInfo | undefined {
    const builtin = this.builtinPlugins.get(id);
    if (builtin) {
      return {
        id: builtin.id,
        name: builtin.name,
        version: '1.0.0',
        description: '系统内置插件',
        author: 'System',
        repo: null,
        enabled: true,
        priority: builtin.priority,
        loaded: true,
        errorCount: builtin.errorCount,
        installedAt: '',
        updatedAt: '',
        builtin: true,
        hasIcon: false,
        hasReadme: false,
        commands: builtin.instance.getCommands?.() ?? [],
        permissions: [],
        configSchema: [],
      };
    }
    const row = db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
    if (!row) return undefined;
    return this.recordToInfo(row);
  }

  async unloadAll(): Promise<void> {
    for (const id of this.loaded.keys()) {
      await this.unloadPlugin(id);
    }
  }

  private getSortedPlugins(): LoadedPlugin[] {
    return Array.from(this.loaded.values()).sort((a, b) => a.priority - b.priority);
  }

  private handlePluginError(plugin: LoadedPlugin, err: unknown): void {
    plugin.errorCount++;
    this.logger.error({ err, pluginId: plugin.id, errorCount: plugin.errorCount }, 'Plugin error');
    logService.addLog('error', 'plugin', `插件错误 [${plugin.name}]: ${String(err)}`);

    if (plugin.errorCount >= MAX_CONSECUTIVE_ERRORS && !this.builtinPlugins.has(plugin.id)) {
      if (this.disablingSet.has(plugin.id)) return;
      this.disablingSet.add(plugin.id);
      this.logger.warn({ pluginId: plugin.id }, 'Plugin exceeded max errors, disabling');
      logService.addLog('warn', 'plugin', `插件连续错误过多，已自动禁用: ${plugin.name}`);
      this.onPluginAutoDisabled?.(plugin.name);
      this.disablePlugin(plugin.id)
        .catch((e) => this.logger.error({ err: e, pluginId: plugin.id }, 'Failed to auto-disable plugin'))
        .finally(() => this.disablingSet.delete(plugin.id));
    }
  }

  // ── Two-layer context factory ──

  private createAppContext(pluginId: string, pluginName: string, permissions: PluginPermission[] = []): { appContext: PluginAppContext; dispose: () => void } {
    const pluginLogger: PluginLogger = {
      debug: (msg) => logService.addLog('debug', 'plugin', `[${pluginName}] ${msg}`),
      info: (msg) => logService.addLog('info', 'plugin', `[${pluginName}] ${msg}`),
      warn: (msg) => logService.addLog('warn', 'plugin', `[${pluginName}] ${msg}`),
      error: (msg) => logService.addLog('error', 'plugin', `[${pluginName}] ${msg}`),
    };

    const dataDir = join(env.PLUGINS_DIR, pluginId, 'data');
    mkdirSync(dataDir, { recursive: true });

    const permSet = new Set(permissions);

    const requirePermission = (perm: PluginPermission) => {
      if (!permSet.has(perm)) {
        const err = `插件 [${pluginName}] 未声明权限: ${perm}`;
        pluginLogger.error(err);
        throw new Error(err);
      }
    };

    // Disposed state + managed timers tracking
    let disposed = false;
    const timers = new Set<ReturnType<typeof globalThis.setTimeout>>();
    const intervals = new Set<ReturnType<typeof globalThis.setInterval>>();

    const guardDisposed = (methodName: string): boolean => {
      if (disposed) {
        pluginLogger.warn(`插件已卸载，忽略调用: ${methodName}`);
        return true;
      }
      return false;
    };

    const dispose = () => {
      disposed = true;
      for (const id of timers) {
        globalThis.clearTimeout(id);
      }
      timers.clear();
      for (const id of intervals) {
        globalThis.clearInterval(id);
      }
      intervals.clear();
    };

    // Shared timer methods (used by both app and event contexts)
    const managedSetTimeout = (callback: () => void, ms: number): number => {
      if (guardDisposed('setTimeout')) return 0 as unknown as number;
      const id = globalThis.setTimeout(() => {
        timers.delete(id);
        if (!disposed) callback();
      }, ms);
      timers.add(id);
      return id as unknown as number;
    };

    const managedSetInterval = (callback: () => void, ms: number): number => {
      if (guardDisposed('setInterval')) return 0 as unknown as number;
      const id = globalThis.setInterval(() => {
        if (!disposed) callback();
      }, ms);
      intervals.add(id);
      return id as unknown as number;
    };

    const managedClearTimeout = (timerId: number): void => {
      if (guardDisposed('clearTimeout')) return;
      globalThis.clearTimeout(timerId as unknown as ReturnType<typeof globalThis.setTimeout>);
      timers.delete(timerId as unknown as ReturnType<typeof globalThis.setTimeout>);
    };

    const managedClearInterval = (intervalId: number): void => {
      if (guardDisposed('clearInterval')) return;
      globalThis.clearInterval(intervalId as unknown as ReturnType<typeof globalThis.setInterval>);
      intervals.delete(intervalId as unknown as ReturnType<typeof globalThis.setInterval>);
    };

    // Shared config methods
    const getConfig = (key: string): unknown => {
      if (guardDisposed('getConfig')) return undefined;
      requirePermission('getConfig');
      const row = db.select()
        .from(schema.pluginConfig)
        .where(and(
          eq(schema.pluginConfig.pluginId, pluginId),
          eq(schema.pluginConfig.key, key),
        ))
        .get();
      if (!row) return undefined;
      try {
        return JSON.parse(row.value);
      } catch {
        return row.value;
      }
    };

    const setConfig = (key: string, value: unknown): void => {
      if (guardDisposed('setConfig')) return;
      requirePermission('setConfig');
      const jsonValue = JSON.stringify(value);
      const now = nowISO();
      db.insert(schema.pluginConfig)
        .values({ pluginId, key, value: jsonValue, updatedAt: now })
        .onConflictDoUpdate({
          target: [schema.pluginConfig.pluginId, schema.pluginConfig.key],
          set: { value: jsonValue, updatedAt: now },
        })
        .run();
    };

    // Factory for bound event contexts
    const forConnection = (connectionId: string): PluginEventContext => {
      if (guardDisposed('forConnection')) {
        throw new Error(`插件 [${pluginName}] 已卸载，无法创建事件上下文`);
      }
      if (!this.connectionManager) {
        throw new Error('ConnectionManager 未初始化');
      }
      const conn = this.connectionManager.getConnection(connectionId);
      if (!conn || conn.state !== 'authenticated') {
        throw new Error(`连接 ${connectionId} 不可用（不存在或未认证）`);
      }
      const selfId = conn.botInfo?.user_id;

      return {
        connectionId,
        selfId,
        logger: pluginLogger,
        dataDir,
        getConfig,
        setConfig,
        getBotConfig: (section: string): unknown => {
          if (guardDisposed('getBotConfig')) return undefined;
          requirePermission('getConfig');
          if (section === 'superAdmins') {
            return configService.getSuperAdminQQ();
          }
          if (!conn.botInfo?.user_id) return undefined;
          const botRow = db.select({ id: schema.bots.id })
            .from(schema.bots)
            .where(eq(schema.bots.selfId, conn.botInfo.user_id))
            .get();
          if (!botRow) return undefined;
          return configService.get(botRow.id, section);
        },
        callApi: async (action: string, params: Record<string, unknown> = {}): Promise<unknown> => {
          if (guardDisposed('callApi')) return;
          requirePermission('callApi');
          if (!this.oneBotClient) {
            throw new Error('Bot 未连接');
          }
          return this.oneBotClient.callApi(connectionId, action, params, pluginName);
        },
        sendMessage: async (type: 'private' | 'group', target: number, message): Promise<void> => {
          if (guardDisposed('sendMessage')) return;
          requirePermission('sendMessage');
          if (!this.oneBotClient) {
            throw new Error('Bot 未连接');
          }
          if (type === 'private') {
            await this.oneBotClient.sendPrivateMsg(connectionId, target, message, pluginName);
          } else {
            await this.oneBotClient.sendGroupMsg(connectionId, target, message, pluginName);
          }
        },
        setTimeout: managedSetTimeout,
        setInterval: managedSetInterval,
        clearTimeout: managedClearTimeout,
        clearInterval: managedClearInterval,
      };
    };

    const appContext: PluginAppContext = {
      logger: pluginLogger,
      dataDir,
      getConfig,
      setConfig,
      setTimeout: managedSetTimeout,
      setInterval: managedSetInterval,
      clearTimeout: managedClearTimeout,
      clearInterval: managedClearInterval,
      forConnection,
      forBot: (selfId: number): PluginEventContext => {
        if (guardDisposed('forBot')) {
          throw new Error(`插件 [${pluginName}] 已卸载，无法创建事件上下文`);
        }
        if (!this.connectionManager) {
          throw new Error('ConnectionManager 未初始化');
        }
        const conn = this.connectionManager.getConnectionBySelfId(selfId);
        if (!conn || conn.state !== 'authenticated') {
          throw new Error(`未找到 QQ ${selfId} 对应的已认证连接`);
        }
        return forConnection(conn.id);
      },
      getConnectedBots: (): Array<{ connectionId: string; selfId: number }> => {
        if (guardDisposed('getConnectedBots')) return [];
        if (!this.connectionManager) return [];
        return this.connectionManager.getAllConnections()
          .filter(c => c.state === 'authenticated' && c.botInfo?.user_id)
          .map(c => ({ connectionId: c.id, selfId: c.botInfo!.user_id }));
      },
    };

    return { appContext, dispose };
  }

  private recordToInfo(record: typeof schema.plugins.$inferSelect): PluginInfo {
    const loaded = this.loaded.get(record.id);
    const permissions: PluginPermission[] = JSON.parse(record.permissions || '[]');
    const configSchema: PluginConfigItem[] = JSON.parse(record.configSchema || '[]');
    const dbCommands: PluginCommand[] = JSON.parse(record.commands || '[]');
    // Runtime getCommands() overrides DB commands if plugin is loaded and implements it
    const commands = loaded?.instance.getCommands?.() ?? dbCommands;
    const pluginDir = join(env.PLUGINS_DIR, record.id);
    const iconPath = join(pluginDir, 'icon.png');
    const readmePath = join(pluginDir, 'README.md');
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      description: record.description,
      author: record.author,
      repo: record.repo ?? null,
      enabled: record.enabled === 1,
      priority: record.priority,
      loaded: !!loaded,
      errorCount: loaded?.errorCount ?? 0,
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
      builtin: false,
      hasIcon: existsSync(iconPath),
      hasReadme: existsSync(readmePath),
      commands,
      permissions,
      configSchema,
    };
  }

  /** Get the plugin directory path on disk */
  getPluginDir(pluginId: string): string {
    return join(env.PLUGINS_DIR, pluginId);
  }

  getPluginConfigValues(pluginId: string): Record<string, unknown> {
    const rows = db.select()
      .from(schema.pluginConfig)
      .where(eq(schema.pluginConfig.pluginId, pluginId))
      .all();
    const values: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        values[row.key] = JSON.parse(row.value);
      } catch {
        values[row.key] = row.value;
      }
    }
    return values;
  }

  setPluginConfigValues(pluginId: string, values: Record<string, unknown>): void {
    const record = db.select().from(schema.plugins).where(eq(schema.plugins.id, pluginId)).get();
    if (!record) throw new Error('插件不存在');

    const configSchema: PluginConfigItem[] = JSON.parse(record.configSchema || '[]');
    const validKeys = new Set(configSchema.map((item) => item.key));

    const now = nowISO();
    for (const [key, value] of Object.entries(values)) {
      if (!validKeys.has(key)) continue;
      const jsonValue = JSON.stringify(value);
      db.insert(schema.pluginConfig)
        .values({ pluginId, key, value: jsonValue, updatedAt: now })
        .onConflictDoUpdate({
          target: [schema.pluginConfig.pluginId, schema.pluginConfig.key],
          set: { value: jsonValue, updatedAt: now },
        })
        .run();
    }
  }
}
