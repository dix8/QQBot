// ==================== Plugin Types ====================

import type { MessageEvent, NoticeEvent, RequestEvent, MessageSegment } from './onebot.js';

export type PluginPermission = 'sendMessage' | 'callApi' | 'getConfig' | 'setConfig';

export interface PluginConfigItem {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: unknown;
  description?: string;
  options?: { label: string; value: string | number }[];
  required?: boolean;
  placeholder?: string;
  /** Custom editor component identifier (e.g. "scheduled-messages") */
  editor?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  repo?: string;
  entry: string;
  permissions?: PluginPermission[];
  configSchema?: PluginConfigItem[];
  commands?: PluginCommand[];
}

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ── Two-layer context model ──

/** App-level context provided to onLoad. Not bound to any Bot connection. */
export interface PluginAppContext {
  /** Plugin-scoped logger */
  logger: PluginLogger;
  /** Plugin data directory */
  dataDir: string;
  /** Get a plugin config value */
  getConfig(key: string): unknown;
  /** Set a plugin config value (persisted to database) */
  setConfig(key: string, value: unknown): void;
  /** Managed setTimeout — automatically cleared on plugin unload */
  setTimeout(callback: () => void, ms: number): number;
  /** Managed setInterval — automatically cleared on plugin unload */
  setInterval(callback: () => void, ms: number): number;
  /** Clear a managed timeout */
  clearTimeout(id: number): void;
  /** Clear a managed interval */
  clearInterval(id: number): void;
  /** Create an event context bound to a specific Bot connection. Throws if the connection is unavailable. */
  forConnection(connectionId: string): PluginEventContext;
  /** Create an event context bound to a Bot by its QQ number (self_id). Throws if no matching authenticated connection. */
  forBot(selfId: number): PluginEventContext;
  /** List all currently authenticated Bot connections. */
  getConnectedBots(): Array<{ connectionId: string; selfId: number }>;
}

/** Event-level context provided to onMessage/onNotice/onRequest. Bound to a specific Bot connection. */
export interface PluginEventContext {
  /** The connectionId this context is bound to */
  connectionId: string;
  /** The Bot's own QQ number (if available) */
  selfId?: number;
  /** Plugin-scoped logger */
  logger: PluginLogger;
  /** Plugin data directory */
  dataDir: string;
  /** Get a plugin config value */
  getConfig(key: string): unknown;
  /** Set a plugin config value (persisted to database) */
  setConfig(key: string, value: unknown): void;
  /** Get a bot-level config section for the bound Bot */
  getBotConfig(section: string): unknown;
  /** Call any OneBot V11 API action on the bound Bot */
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Send a message through the bound Bot */
  sendMessage(
    type: 'private' | 'group',
    target: number,
    message: MessageSegment[] | string,
  ): Promise<void>;
  /** Managed setTimeout — automatically cleared on plugin unload */
  setTimeout(callback: () => void, ms: number): number;
  /** Managed setInterval — automatically cleared on plugin unload */
  setInterval(callback: () => void, ms: number): number;
  /** Clear a managed timeout */
  clearTimeout(id: number): void;
  /** Clear a managed interval */
  clearInterval(id: number): void;
}

export interface PluginCommand {
  command: string;
  description: string;
  usage?: string;
  permission: 'all' | 'master' | 'super_admin';
  aliases?: string[];
}

export interface PluginInterface {
  onLoad?(app: PluginAppContext): Promise<void> | void;
  onUnload?(): Promise<void> | void;
  onMessage?(event: MessageEvent, ctx: PluginEventContext): Promise<void> | void;
  onNotice?(event: NoticeEvent, ctx: PluginEventContext): Promise<void> | void;
  onRequest?(event: RequestEvent, ctx: PluginEventContext): Promise<void> | void;
  getCommands?(): PluginCommand[];
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  entryFile: string;
  enabled: number;
  priority: number;
  permissions: string;
  configSchema: string;
  commands: string;
  installedAt: string;
  updatedAt: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  repo: string | null;
  enabled: boolean;
  priority: number;
  loaded: boolean;
  errorCount: number;
  installedAt: string;
  updatedAt: string;
  builtin: boolean;
  hasIcon: boolean;
  hasReadme: boolean;
  commands: PluginCommand[];
  permissions: PluginPermission[];
  configSchema: PluginConfigItem[];
}
