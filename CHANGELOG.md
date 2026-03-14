# 更新日志

本文件记录 QQBot Web Manager 各版本的更新内容。

---

## [0.1.0] - 2026-03-12

QQBot Web Manager —— 基于 Vue 3 + Fastify 的 QQ 机器人 Web 管理面板，通过反向 WebSocket 与 NapCat 通信（OneBot V11 协议）。

### 核心功能

- **反向 WebSocket 服务端**：接收 NapCat 连接，支持连接状态管理（在线/离线/异常/重连）、连接参数配置与校验
- **多 Bot 管理**：支持同时管理多个 Bot 实例，仪表盘聚合展示各 Bot 头像、名称、在线状态和消息量
- **Bot 配置管理**：昵称、自动回复、消息范围、关键词回复、在线时段、频率限制，配置修改即时热加载
- **群管理页面**：已加入群列表（含真实群头像）、按群开关指令响应、批量启用/禁用、搜索筛选
- **插件系统**：zip 导入 + 合法性校验、启用/禁用/删除/热重载、优先级管理、异常隔离、`configSchema` 自定义编辑器、资源自动清理
- **预装示例插件**：7 个功能模块（admin/features/fun/info/master/notice/utils），涵盖群管理、定时消息、防撤回、配置指令等 35+ 指令
- **定时任务可视化编辑器**：支持每日定时和 Cron 表达式两种模式、多群广播（`all`）、多条随机消息、模板变量（`{time}`/`{date}`/`{weekday}` 等）、可视化/代码双模式切换
- **消息记录持久化**：消息自动存入 SQLite，支持按类型/群号/QQ号/内容搜索和分页浏览，QQ 头像 + 聊天气泡布局
- **统计数据持久化**：消息小时趋势、群/用户排行持久化，支持 24h/7d/30d 时间范围切换
- **操作审计日志**：所有 Web 端管理操作自动记录，系统设置页面可查看完整操作历史
- **配置备份与还原**：一键导出/还原完整系统备份（Bot 配置、插件配置、启用状态、超级管理员设置）
- **日志系统**：连接日志/运行日志/插件日志，支持筛选搜索、CSV/JSON 导出
- **通知/告警系统**：Bot 连接/断开、心跳超时、插件自动禁用等关键事件实时通知，未读角标 + 下拉面板
- **前端实时推送**：Admin WebSocket（`/ws/admin`）实时推送仪表盘、日志、Bot 状态，断连自动回退轮询
- **系统级过滤**：用户黑名单、群组黑白名单、在线时段限制（覆盖通知/请求事件）
- **QQ 配置管理指令**：18 个聊天内配置指令（自动回复、黑名单、群过滤、在线时段、频率限制等）
- **账号密码登录鉴权**（JWT）
- **响应式 Web UI**：Vue 3 + Shadcn-vue + Tailwind CSS，适配 PC 与移动端

### 安全

- 插件 README 渲染引入 DOMPurify 防止 XSS 注入
- 危险 OneBot API 操作自动记录警告日志
- `.dockerignore` 排除运行时数据目录，避免敏感数据打入镜像

### 测试

- 单元测试覆盖 12 个测试文件 / 172 个用例，涵盖 ConfigService、LogService、AuthService、AuditService、MessageStoreService、MessageBufferService、PluginManager、CommandDetector、密码哈希、插件上传、上传超时、Admin WebSocket 等核心模块

### 部署

- Docker 单容器部署（前端构建产物由后端静态托管）
- Windows 便携包（内置 Node.js，双击 `start.bat` 即可运行）
- 默认端口：Web 面板 `3000`，NapCat 反向 WebSocket `8095`
