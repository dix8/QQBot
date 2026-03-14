# QQBot Web Manager

QQ 机器人 Web 管理面板 — 通过反向 WebSocket 连接 [NapCat](https://github.com/NapNeko/NapCatQQ)，提供可视化配置、消息管理与插件扩展能力。

## 功能特性

- **反向 WebSocket 通信** — 作为 WebSocket 服务端接收 NapCat 连接，遵循 [OneBot V11](https://github.com/botuniverse/onebot-11) 协议
- **多 Bot 管理** — 支持同时管理多个 QQ Bot 实例，独立配置
- **Web 管理面板** — 响应式设计，支持 PC 与移动端访问
- **数据面板** — 消息收发统计、24 小时趋势图、活跃群组/用户 Top5
- **插件系统** — ZIP 格式热安装，支持生命周期钩子、声明式权限、配置 UI 自动渲染、托管定时器自动清理、一键重载
- **权限体系** — 三级权限（超级管理员 > 主人 > 所有人），QQ 指令权限精细控制
- **消息过滤** — 用户黑名单、群组黑白名单、在线时段限制、消息频率限制
- **群管理** — 可视化群列表，按群开关指令响应，支持批量启用/禁用
- **自动审批** — 好友请求自动同意、入群邀请自动同意（系统级配置）
- **QQ 指令配置** — 通过 QQ 聊天直接管理 Bot 配置（自动回复、黑名单、群过滤、在线时段等）
- **日志系统** — 连接日志、运行日志、插件日志，支持筛选搜索与自动刷新
- **登录鉴权** — 账号密码 + JWT 认证
- **多种部署** — Docker 单容器一键部署 / Windows 便携包解压即用（无需安装 Node.js）

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Shadcn-vue + Tailwind CSS + Pinia |
| 后端 | Node.js + TypeScript + Fastify + ws |
| 数据库 | SQLite (better-sqlite3 + Drizzle ORM) |
| 部署 | Docker / Windows 便携包 |

## 快速开始

### 环境要求

- Node.js >= 22
- pnpm >= 10

### 开发模式

```bash
# 克隆仓库
git clone https://github.com/dix8/QQBot.git
cd QQBot

# 安装依赖
cd server && pnpm install && cd ..
cd web && pnpm install && cd ..

# 启动后端（默认监听 3000 端口）
cd server
pnpm dev

# 启动前端（另一个终端，默认监听 5173 端口）
cd web
pnpm dev
```

首次启动后端时会自动创建 SQLite 数据库并运行迁移，同时安装预装示例插件。

### 生产部署（Docker）

从源码构建并启动：

```bash
# 克隆仓库
git clone https://github.com/dix8/QQBot.git
cd QQBot

# 构建并启动（首次会自动构建镜像）
docker compose up -d

# 查看日志
docker logs -f qqbot

# 更新：拉取最新代码后重新构建
git pull && docker compose up -d --build
```

默认端口说明：

| 端口 | 用途 | 说明 |
|------|------|------|
| `3000` | Web 管理面板 | 必选 |
| `8095` | NapCat 反向 WebSocket | 可按需修改，需与 Web 面板中配置的 WS 端口一致 |

如需修改端口，编辑 `docker-compose.yml` 中的 `ports` 映射即可。

<details>
<summary>使用 docker run</summary>

```bash
docker build -t qqbot-web .
docker run -d --name qqbot -p 3000:3000 -p 8095:8095 -v qqbot-data:/app/data --restart always qqbot-web
```

</details>

### 生产部署（Windows 便携包）

在项目根目录执行构建脚本，生成的便携包位于 `release/QQBot/`，复制到目标机器后双击 `start.bat` 即可运行，无需安装 Node.js。

```bash
bash scripts/build-win.sh
```

```
QQBot/
├── node.exe         ← 内置 Node.js 运行时
├── start.bat        ← 双击启动
├── .env.example     ← 配置模板（复制为 .env 可自定义）
├── dist/            ← 服务端代码
├── public/          ← 前端页面
└── data/            ← 运行时自动创建（数据库、插件、密钥）
```

启动后访问 `http://localhost:3000` 即可使用。如需修改端口等配置，复制 `.env.example` 为 `.env` 进行编辑。

### 连接 NapCat

1. 在 NapCat 配置中设置反向 WebSocket 地址为 `ws://your-server:8095/ws`（端口可在 Web 面板中配置）
2. 配置 access token（如需要）
3. NapCat 启动后会自动连接，Web 面板中即可看到 Bot 上线

## 项目结构

```
QQBot/
├── server/                # 后端
│   ├── src/
│   │   ├── index.ts       # 入口
│   │   ├── ws/            # WebSocket 服务端
│   │   ├── routes/        # REST API 路由
│   │   ├── services/      # 业务逻辑层
│   │   ├── plugins/       # 插件管理
│   │   ├── db/            # 数据库 Schema 与迁移
│   │   └── types/         # 类型定义
│   └── package.json
├── web/                   # 前端
│   ├── src/
│   │   ├── views/         # 页面组件
│   │   ├── components/    # 通用组件
│   │   ├── stores/        # Pinia 状态管理
│   │   ├── router/        # 路由
│   │   ├── api/           # API 调用封装
│   │   └── types/         # 类型定义
│   └── package.json
├── docs/                  # 文档
│   └── plugin-development.md  # 插件开发指南
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 内置 QQ 指令

| 指令 | 说明 | 权限 |
|------|------|------|
| `/帮助` `/help` | 显示可用指令列表 | 所有人 |
| `/状态` `/status` | 查看系统运行状态 | 所有人 |
| `/关于` `/about` | 查看当前 Bot 信息 | 所有人 |
| `/昵称 [新昵称]` | 查看/设置 Bot 昵称 | 主人 |
| `/主人列表` | 列出所有主人 QQ | 主人 |
| `/超管列表` | 列出所有超级管理员 QQ | 超级管理员 |
| `/添加主人 @用户/QQ号` | 添加主人 | 超级管理员 |
| `/删除主人 @用户/QQ号` | 删除主人 | 超级管理员 |
| `/插件列表` | 查看已安装插件 | 超级管理员 |
| `/启用插件 <序号或ID>` | 启用插件 | 超级管理员 |
| `/禁用插件 <序号或ID>` | 禁用插件 | 超级管理员 |

### 配置管理指令

通过 QQ 聊天直接管理 Bot 配置，无需打开 Web 面板：

| 指令 | 说明 | 权限 |
|------|------|------|
| `/配置` | 查看当前配置总览 | 主人 |
| `/自动回复 [开/关]` | 开关自动回复 | 主人 |
| `/自动加好友 [开/关]` | 开关自动同意好友请求 | 主人 |
| `/自动加群 [开/关]` | 开关自动同意加群邀请 | 主人 |
| `/自身指令 [开/关]` | 开关 Bot 响应自身指令 | 主人 |
| `/消息范围 [私聊/群聊/全部]` | 设置消息处理范围 | 主人 |
| `/黑名单` | 查看用户黑名单 | 主人 |
| `/拉黑 @用户/QQ号` | 添加到黑名单 | 主人 |
| `/解黑 @用户/QQ号` | 从黑名单移除 | 主人 |
| `/群开关 [群号] [开/关]` | 启用/禁用群指令响应 | 主人 |
| `/群过滤 [关闭/白名单/黑名单]` | 设置群过滤模式 | 主人 |
| `/群过滤列表` | 查看群过滤列表 | 主人 |
| `/添加过滤群 <群号>` | 添加群到过滤列表 | 主人 |
| `/删除过滤群 <群号>` | 从过滤列表移除群 | 主人 |
| `/在线时段 [开/关/起始-结束]` | 设置在线时段 | 主人 |
| `/频率限制 [开/关/条数 秒数]` | 设置消息频率限制 | 主人 |
| `/重试 [开/关]` | 开关消息重试 | 主人 |

### 预装示例插件指令

系统自带示例插件（首次启动自动安装，默认禁用），启用后提供 34 个指令，覆盖 OneBot V11 主要功能：

| 分类 | 指令示例 | 说明 |
|------|---------|------|
| 基础 | `/ping` `/echo` `/info` `/time` `/赞我` `/签到` `/签到排行` | 在线检测、复读、Bot 信息、点赞、每日签到 |
| 查询 | `/查群员` `/查用户` `/群荣誉` `/群文件` `/群文件信息` `/已读` | 群成员/用户/荣誉/文件信息查询（所有人） |
| 群信息 | `/群列表` `/好友列表` `/群成员` `/群历史` | 群/好友/成员/历史消息查看（仅主人） |
| 群管理 | `/禁言` `/解禁` `/踢` `/全员禁言` `/解除全员禁言` `/群名片` `/群公告` `/撤回` `/改群名` `/设管理` `/取消管理` `/头衔` `/退群` | 群管理操作（仅主人，需开启功能开关） |
| 功能管理 | `/菜单` `/功能列表` `/开启` `/关闭` | 动态菜单、13 个功能开关（支持序号切换） |

此外还包括：防撤回（消息缓存机制）、进群欢迎、退群通知、戳一戳回应、复读检测、定时消息（支持整点报时）等通知事件处理。

详见 [示例插件文档](server/src/plugins/preinstalled/example-plugin/README.md)。

## 插件开发

插件以 ZIP 包形式安装，包含 `manifest.json` 和入口 JS 文件。

**两层上下文模型：**

- **PluginAppContext**（应用层）— `onLoad(app)` 时注入，用于访问配置、数据目录、日志、托管定时器
- **PluginEventContext**（事件层）— `onMessage(event, ctx)` / `onNotice` / `onRequest` 时注入，绑定到触发事件的 Bot 连接，用于发送消息和调用 API

**主要能力：**

- 生命周期钩子：`onLoad` / `onUnload` / `onMessage` / `onNotice` / `onRequest`
- 托管定时器（`app.setTimeout` / `app.setInterval`），卸载时系统自动清除
- `manifest.json` 声明指令、权限与配置 Schema，Web 面板自动渲染配置表单
- 异常隔离 — 插件崩溃不影响核心系统和其他插件

> **⚠️ 安全提示：** 插件与主进程共享同一个 Node.js 运行时，**不存在沙箱隔离**。`manifest.json` 中的 `permissions` 仅约束通过上下文 API（`ctx.sendMessage`、`ctx.callApi` 等）的调用，不限制 Node.js 原生能力（文件系统、网络等）。**请仅安装来自可信来源的插件。**

详见 [插件开发指南](docs/plugin-development.md)。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `INITIAL_ADMIN_PASSWORD` | 首次运行时的管理员密码 | 随机生成 |
| `JWT_SECRET` | JWT 密钥（生产环境建议设置） | 自动生成并持久化 |
| `JWT_SECRET_FILE` | JWT 密钥持久化文件路径 | `data/.jwt-secret` |
| `DB_PATH` | SQLite 数据库文件路径 | `data/qqbot.db` |
| `PLUGINS_DIR` | 插件存储目录 | `data/plugins` |
| `HEARTBEAT_TIMEOUT_MS` | NapCat 心跳超时时间（毫秒） | `60000` |
| `API_TIMEOUT_MS` | OneBot API 调用超时时间（毫秒） | `30000` |
| `CORS_ORIGIN` | CORS 允许的来源 | `*` |
| `TRUST_PROXY` | Fastify 反向代理信任设置 | `false` |
| `NODE_ENV` | 运行环境 | `development` |

## License

AGPL-3.0
