# QQBot 插件开发指南

## 概述

QQBot 插件系统允许开发者通过 TypeScript/JavaScript 模块扩展 Bot 功能。插件以 ZIP 包形式安装，通过注入的**两层上下文**与 Bot 交互：

- **`PluginAppContext`**（应用层上下文）：在 `onLoad` 时注入，不绑定任何 Bot 连接。用于访问配置、数据目录、日志、托管定时器，以及通过 `forConnection()` 创建事件上下文。
- **`PluginEventContext`**（事件层上下文）：在 `onMessage`/`onNotice`/`onRequest` 时注入，绑定到触发事件的特定 Bot 连接。用于发送消息、调用 API、读取 Bot 级配置。

插件的生命周期钩子调用会被 try-catch 包裹，异常不会影响核心系统或其他插件，但插件代码与主进程共享同一个 Node.js 运行时，不存在沙箱隔离。

> **安全警告**：插件在服务端 Node.js 进程中直接执行，拥有与主程序相同的文件系统、网络和系统权限。安装不受信任的插件等同于在服务器上运行未知代码。管理员应仅从可信来源安装插件，并在安装前审查插件代码。

## 快速开始

### 最小插件示例

```
my-plugin/
├── manifest.json
├── index.js          (入口文件，由 manifest.json 的 entry 字段指定)
├── modules/          (可选，子模块目录，避免单文件过大)
│   ├── utils.js
│   ├── commands.js
│   └── ...
├── icon.png          (可选，插件图标)
└── README.md         (可选，插件使用文档)
```

> **推荐实践**：当插件逻辑较复杂时，建议将不同功能的代码拆分到 `modules/` 子目录中，入口文件 `index.js` 通过 `import ... from './modules/xxx.js'` 引用。这样插件根目录只保留入口文件和元数据，保持目录整洁。

**manifest.json**

```json
{
  "id": "qqbot_plugin_hello",
  "name": "hello-plugin",
  "version": "1.0.0",
  "description": "一个简单的问候插件",
  "author": "Your Name",
  "repo": "https://github.com/yourname/qqbot-plugin-hello",
  "entry": "index.js",
  "permissions": ["sendMessage"],
  "commands": [
    { "command": "/hello", "description": "打个招呼", "permission": "all" }
  ]
}
```

**index.js**

```js
export default {
  async onLoad(app) {
    app.logger.info('Hello 插件已加载');
  },

  async onMessage(event, ctx) {
    if (event.raw_message?.trim() === '/hello') {
      const target = event.message_type === 'private' ? event.user_id : event.group_id;
      await ctx.sendMessage(event.message_type, target, `你好，${event.sender.nickname}！`);
    }
  },
};
```

打包为 ZIP → 在 Web 管理页面上传 → 启用 → 完成。

---

## manifest.json 规范

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 插件唯一标识符，必须以 `qqbot_plugin_` 开头，仅允许小写字母、数字和下划线。相同 id 的插件会覆盖安装 |
| `name` | string | 是 | 插件显示名称 |
| `version` | string | 是 | 语义化版本号 |
| `entry` | string | 是 | 入口文件路径（相对于插件根目录） |
| `description` | string | 否 | 插件描述 |
| `author` | string | 否 | 开发者名称 |
| `repo` | string | 否 | 仓库地址（如 GitHub URL），填写后插件卡片显示 GitHub 图标并可跳转 |
| `permissions` | string[] | 否 | 所需权限列表 |
| `configSchema` | PluginConfigItem[] | 否 | 配置项声明，用于 Web UI 自动渲染配置表单 |
| `commands` | PluginCommand[] | 否 | 指令声明，安装时持久化到 DB，插件未加载也可展示 |

---

## 权限系统

插件必须在 `manifest.json` 中声明所需权限，未声明的权限调用时会抛出异常。

| 权限 | 说明 |
|------|------|
| `sendMessage` | 通过 Bot 发送私聊/群聊消息 |
| `callApi` | 调用 OneBot V11 API（如获取群列表、禁言等） |
| `getConfig` | 读取插件配置值和 Bot 级配置 |
| `setConfig` | 写入插件配置值（持久化到数据库） |

```json
{
  "permissions": ["sendMessage", "getConfig", "setConfig"]
}
```

---

## 插件生命周期

```
安装 (upload ZIP)
  ↓
数据库记录创建（默认禁用）
  ↓
启用 → loadPlugin() → onLoad(app: PluginAppContext)
  ↓
接收事件 → onMessage(event, ctx) / onNotice(event, ctx) / onRequest(event, ctx)
              ctx: PluginEventContext（绑定到触发事件的 Bot 连接）
  ↓
禁用/删除 → onUnload() → 系统自动清理（托管定时器清除、Context 失效）
```

### 生命周期钩子

```typescript
interface PluginInterface {
  /** 插件加载时调用，接收 PluginAppContext（不绑定 Bot 连接） */
  onLoad?(app: PluginAppContext): Promise<void> | void;

  /** 插件卸载时调用，用于自定义清理（如关闭第三方连接）。托管定时器由系统自动清除 */
  onUnload?(): Promise<void> | void;

  /** 收到消息事件（私聊/群聊），ctx 绑定到触发事件的 Bot 连接 */
  onMessage?(event: MessageEvent, ctx: PluginEventContext): Promise<void> | void;

  /** 收到通知事件（群成员变动、撤回等） */
  onNotice?(event: NoticeEvent, ctx: PluginEventContext): Promise<void> | void;

  /** 收到请求事件（加好友/加群请求） */
  onRequest?(event: RequestEvent, ctx: PluginEventContext): Promise<void> | void;

  /** @deprecated 推荐在 manifest.json 中声明 commands，运行时覆盖仍可用 */
  getCommands?(): PluginCommand[];
}
```

所有钩子均为可选。入口文件需导出符合 `PluginInterface` 的对象（`export default`）。

---

## 两层上下文模型

### PluginAppContext（应用层）

`onLoad(app)` 时注入。不绑定任何 Bot 连接，用于插件级操作。

```typescript
interface PluginAppContext {
  /** 插件专属日志器 */
  logger: PluginLogger;
  /** 插件专属数据目录 */
  dataDir: string;
  /** 读取插件配置 */
  getConfig(key: string): unknown;
  /** 写入插件配置（持久化到数据库） */
  setConfig(key: string, value: unknown): void;
  /** 托管 setTimeout */
  setTimeout(callback: () => void, ms: number): number;
  /** 托管 setInterval */
  setInterval(callback: () => void, ms: number): number;
  /** 清除托管 setTimeout */
  clearTimeout(id: number): void;
  /** 清除托管 setInterval */
  clearInterval(id: number): void;
  /** 创建绑定到指定 Bot 连接的事件上下文 */
  forConnection(connectionId: string): PluginEventContext;
  /** 按 QQ 号创建绑定到指定 Bot 的事件上下文 */
  forBot(selfId: number): PluginEventContext;
  /** 获取所有已认证的 Bot 连接列表 */
  getConnectedBots(): Array<{ connectionId: string; selfId: number }>;
}
```

**注意**：`PluginAppContext` **没有** `sendMessage`、`callApi`、`getBotConfig`。这些操作需要明确的 Bot 连接，使用 `app.forConnection(connectionId)` 或 `app.forBot(selfId)` 获取事件上下文后调用。

### PluginEventContext（事件层）

`onMessage(event, ctx)` / `onNotice(event, ctx)` / `onRequest(event, ctx)` 时注入。绑定到触发事件的特定 Bot 连接。

```typescript
interface PluginEventContext {
  /** 绑定的连接 ID */
  connectionId: string;
  /** Bot 自身 QQ 号（如果可用） */
  selfId?: number;
  /** 插件专属日志器 */
  logger: PluginLogger;
  /** 插件专属数据目录 */
  dataDir: string;
  /** 读取插件配置 */
  getConfig(key: string): unknown;
  /** 写入插件配置 */
  setConfig(key: string, value: unknown): void;
  /** 读取 Bot 级配置（只读） */
  getBotConfig(section: string): unknown;
  /** 调用 OneBot V11 API */
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
  /** 发送消息 */
  sendMessage(type: 'private' | 'group', target: number, message: string | MessageSegment[]): Promise<void>;
  /** 托管 setTimeout */
  setTimeout(callback: () => void, ms: number): number;
  /** 托管 setInterval */
  setInterval(callback: () => void, ms: number): number;
  /** 清除托管 setTimeout */
  clearTimeout(id: number): void;
  /** 清除托管 setInterval */
  clearInterval(id: number): void;
}
```

### 上下文使用模式

**事件处理（推荐）**：直接使用 `ctx` 参数。

```js
async onMessage(event, ctx) {
  // ctx 已绑定到触发事件的 Bot 连接
  await ctx.sendMessage('group', event.group_id, '收到！');
  const groups = await ctx.callApi('get_group_list');
  const basic = ctx.getBotConfig('basic');
}
```

**非事件场景（如定时任务）**：需要显式获取 Bot 连接。推荐使用 `forBot(selfId)` 按 QQ 号指定，或 `getConnectedBots()` 动态选择。

```js
let app;

export default {
  async onLoad(appCtx) {
    app = appCtx;

    app.setInterval(async () => {
      // 方式一：按 QQ 号指定 Bot
      try {
        const ctx = app.forBot(123456789);
        await ctx.sendMessage('group', 123456, '定时消息');
      } catch (err) {
        app.logger.warn(`定时发送失败: ${err.message}`);
      }

      // 方式二：自动选择（仅单 Bot 时生效）
      const bots = app.getConnectedBots();
      if (bots.length === 1) {
        const ctx = app.forConnection(bots[0].connectionId);
        await ctx.sendMessage('group', 123456, '定时消息');
      }
    }, 60000);
  },
};
```

> **重要**：`forConnection()` 和 `forBot()` 会校验连接是否存在且已认证，不满足时抛出异常。框架不提供"第一个可用连接"的隐式回退——多 Bot 场景下由插件自行决定使用哪个连接（通过配置 `self_id` 或 `getConnectedBots()` 列举）。

---

## sendMessage

发送消息，需要 `sendMessage` 权限。仅在 `PluginEventContext` 上可用。

```typescript
await ctx.sendMessage(
  type: 'private' | 'group',
  target: number,        // user_id 或 group_id
  message: string | MessageSegment[]
);
```

### callApi

调用任意 OneBot V11 API，需要 `callApi` 权限。仅在 `PluginEventContext` 上可用。

```typescript
// 获取群列表
const groups = await ctx.callApi('get_group_list');

// 获取群成员信息
const member = await ctx.callApi('get_group_member_info', {
  group_id: 123456789,
  user_id: 987654321
});

// 群禁言（duration 秒，0 为解除）
await ctx.callApi('set_group_ban', {
  group_id: 123456789,
  user_id: 987654321,
  duration: 1800
});

// 踢出群成员
await ctx.callApi('set_group_kick', {
  group_id: 123456789,
  user_id: 987654321,
  reject_add_request: false
});

// 处理加好友请求
await ctx.callApi('set_friend_add_request', {
  flag: event.flag,
  approve: true
});

// 处理加群请求
await ctx.callApi('set_group_add_request', {
  flag: event.flag,
  sub_type: 'add',
  approve: true
});
```

完整 API 列表参考 [OneBot V11 文档](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)。

### getConfig / setConfig

读写插件配置，需要对应权限。值会 JSON 序列化后持久化到数据库。在 `PluginAppContext` 和 `PluginEventContext` 上均可用。

```typescript
// 读取（返回 undefined 如果未设置）
const apiKey = ctx.getConfig('apiKey') as string;
const count = ctx.getConfig('counter') as number ?? 0;

// 写入
ctx.setConfig('counter', count + 1);
ctx.setConfig('lastRun', new Date().toISOString());
```

### getBotConfig

读取 Bot 级别的配置（只读），需要 `getConfig` 权限。仅在 `PluginEventContext` 上可用，因为需要知道读取哪个 Bot 的配置。

```typescript
// 读取绑定 Bot 的基础配置
const basic = ctx.getBotConfig('basic');
// basic.masterQQ — 主人 QQ 号列表
// basic.nickname — Bot 昵称

// 读取超级管理员列表
const superAdmins = ctx.getBotConfig('superAdmins');
```

### logger

插件专属日志器，日志会显示在 Web 管理页面的日志模块中。在两层上下文上均可用。

```typescript
ctx.logger.debug('调试信息');
ctx.logger.info('一般信息');
ctx.logger.warn('警告信息');
ctx.logger.error('错误信息');
```

### dataDir

插件专属数据目录（自动创建），路径为 `data/plugins/{pluginId}/data/`。在两层上下文上均可用。

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const dataFile = join(ctx.dataDir, 'state.json');
if (existsSync(dataFile)) {
  const state = JSON.parse(readFileSync(dataFile, 'utf-8'));
}
```

### setTimeout / setInterval（托管定时器）

使用托管定时器代替全局的 `setTimeout`/`setInterval`。插件卸载时系统会**自动清除**所有托管定时器。在两层上下文上均可用，共享同一个定时器池。

```typescript
// 在 onLoad 中使用 app 上下文
async onLoad(app) {
  app.setInterval(() => {
    app.logger.info('心跳');
  }, 60000);
}

// 在事件处理中使用 ctx
async onMessage(event, ctx) {
  ctx.setTimeout(() => {
    ctx.logger.info('延迟处理');
  }, 5000);
}
```

> **重要**：始终使用托管定时器而非全局 `setTimeout` / `setInterval`。全局定时器在插件卸载后仍会继续执行，可能导致内存泄漏和意外行为。

### Context 自动失效

插件卸载后，上下文方法的行为分为两类：

**安全空操作（no-op）**：`sendMessage`、`callApi`、`getConfig`、`getBotConfig`、`setConfig`、`getConnectedBots`、定时器方法（`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`）。调用时静默忽略并记录一条警告日志，不抛出异常。

**抛出异常**：`forConnection()`、`forBot()`。因为返回值是 `PluginEventContext`，调用者通常会立即使用，空操作会导致难以排查的 `undefined` 错误。卸载后调用会抛出 `Error`，建议用 `try/catch` 包裹。

`logger` 和 `dataDir` **不受影响**，`onUnload` 中仍可正常使用。

这意味着即使插件开发者忘记在 `onUnload` 中清理资源，系统也会兜底处理：
- 托管定时器自动清除
- 残留回调中的 `ctx.sendMessage()` 等调用安全忽略
- `forConnection()` / `forBot()` 抛出异常，阻止在已卸载状态创建新的事件上下文

---

## 事件类型

### MessageEvent（消息事件）

```typescript
// 私聊消息
interface PrivateMessageEvent {
  post_type: 'message';
  message_type: 'private';
  sub_type: 'friend' | 'group' | 'other';
  message_id: number;
  user_id: number;
  message: MessageSegment[] | string;
  raw_message: string;          // 纯文本内容
  sender: {
    user_id: number;
    nickname: string;
    sex?: 'male' | 'female' | 'unknown';
    age?: number;
  };
  time: number;
  self_id: number;
}

// 群聊消息
interface GroupMessageEvent {
  post_type: 'message';
  message_type: 'group';
  sub_type: 'normal' | 'anonymous' | 'notice';
  message_id: number;
  group_id: number;
  user_id: number;
  message: MessageSegment[] | string;
  raw_message: string;
  sender: {
    user_id: number;
    nickname: string;
    card?: string;              // 群名片
    role?: 'owner' | 'admin' | 'member';
    title?: string;             // 专属头衔
  };
  time: number;
  self_id: number;
}
```

### NoticeEvent（通知事件）

```typescript
interface NoticeEvent {
  post_type: 'notice';
  notice_type: string;    // group_increase, group_decrease, group_admin, friend_add ...
  sub_type?: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  time: number;
  self_id: number;
}
```

### RequestEvent（请求事件）

```typescript
// 加好友请求
interface FriendRequestEvent {
  post_type: 'request';
  request_type: 'friend';
  user_id: number;
  comment: string;
  flag: string;           // 用于 approve/reject
  time: number;
  self_id: number;
}

// 加群请求/邀请
interface GroupRequestEvent {
  post_type: 'request';
  request_type: 'group';
  sub_type: 'add' | 'invite';
  group_id: number;
  user_id: number;
  comment: string;
  flag: string;
  time: number;
  self_id: number;
}
```

---

## 消息段（MessageSegment）

发送富文本消息时使用消息段数组：

```typescript
type MessageSegment =
  | { type: 'text';    data: { text: string } }
  | { type: 'face';    data: { id: string } }                    // QQ 表情
  | { type: 'image';   data: { file: string; url?: string } }    // 图片
  | { type: 'record';  data: { file: string; url?: string } }    // 语音
  | { type: 'at';      data: { qq: string | 'all' } }            // @某人 / @全体
  | { type: 'reply';   data: { id: string } }                    // 回复
  | { type: 'forward'; data: { id: string } }                    // 合并转发
  | { type: 'json';    data: { data: string } }                  // JSON 消息
  | { type: 'xml';     data: { data: string } }                  // XML 消息
```

**示例：发送带 @ 的消息**

```typescript
await ctx.sendMessage('group', groupId, [
  { type: 'at', data: { qq: String(event.user_id) } },
  { type: 'text', data: { text: ' 你好！' } }
]);
```

**示例：发送图片**

```typescript
await ctx.sendMessage('group', groupId, [
  { type: 'image', data: { file: 'https://example.com/image.png' } }
]);
```

---

## 指令注册

在 `manifest.json` 中声明 `commands` 字段，安装时持久化到数据库。即使插件未加载，指令也会在 Web 管理页面和 `/帮助` 指令中展示。

```json
{
  "commands": [
    { "command": "/天气", "description": "查询天气", "usage": "/天气 <城市>", "permission": "all" },
    { "command": "/禁言", "description": "禁言群成员", "usage": "/禁言 <QQ号> <秒数>", "permission": "master" },
    { "command": "/帮助", "description": "显示帮助", "permission": "all", "aliases": ["/help", "/h"] }
  ]
}
```

```typescript
interface PluginCommand {
  command: string;                  // 指令名，如 '/天气'
  description: string;              // 指令说明
  usage?: string;                   // 用法示例，如 '/天气 <城市>'
  permission: 'all' | 'master' | 'super_admin';  // all=所有人可用, master=仅主人, super_admin=仅超级管理员
  aliases?: string[];               // 别名列表，同一功能的其他触发指令
}
```

> 注意：指令注册仅用于展示，实际的指令匹配和处理逻辑需要在 `onMessage` 中自行实现。

### 指令别名

同一功能有多个触发指令（如中英文版本）时，使用 `aliases` 字段声明别名，而非注册多条相同指令。Web 管理页面会将别名折叠显示，默认只展示主指令，点击展开可查看所有别名。

```json
{
  "commands": [
    { "command": "/帮助", "description": "显示帮助", "permission": "all", "aliases": ["/help"] },
    { "command": "/状态", "description": "查看状态", "permission": "all", "aliases": ["/status"] }
  ]
}
```

> 兼容说明：未使用 `aliases` 的旧插件，如果多条指令的 description 和 permission 完全相同，前端会自动将它们分组折叠。

### 运行时覆盖（高级）

如果插件需要在运行时动态生成指令列表，仍可实现 `getCommands()` 方法。当插件已加载且实现了 `getCommands()`，其返回值会覆盖 manifest 中声明的指令。推荐优先使用 manifest 声明。

### 指令自动检测

安装插件时，系统会自动扫描入口文件源码，检测代码中使用的指令及其权限要求。即使不在 `manifest.json` 中声明 `commands`，系统也能识别并展示指令。

**支持检测的匹配模式：**

```js
// 1. 等值比较
if (text === '/ping') { ... }
if (raw === '/help') { ... }

// 2. 前缀匹配
if (text.startsWith('/echo')) { ... }

// 3. switch/case
switch (text) {
  case '/ping': ...
  case '/info': ...
}
```

**权限自动识别：**

系统会检查指令处理代码中是否包含权限相关逻辑（如 `isMaster`、`masterQQ`、`权限不足` 等），自动设置为 `master` 权限；未检测到权限检查的指令默认为 `all`。`super_admin` 权限无法自动检测，需在 manifest 中显式声明。

**合并规则：**

manifest 中声明的指令优先级高于源码检测。对于同一指令，若 manifest 已声明，则使用 manifest 的全部字段值；源码检测仅补充 manifest 中未覆盖的指令。

| 来源 | description | usage | permission |
|------|-------------|-------|------------|
| manifest 声明 | manifest 值 | manifest 值 | manifest 值优先 |
| 源码检测（未在 manifest 中声明） | 空（页面显示"未设置描述"） | 无 | 源码检测结果 |

**已知局限：**

- 动态拼接的指令（如 `'/' + name`）无法检测，需在 manifest 中手动声明
- 指令仅在安装时检测，已安装的旧插件需重新安装才能触发自动检测
- 注释中的指令字符串极少数情况下可能被误检测

---

## 配置系统（configSchema）

在 `manifest.json` 中声明 `configSchema`，Web 管理页面会自动渲染配置表单。

### 支持的配置项类型

| type | 渲染控件 | 说明 |
|------|---------|------|
| `string` | 文本输入框 | 字符串配置 |
| `number` | 数字输入框 | 数值配置 |
| `boolean` | 开关 | 布尔开关 |
| `select` | 下拉选择 | 需配合 `options` 使用 |

### 配置项字段

```typescript
interface PluginConfigItem {
  key: string;           // 配置键名，对应 getConfig(key)
  label: string;         // 显示名称
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: unknown;     // 默认值
  description?: string;  // 说明文字
  options?: { label: string; value: string | number }[];  // type=select 时必填
  required?: boolean;    // 是否必填（UI 提示用）
  placeholder?: string;  // 输入框占位文字
  editor?: string;       // 自定义编辑器组件标识（见下方说明）
}
```

### 自定义编辑器（editor 字段）

对于复杂配置项（如 JSON 数组），可通过 `editor` 字段指定前端使用的自定义编辑器组件，替代默认的文本输入框。

目前内置支持的 editor 值：

| editor 值 | 说明 |
|-----------|------|
| `scheduled-messages` | 定时消息可视化编辑器，支持每日定时和 Cron 表达式两种模式，支持多群广播（`all` 表示所有启用群）、多条随机消息、可视化/代码双模式切换 |

示例：

```json
{
  "key": "scheduledMessages",
  "label": "定时消息配置",
  "type": "string",
  "default": "[]",
  "editor": "scheduled-messages"
}
```

未识别的 `editor` 值会回退到默认的文本输入框。

### 完整示例

```json
{
  "id": "qqbot_plugin_weather",
  "name": "weather-plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "permissions": ["sendMessage", "getConfig", "setConfig"],
  "configSchema": [
    {
      "key": "apiKey",
      "label": "天气 API Key",
      "type": "string",
      "description": "从 weather.com 获取的 API 密钥",
      "required": true,
      "placeholder": "请输入 API Key"
    },
    {
      "key": "unit",
      "label": "温度单位",
      "type": "select",
      "default": "celsius",
      "options": [
        { "label": "摄氏度 (°C)", "value": "celsius" },
        { "label": "华氏度 (°F)", "value": "fahrenheit" }
      ]
    },
    {
      "key": "cacheMinutes",
      "label": "缓存时间（分钟）",
      "type": "number",
      "default": 30,
      "description": "天气数据缓存时长"
    },
    {
      "key": "autoReport",
      "label": "自动播报",
      "type": "boolean",
      "default": false,
      "description": "每天早上自动发送天气预报"
    }
  ]
}
```

用户在 Web 页面修改配置后，插件通过 `ctx.getConfig(key)` 即可读取最新值。

---

## 错误处理与隔离

- 插件的生命周期钩子（`onMessage`、`onNotice`、`onRequest`）调用被 try-catch 包裹，单次异常不会影响其他插件或核心系统
- 注意：插件与主进程共享同一个 Node.js 运行时，不存在 VM 沙箱隔离。插件可以访问 `process`、`fs` 等全局对象，请仅安装可信插件
- 连续错误达到 **5 次**，插件会被自动禁用，并记录日志
- 每次成功处理事件后错误计数归零
- 建议在关键操作处使用 try-catch：

```typescript
async onMessage(event, ctx) {
  try {
    const result = await ctx.callApi('get_group_info', { group_id: 123 });
    // ...
  } catch (err) {
    ctx.logger.error(`API 调用失败: ${err}`);
  }
}
```

---

## 插件优先级

- 默认优先级为 **100**，数值越小越先执行
- 多个插件监听同一事件时，按优先级顺序依次调用
- 可在 Web 管理页面调整优先级
- 某个插件报错不影响后续插件的执行

---

## 完整插件示例：关键词自动回复

```json
{
  "id": "qqbot_plugin_keyword_reply",
  "name": "keyword-reply",
  "version": "1.0.0",
  "description": "关键词自动回复插件",
  "author": "Dev",
  "entry": "index.js",
  "permissions": ["sendMessage", "getConfig", "setConfig"],
  "commands": [
    { "command": "你好", "description": "问候回复", "permission": "all" },
    { "command": "菜单", "description": "查看功能菜单", "permission": "all" }
  ],
  "configSchema": [
    {
      "key": "replyPrivate",
      "label": "私聊回复",
      "type": "boolean",
      "default": true,
      "description": "是否在私聊中也触发回复"
    }
  ]
}
```

```js
const KEYWORDS = {
  '你好': '你好呀～有什么可以帮你的吗？',
  '再见': '下次再见！',
  '菜单': '可用功能：\n1. 问候\n2. 天气查询\n3. 帮助',
};

export default {
  async onLoad(app) {
    app.logger.info(`关键词回复插件已加载，共 ${Object.keys(KEYWORDS).length} 条规则`);
  },

  async onMessage(event, ctx) {
    const text = event.raw_message?.trim();
    if (!text) return;

    // 检查是否启用私聊回复
    if (event.message_type === 'private') {
      const replyPrivate = ctx.getConfig('replyPrivate');
      if (replyPrivate === false) return;
    }

    const reply = KEYWORDS[text];
    if (!reply) return;

    const target = event.message_type === 'private' ? event.user_id : event.group_id;
    await ctx.sendMessage(event.message_type, target, reply);
  },
};
```

---

## 打包与安装

1. 确保插件根目录包含 `manifest.json` 和入口文件
2. （可选）放置 `icon.png` 作为插件图标，建议尺寸 128×128 或 256×256 像素
3. （可选）放置 `README.md` 编写插件使用文档，支持标准 Markdown 语法
4. 将插件目录打包为 ZIP（manifest.json 在 ZIP 根层级）
4. 在 Web 管理页面「插件管理」→「上传插件」
5. 上传后插件默认禁用，手动开启即可

```
# 打包示例
cd my-plugin
zip -r ../my-plugin.zip .
```

---

## Web 管理 API

插件管理相关的 REST API（需登录鉴权）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 获取所有插件列表 |
| GET | `/api/plugins/:id` | 获取插件详情 |
| GET | `/api/plugins/:id/icon` | 获取插件图标（PNG，无需鉴权） |
| GET | `/api/plugins/:id/readme` | 获取插件文档（纯文本 Markdown） |
| POST | `/api/plugins/upload` | 上传安装插件（multipart/form-data） |
| POST | `/api/plugins/:id/enable` | 启用插件 |
| POST | `/api/plugins/:id/disable` | 禁用插件 |
| POST | `/api/plugins/reload` | 重载所有插件（清除缓存，重新读取 manifest 和源码） |
| PUT | `/api/plugins/:id/priority` | 更新优先级 `{ priority: number }` |
| DELETE | `/api/plugins/:id` | 删除插件 |
| GET | `/api/plugins/:id/config` | 获取配置 schema + 当前值 |
| PUT | `/api/plugins/:id/config` | 保存配置 `{ values: Record<string, unknown> }` |

---

## 内置指令参考

系统内置插件提供以下指令：

| 指令 | 说明 | 权限 |
|------|------|------|
| `/帮助` `/help` | 显示可用指令列表 | 所有人 |
| `/状态` `/status` | 查看系统运行状态（运行时长、内存、连接数） | 所有人 |
| `/关于` `/about` | 查看当前 Bot 信息 | 所有人 |
| `/昵称` | 查看/设置 Bot 昵称 | 主人 |
| `/主人列表` | 列出所有主人 QQ | 主人 |
| `/添加主人 <QQ号>` | 添加主人 | 超级管理员 |
| `/删除主人 <QQ号>` | 删除主人 | 超级管理员 |
| `/插件列表` | 查看已安装插件及状态 | 超级管理员 |
| `/启用插件 <序号或ID>` | 启用指定插件 | 超级管理员 |
| `/禁用插件 <序号或ID>` | 禁用指定插件 | 超级管理员 |

---

## 预装示例插件

系统自带一个「示例插件」，首次启动时自动安装（默认禁用），覆盖所有插件能力作为开发参考。

### 与内置插件的区别

| | 内置插件（系统管理） | 预装插件（示例插件） |
|---|---|---|
| 注册方式 | `registerBuiltinPlugin()` | `installPlugin()` 正常安装 |
| 可禁用 | 否 | 是 |
| 可删除 | 否 | 是（删除后重启不会重新安装） |
| 存储位置 | 仅内存 | DB + 磁盘 `data/plugins/{id}/` |

### 示例插件功能

| 指令 | 说明 | 演示能力 |
|------|------|---------|
| `/ping` | 回复 pong | 基础消息发送 |
| `/echo <内容>` | 复读消息 | configSchema 控制模式和长度 |
| `/info` | 查看 Bot 信息 | callApi（get_login_info） |
| `/time` | 当前时间 + 调用次数 | dataDir 文件读写 |
| `赞我` / `赞` | 给发送者名片点赞 | callApi（send_like） |
| `/签到` | 每日签到（群聊） | dataDir 持久化（checkin.json） |
| `/签到排行` | 本群签到排行 | 数据聚合与排序 |
| `/禁言` `/解禁` `/踢` | 群管理操作 | callApi（set_group_ban 等）+ getBotConfig 权限检查 |
| `/全员禁言` `/解除全员禁言` | 全员禁言控制 | callApi（set_group_whole_ban） |
| `/群名片` | 设置群成员名片 | callApi（set_group_card）+ AT 目标提取 |

此外还演示了：
- `onNotice`：覆盖全部 OneBot V11 通知事件（群成员增减、管理员变动、禁言、撤回、戳一戳、荣誉变更、运气王、群文件上传、好友添加），均有 configSchema 开关控制
- `onMessage`：复读检测（追踪群内连续相同消息，达到阈值自动跟读）
- `getBotConfig`：读取 Bot 基础配置（masterQQ 列表），实现主人权限检查
- `commands`：在 manifest.json 中声明所有指令
- `onLoad(app)` / `onUnload()`：生命周期日志 + 签到数据加载
- 托管定时器：心跳 + 定时消息调度器（`app.setInterval`，卸载时系统自动清除）
- `app.forBot()` / `app.getConnectedBots()`：定时任务通过任务配置的 `self_id` 确定性选择 Bot 连接，无 `self_id` 时在单 Bot 环境自动选择

### 预安装机制

预装插件源码位于 `server/src/plugins/preinstalled/` 目录。启动时 `installPreinstalledPlugins()` 扫描该目录：

1. 读取子目录的 `manifest.json` 获取插件名
2. 检查 `botConfig` 表中是否存在 `preinstalled:{name}` 标记
3. 不存在 → 调用 `installPlugin()` 安装，写入标记
4. 已存在 → 跳过（用户可能已删除，尊重用户选择）

---

## 插件图标

在插件根目录放置 `icon.png` 文件即可为插件添加自定义图标，该图标会在 Web 管理页面的插件列表中显示。

- **文件名**：必须为 `icon.png`
- **格式**：PNG
- **建议尺寸**：128×128 或 256×256 像素（会被缩放至 40×40 显示）
- **无图标时**：显示默认的拼图图标

图标通过 `GET /api/plugins/:id/icon` 端点访问，该端点无需鉴权，响应带有 1 小时缓存头。

---

## 插件文档（README.md）

在插件根目录放置 `README.md` 文件即可为插件添加使用文档。如果检测到该文件，Web 管理页面的插件卡片上会显示「文档」按钮，点击后弹窗展示渲染后的 Markdown 内容。

- **文件名**：必须为 `README.md`
- **格式**：标准 Markdown（支持标题、列表、代码块、表格、链接等）
- **无文档时**：不显示「文档」按钮
- **渲染方式**：前端使用 `marked` 库将 Markdown 转为 HTML 展示

文档通过 `GET /api/plugins/:id/readme` 端点访问，需要登录鉴权。
