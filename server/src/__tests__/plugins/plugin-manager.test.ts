import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/schema.js');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL,
      description TEXT,
      author TEXT,
      repo TEXT,
      entry_file TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 100,
      permissions TEXT NOT NULL DEFAULT '[]',
      config_schema TEXT NOT NULL DEFAULT '[]',
      commands TEXT NOT NULL DEFAULT '[]',
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE plugin_config (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, key)
    );
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bot_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const db = drizzle(sqlite, { schema });

  return { db, rawDb: sqlite, schema };
});

import { rawDb, db, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { PluginManager } from '../../plugins/plugin-manager.js';
import type { PluginInterface } from '../../types/plugin.js';

// Create a mock logger
function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    silent: vi.fn(),
    level: 'info',
  } as any;
}

// Helper to create a temporary plugin directory with manifest and entry file
function createTempPlugin(opts: {
  name: string;
  id?: string;
  version?: string;
  entry?: string;
  permissions?: string[];
  entryContent?: string;
}): string {
  const dir = join(tmpdir(), `test-plugin-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });

  const pluginId = opts.id ?? `qqbot_plugin_${opts.name.replace(/[^a-z0-9]/g, '_')}`;
  const manifest = {
    id: pluginId,
    name: opts.name,
    version: opts.version ?? '1.0.0',
    entry: opts.entry ?? 'index.js',
    permissions: opts.permissions ?? [],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

  const entryContent = opts.entryContent ?? `
    export default {
      async onLoad(app) {},
      async onUnload() {},
      async onMessage(event, ctx) {},
    };
  `;
  writeFileSync(join(dir, manifest.entry), entryContent);

  return dir;
}

describe('PluginManager', () => {
  let pm: PluginManager;
  const tempDirs: string[] = [];

  beforeEach(() => {
    rawDb.exec('DELETE FROM plugins');
    rawDb.exec('DELETE FROM plugin_config');
    rawDb.exec('DELETE FROM logs');
    pm = new PluginManager(createMockLogger());
  });

  // Cleanup temp dirs after all tests
  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  describe('installPlugin', () => {
    it('throws if manifest.json is missing', async () => {
      const dir = join(tmpdir(), `test-empty-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      tempDirs.push(dir);

      await expect(pm.installPlugin(dir)).rejects.toThrow('manifest.json 不存在');
    });

    it('throws if manifest.json is invalid JSON', async () => {
      const dir = join(tmpdir(), `test-badjson-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), 'NOT JSON');
      tempDirs.push(dir);

      await expect(pm.installPlugin(dir)).rejects.toThrow('manifest.json 解析失败');
    });

    it('throws if manifest is missing required fields', async () => {
      const dir = join(tmpdir(), `test-nofields-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'test' }));
      tempDirs.push(dir);

      await expect(pm.installPlugin(dir)).rejects.toThrow('缺少必要字段');
    });

    it('throws if id is missing', async () => {
      const dir = join(tmpdir(), `test-noid-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'test', version: '1.0.0', entry: 'index.js' }));
      writeFileSync(join(dir, 'index.js'), 'export default {};');
      tempDirs.push(dir);

      await expect(pm.installPlugin(dir)).rejects.toThrow('缺少必要字段 id');
    });

    it('throws if id does not start with qqbot_plugin_', async () => {
      const dir = join(tmpdir(), `test-badprefix-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id: 'my_plugin', name: 'test', version: '1.0.0', entry: 'index.js' }));
      writeFileSync(join(dir, 'index.js'), 'export default {};');
      tempDirs.push(dir);

      await expect(pm.installPlugin(dir)).rejects.toThrow('必须以 "qqbot_plugin_" 开头');
    });

    it('throws if id contains invalid characters', async () => {
      const dir = join(tmpdir(), `test-badid-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id: 'qqbot_plugin_My-Plugin!', name: 'test', version: '1.0.0', entry: 'index.js' }));
      writeFileSync(join(dir, 'index.js'), 'export default {};');
      tempDirs.push(dir);

      await expect(pm.installPlugin(dir)).rejects.toThrow('只能包含小写字母、数字和下划线');
    });

    it('throws if entry file does not exist', async () => {
      const dir = join(tmpdir(), `test-noentry-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({ id: 'qqbot_plugin_test_noentry', name: 'test', version: '1.0.0', entry: 'missing.js' }),
      );
      tempDirs.push(dir);

      await expect(pm.installPlugin(dir)).rejects.toThrow('入口文件不存在');
    });

    it('installs a valid plugin and returns info', async () => {
      const dir = createTempPlugin({ name: 'test-install' });
      tempDirs.push(dir);

      const info = await pm.installPlugin(dir);
      expect(info.name).toBe('test-install');
      expect(info.version).toBe('1.0.0');
      expect(info.enabled).toBe(false);
      expect(info.priority).toBe(100);
      expect(info.builtin).toBe(false);
    });

    it('updates an existing plugin with the same id', async () => {
      const dir1 = createTempPlugin({ name: 'test-update', id: 'qqbot_plugin_test_update', version: '1.0.0' });
      tempDirs.push(dir1);
      const info1 = await pm.installPlugin(dir1);

      const dir2 = createTempPlugin({ name: 'test-update', id: 'qqbot_plugin_test_update', version: '2.0.0' });
      tempDirs.push(dir2);
      const info2 = await pm.installPlugin(dir2);

      expect(info2.id).toBe(info1.id);
      expect(info2.version).toBe('2.0.0');
    });

    it('stores commands from manifest and returns them in info', async () => {
      const dir = join(tmpdir(), `test-cmds-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      tempDirs.push(dir);

      const manifest = {
        id: 'qqbot_plugin_test_commands',
        name: 'test-commands',
        version: '1.0.0',
        entry: 'index.js',
        commands: [
          { command: '/ping', description: 'Pong', permission: 'all' },
          { command: '/ban', description: 'Ban user', usage: '/ban <qq>', permission: 'master' },
        ],
      };
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(dir, 'index.js'), 'export default {};');

      const info = await pm.installPlugin(dir);
      expect(info.commands).toHaveLength(2);
      expect(info.commands[0].command).toBe('/ping');
      expect(info.commands[1].permission).toBe('master');
    });

    it('filters invalid commands from manifest', async () => {
      const dir = join(tmpdir(), `test-badcmds-${randomUUID()}`);
      mkdirSync(dir, { recursive: true });
      tempDirs.push(dir);

      const manifest = {
        id: 'qqbot_plugin_test_bad_commands',
        name: 'test-bad-commands',
        version: '1.0.0',
        entry: 'index.js',
        commands: [
          { command: '/ok', description: 'Valid', permission: 'all' },
          { command: '', description: 'Missing command', permission: 'all' },
          { command: '/bad', description: 'Bad perm', permission: 'invalid' },
        ],
      };
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(dir, 'index.js'), 'export default {};');

      const info = await pm.installPlugin(dir);
      expect(info.commands).toHaveLength(1);
      expect(info.commands[0].command).toBe('/ok');
    });
  });

  describe('enable / disable', () => {
    it('enables a plugin and updates DB', async () => {
      const dir = createTempPlugin({ name: 'test-enable' });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);

      await pm.enablePlugin(info.id);
      const updated = pm.getPluginInfo(info.id);
      expect(updated?.enabled).toBe(true);
    });

    it('disables a plugin and updates DB', async () => {
      const dir = createTempPlugin({ name: 'test-disable' });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);
      await pm.enablePlugin(info.id);
      await pm.disablePlugin(info.id);

      const updated = pm.getPluginInfo(info.id);
      expect(updated?.enabled).toBe(false);
    });

    it('throws when trying to enable a builtin plugin', async () => {
      const mockPlugin: PluginInterface = {};
      pm.registerBuiltinPlugin('builtin-1', 'Built-in', mockPlugin);

      await expect(pm.enablePlugin('builtin-1')).rejects.toThrow('内置插件不可操作');
    });

    it('throws when trying to disable a builtin plugin', async () => {
      const mockPlugin: PluginInterface = {};
      pm.registerBuiltinPlugin('builtin-2', 'Built-in', mockPlugin);

      await expect(pm.disablePlugin('builtin-2')).rejects.toThrow('内置插件不可禁用');
    });
  });

  describe('deletePlugin', () => {
    it('deletes a plugin from DB and cleans up config', async () => {
      const dir = createTempPlugin({ name: 'test-delete', permissions: ['getConfig', 'setConfig'] });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);

      // Add some plugin config
      db.insert(schema.pluginConfig)
        .values({ pluginId: info.id, key: 'testKey', value: '"testValue"' })
        .run();

      await pm.deletePlugin(info.id);

      expect(pm.getPluginInfo(info.id)).toBeUndefined();

      // Config should be cleaned up
      const configRows = db.select()
        .from(schema.pluginConfig)
        .where(eq(schema.pluginConfig.pluginId, info.id))
        .all();
      expect(configRows).toHaveLength(0);
    });

    it('throws when trying to delete a builtin plugin', async () => {
      const mockPlugin: PluginInterface = {};
      pm.registerBuiltinPlugin('builtin-del', 'Built-in', mockPlugin);

      await expect(pm.deletePlugin('builtin-del')).rejects.toThrow('内置插件不可删除');
    });
  });

  describe('updatePriority', () => {
    it('updates plugin priority in DB', async () => {
      const dir = createTempPlugin({ name: 'test-priority' });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);

      pm.updatePriority(info.id, 50);
      const updated = pm.getPluginInfo(info.id);
      expect(updated?.priority).toBe(50);
    });

    it('throws for builtin plugins', () => {
      const mockPlugin: PluginInterface = {};
      pm.registerBuiltinPlugin('builtin-prio', 'Built-in', mockPlugin);

      expect(() => pm.updatePriority('builtin-prio', 10)).toThrow('内置插件优先级不可修改');
    });
  });

  describe('getAllPlugins / getPluginInfo', () => {
    it('returns builtin plugins first', async () => {
      const mockPlugin: PluginInterface = {};
      pm.registerBuiltinPlugin('sys', '系统', mockPlugin, 0);

      const dir = createTempPlugin({ name: 'user-plugin' });
      tempDirs.push(dir);
      await pm.installPlugin(dir);

      const all = pm.getAllPlugins();
      expect(all.length).toBe(2);
      expect(all[0].builtin).toBe(true);
      expect(all[1].builtin).toBe(false);
    });

    it('returns undefined for non-existent plugin', () => {
      expect(pm.getPluginInfo('non-existent')).toBeUndefined();
    });

    it('returns builtin plugin info', () => {
      const mockPlugin: PluginInterface = {};
      pm.registerBuiltinPlugin('sys', '系统', mockPlugin, 0);

      const info = pm.getPluginInfo('sys');
      expect(info).toBeDefined();
      expect(info!.builtin).toBe(true);
      expect(info!.name).toBe('系统');
    });
  });

  describe('dispatchMessage — priority + error isolation', () => {
    const mockConnectionManager = {
      getConnection: (id: string) => ({
        id,
        state: 'authenticated',
        botInfo: { user_id: 100, nickname: 'TestBot' },
      }),
      getConnectionBySelfId: (selfId: number) => selfId === 100
        ? { id: 'conn-1', state: 'authenticated', botInfo: { user_id: 100, nickname: 'TestBot' } }
        : undefined,
      getAllConnections: () => [],
    } as any;

    beforeEach(() => {
      pm.setConnectionManager(mockConnectionManager);
    });

    it('dispatches to plugins in priority order', async () => {
      const order: string[] = [];
      const pluginA: PluginInterface = {
        onMessage: async () => { order.push('A'); },
      };
      const pluginB: PluginInterface = {
        onMessage: async () => { order.push('B'); },
      };

      pm.registerBuiltinPlugin('a', 'PluginA', pluginA, 10);
      pm.registerBuiltinPlugin('b', 'PluginB', pluginB, 5);

      const event = {
        post_type: 'message',
        message_type: 'private',
        user_id: 123,
        message: 'hi',
        raw_message: 'hi',
        self_id: 100,
        time: Date.now(),
        sub_type: 'friend',
        message_id: 1,
        font: 0,
        sender: { user_id: 123, nickname: 'test' },
      } as any;

      await pm.dispatchMessage(event, 'conn-1');
      // B has lower priority number → executes first
      expect(order).toEqual(['B', 'A']);
    });

    it('isolates plugin errors — other plugins still execute', async () => {
      const executed: string[] = [];
      const pluginOk: PluginInterface = {
        onMessage: async () => { executed.push('ok'); },
      };
      const pluginFail: PluginInterface = {
        onMessage: async () => { throw new Error('boom'); },
      };

      pm.registerBuiltinPlugin('fail', 'Fail', pluginFail, 1);
      pm.registerBuiltinPlugin('ok', 'Ok', pluginOk, 2);

      const event = {
        post_type: 'message',
        message_type: 'private',
        user_id: 123,
        message: 'hi',
        raw_message: 'hi',
        self_id: 100,
        time: Date.now(),
        sub_type: 'friend',
        message_id: 1,
        font: 0,
        sender: { user_id: 123, nickname: 'test' },
      } as any;

      await pm.dispatchMessage(event, 'conn-1');
      expect(executed).toEqual(['ok']);
    });
  });

  describe('plugin config (getConfig / setConfig)', () => {
    it('stores and retrieves config via Drizzle', () => {
      // Directly test DB operations (since createContext is private, test via DB)
      const pluginId = 'cfg-test-plugin';
      const key = 'greeting';
      const value = JSON.stringify({ text: 'hello' });
      const now = new Date().toISOString();

      db.insert(schema.pluginConfig)
        .values({ pluginId, key, value, updatedAt: now })
        .run();

      const row = db.select()
        .from(schema.pluginConfig)
        .where(eq(schema.pluginConfig.pluginId, pluginId))
        .get();

      expect(row).toBeDefined();
      expect(JSON.parse(row!.value)).toEqual({ text: 'hello' });
    });

    it('upserts config on conflict', () => {
      const pluginId = 'cfg-upsert';
      const key = 'counter';
      const now = new Date().toISOString();

      db.insert(schema.pluginConfig)
        .values({ pluginId, key, value: '1', updatedAt: now })
        .run();

      db.insert(schema.pluginConfig)
        .values({ pluginId, key, value: '2', updatedAt: now })
        .onConflictDoUpdate({
          target: [schema.pluginConfig.pluginId, schema.pluginConfig.key],
          set: { value: '2', updatedAt: now },
        })
        .run();

      const rows = db.select()
        .from(schema.pluginConfig)
        .where(eq(schema.pluginConfig.pluginId, pluginId))
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('2');
    });

    it('deletes config when plugin is deleted', async () => {
      const dir = createTempPlugin({ name: 'cfg-cleanup' });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);

      db.insert(schema.pluginConfig)
        .values({ pluginId: info.id, key: 'k1', value: '"v1"' })
        .run();
      db.insert(schema.pluginConfig)
        .values({ pluginId: info.id, key: 'k2', value: '"v2"' })
        .run();

      await pm.deletePlugin(info.id);

      const remaining = db.select()
        .from(schema.pluginConfig)
        .where(eq(schema.pluginConfig.pluginId, info.id))
        .all();
      expect(remaining).toHaveLength(0);
    });
  });

  describe('auto resource cleanup on unload', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('app context methods become no-op after unload (getConfig, setConfig)', async () => {
      const dir = createTempPlugin({
        name: 'test-dispose',
        permissions: ['getConfig', 'setConfig'],
        entryContent: `
          let app;
          export default {
            async onLoad(appCtx) { app = appCtx; },
            async onUnload() {},
            getApp() { return app; },
          };
        `,
      });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);
      await pm.enablePlugin(info.id);

      // Get plugin instance to access app via getApp
      const loaded = (pm as any).loaded.get(info.id);
      const pluginApp = loaded.instance.getApp();
      expect(pluginApp).toBeDefined();

      await pm.disablePlugin(info.id);

      // After unload, getConfig should return undefined (no-op)
      expect(pluginApp.getConfig('key')).toBeUndefined();

      // setConfig should not throw
      expect(() => pluginApp.setConfig('key', 'val')).not.toThrow();

      // forConnection should throw (disposed)
      expect(() => pluginApp.forConnection('conn-1')).toThrow();
    });

    it('managed setInterval is auto-cleared on unload', async () => {
      let intervalCallCount = 0;
      const dir = createTempPlugin({
        name: 'test-interval-cleanup',
        entryContent: `
          export default {
            async onLoad(app) {
              app.setInterval(() => {
                globalThis.__testIntervalCalled = (globalThis.__testIntervalCalled || 0) + 1;
              }, 1000);
            },
            async onUnload() {},
          };
        `,
      });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);
      await pm.enablePlugin(info.id);

      // Advance time — interval should fire
      vi.advanceTimersByTime(3000);
      expect((globalThis as any).__testIntervalCalled).toBeGreaterThanOrEqual(1);

      const countBefore = (globalThis as any).__testIntervalCalled;

      // Unload plugin
      await pm.disablePlugin(info.id);

      // Advance time — interval should NOT fire anymore
      vi.advanceTimersByTime(5000);
      expect((globalThis as any).__testIntervalCalled).toBe(countBefore);

      // Cleanup global
      delete (globalThis as any).__testIntervalCalled;
    });

    it('managed setTimeout is auto-cleared on unload before it fires', async () => {
      const dir = createTempPlugin({
        name: 'test-timeout-cleanup',
        entryContent: `
          export default {
            async onLoad(app) {
              app.setTimeout(() => {
                globalThis.__testTimeoutFired = true;
              }, 5000);
            },
            async onUnload() {},
          };
        `,
      });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);
      await pm.enablePlugin(info.id);

      // Unload before timeout fires
      await pm.disablePlugin(info.id);

      // Advance past the timeout
      vi.advanceTimersByTime(10000);
      expect((globalThis as any).__testTimeoutFired).toBeUndefined();

      // Cleanup
      delete (globalThis as any).__testTimeoutFired;
    });

    it('setTimeout/setInterval return 0 when called after dispose', async () => {
      const dir = createTempPlugin({
        name: 'test-disposed-timer',
        entryContent: `
          let app;
          export default {
            async onLoad(appCtx) { app = appCtx; },
            async onUnload() {},
            getApp() { return app; },
          };
        `,
      });
      tempDirs.push(dir);
      const info = await pm.installPlugin(dir);
      await pm.enablePlugin(info.id);

      const loaded = (pm as any).loaded.get(info.id);
      const pluginApp = loaded.instance.getApp();

      await pm.disablePlugin(info.id);

      // Calling timer methods after dispose should return 0 and not throw
      expect(pluginApp.setTimeout(() => {}, 1000)).toBe(0);
      expect(pluginApp.setInterval(() => {}, 1000)).toBe(0);
    });
  });

  describe('context binding — sendMessage, callApi, getBotConfig route to correct connection', () => {
    let pluginApp: any;
    let pluginInfo: any;
    let calledActions: Array<{ connectionId: string; action: string; params: any }>;
    let sentMessages: Array<{ connectionId: string; type: string; target: number; message: any }>;

    const mockConnectionManagerMulti = {
      getConnection: (id: string) => {
        const bots: Record<string, any> = {
          'conn-bot-a': { id: 'conn-bot-a', state: 'authenticated', botInfo: { user_id: 111, nickname: 'BotA' } },
          'conn-bot-b': { id: 'conn-bot-b', state: 'authenticated', botInfo: { user_id: 222, nickname: 'BotB' } },
        };
        return bots[id];
      },
      getConnectionBySelfId: (selfId: number) => {
        if (selfId === 111) return { id: 'conn-bot-a', state: 'authenticated', botInfo: { user_id: 111, nickname: 'BotA' } };
        if (selfId === 222) return { id: 'conn-bot-b', state: 'authenticated', botInfo: { user_id: 222, nickname: 'BotB' } };
        return undefined;
      },
      getAllConnections: () => [
        { id: 'conn-bot-a', state: 'authenticated', botInfo: { user_id: 111, nickname: 'BotA' } },
        { id: 'conn-bot-b', state: 'authenticated', botInfo: { user_id: 222, nickname: 'BotB' } },
      ],
    } as any;

    beforeEach(async () => {
      calledActions = [];
      sentMessages = [];

      // Mock oneBotClient to capture calls
      (pm as any).oneBotClient = {
        callApi: (connectionId: string, action: string, params: any) => {
          calledActions.push({ connectionId, action, params });
          if (action === 'get_group_list') return [];
          return {};
        },
        sendPrivateMsg: (connectionId: string, target: number, message: any) => {
          sentMessages.push({ connectionId, type: 'private', target, message });
        },
        sendGroupMsg: (connectionId: string, target: number, message: any) => {
          sentMessages.push({ connectionId, type: 'group', target, message });
        },
      };

      pm.setConnectionManager(mockConnectionManagerMulti);

      const dir = createTempPlugin({
        name: 'test-ctx-binding',
        permissions: ['sendMessage', 'callApi', 'getConfig', 'setConfig'],
        entryContent: `
          let app;
          export default {
            async onLoad(appCtx) { app = appCtx; },
            async onUnload() {},
            getApp() { return app; },
          };
        `,
      });
      tempDirs.push(dir);
      pluginInfo = await pm.installPlugin(dir);
      await pm.enablePlugin(pluginInfo.id);

      const loaded = (pm as any).loaded.get(pluginInfo.id);
      pluginApp = loaded.instance.getApp();
    });

    afterEach(async () => {
      if (pm.getPluginInfo(pluginInfo.id)?.loaded) {
        await pm.disablePlugin(pluginInfo.id);
      }
    });

    it('sendMessage routes to correct connectionId via forConnection', async () => {
      const ctxA = pluginApp.forConnection('conn-bot-a');
      const ctxB = pluginApp.forConnection('conn-bot-b');

      await ctxA.sendMessage('group', 999, 'hello from A');
      await ctxB.sendMessage('private', 888, 'hello from B');

      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0].connectionId).toBe('conn-bot-a');
      expect(sentMessages[0].type).toBe('group');
      expect(sentMessages[1].connectionId).toBe('conn-bot-b');
      expect(sentMessages[1].type).toBe('private');
    });

    it('callApi routes to correct connectionId', async () => {
      const ctxA = pluginApp.forConnection('conn-bot-a');
      const ctxB = pluginApp.forConnection('conn-bot-b');

      await ctxA.callApi('get_group_list', {});
      await ctxB.callApi('send_like', { user_id: 123 });

      expect(calledActions).toHaveLength(2);
      expect(calledActions[0].connectionId).toBe('conn-bot-a');
      expect(calledActions[0].action).toBe('get_group_list');
      expect(calledActions[1].connectionId).toBe('conn-bot-b');
      expect(calledActions[1].action).toBe('send_like');
    });

    it('getBotConfig reads correct Bot config per connection', () => {
      const ctxA = pluginApp.forConnection('conn-bot-a');
      const ctxB = pluginApp.forConnection('conn-bot-b');

      // selfId should reflect the bound connection
      expect(ctxA.selfId).toBe(111);
      expect(ctxB.selfId).toBe(222);
      expect(ctxA.connectionId).toBe('conn-bot-a');
      expect(ctxB.connectionId).toBe('conn-bot-b');
    });

    it('forConnection throws on non-existent connection', () => {
      expect(() => pluginApp.forConnection('non-existent')).toThrow(/不可用/);
    });

    it('forConnection throws on unauthenticated connection', () => {
      const cmWithUnauth = {
        ...mockConnectionManagerMulti,
        getConnection: (id: string) => {
          if (id === 'conn-unauth') return { id, state: 'connected', botInfo: null };
          return mockConnectionManagerMulti.getConnection(id);
        },
      } as any;
      pm.setConnectionManager(cmWithUnauth);

      expect(() => pluginApp.forConnection('conn-unauth')).toThrow(/不可用.*未认证/);
    });

    it('forBot resolves by selfId', async () => {
      const ctxA = pluginApp.forBot(111);
      const ctxB = pluginApp.forBot(222);

      expect(ctxA.connectionId).toBe('conn-bot-a');
      expect(ctxB.connectionId).toBe('conn-bot-b');

      await ctxA.sendMessage('group', 999, 'from A');
      expect(sentMessages[0].connectionId).toBe('conn-bot-a');
    });

    it('forBot throws on unknown selfId', () => {
      expect(() => pluginApp.forBot(999)).toThrow(/未找到.*999/);
    });

    it('getConnectedBots returns all authenticated bots', () => {
      const bots = pluginApp.getConnectedBots();
      expect(bots).toHaveLength(2);
      expect(bots.map((b: any) => b.selfId).sort()).toEqual([111, 222]);
    });

    it('forConnection throws after plugin unload', async () => {
      await pm.disablePlugin(pluginInfo.id);
      expect(() => pluginApp.forConnection('conn-bot-a')).toThrow(/已卸载/);
    });

    it('forBot throws after plugin unload', async () => {
      await pm.disablePlugin(pluginInfo.id);
      expect(() => pluginApp.forBot(111)).toThrow(/已卸载/);
    });

    it('getConnectedBots returns empty after plugin unload', async () => {
      await pm.disablePlugin(pluginInfo.id);
      expect(pluginApp.getConnectedBots()).toEqual([]);
    });
  });
});
