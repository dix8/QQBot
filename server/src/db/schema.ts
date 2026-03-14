import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isDefaultPwd: integer('is_default_pwd').notNull().default(1),
  tokenVersion: integer('token_version').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const botConfig = sqliteTable('bot_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  level: text('level').notNull(),
  source: text('source').notNull(),
  message: text('message').notNull(),
  details: text('details'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('logs_level_created_idx').on(table.level, table.createdAt),
  index('logs_source_created_idx').on(table.source, table.createdAt),
]);

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  version: text('version').notNull(),
  description: text('description'),
  author: text('author'),
  repo: text('repo'),
  entryFile: text('entry_file').notNull(),
  enabled: integer('enabled').notNull().default(0),
  priority: integer('priority').notNull().default(100),
  permissions: text('permissions').notNull().default('[]'),
  configSchema: text('config_schema').notNull().default('[]'),
  commands: text('commands').notNull().default('[]'),
  installedAt: text('installed_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const pluginConfig = sqliteTable('plugin_config', {
  pluginId: text('plugin_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.pluginId, table.key] }),
]);

export const messageStats = sqliteTable('message_stats', {
  hour: text('hour').primaryKey(),
  received: integer('received').notNull().default(0),
  sent: integer('sent').notNull().default(0),
});

export const messageRankings = sqliteTable('message_rankings', {
  type: text('type').notNull(),
  targetId: integer('target_id').notNull(),
  count: integer('count').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.type, table.targetId] }),
]);

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  target: text('target'),
  detail: text('detail'),
  username: text('username'),
  ip: text('ip'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('audit_action_created_idx').on(table.action, table.createdAt),
]);

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: integer('bot_id'),
  messageId: integer('message_id'),
  messageType: text('message_type').notNull(),
  groupId: integer('group_id'),
  userId: integer('user_id').notNull(),
  nickname: text('nickname'),
  rawMessage: text('raw_message'),
  time: integer('time').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('messages_bot_idx').on(table.botId),
  index('messages_type_group_idx').on(table.messageType, table.groupId),
  index('messages_time_idx').on(table.time),
]);

export const bots = sqliteTable('bots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  selfId: integer('self_id'),
  wsHost: text('ws_host').notNull().default('127.0.0.1'),
  wsPort: integer('ws_port').notNull().default(8095),
  wsToken: text('ws_token').notNull().default(''),
  enabled: integer('enabled').notNull().default(1),
  remark: text('remark').notNull().default(''),
  description: text('description').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  sentMessageCount: integer('sent_message_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
