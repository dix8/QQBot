#!/usr/bin/env bash
# ─────────────────────────────────────────────────
# Windows 便携分发包构建脚本
# 用法: bash scripts/build-win.sh
# 产物: release/QQBot/  (解压即用)
# ─────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release/QQBot"

echo "=== QQBot Windows 便携包构建 ==="
echo "项目根目录: $ROOT"
echo "输出目录:   $OUT"
echo ""

# ── 0. 前置检查 ──────────────────────────────────
command -v pnpm >/dev/null 2>&1 || { echo "错误: 未找到 pnpm，请先安装"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "错误: 未找到 node"; exit 1; }

NODE_EXE="$(which node).exe" 2>/dev/null || NODE_EXE="$(which node)"
# Windows 上 which node 返回的可能不带 .exe，尝试多种方式定位
if [[ ! -f "$NODE_EXE" ]]; then
  NODE_EXE="$(which node)"
fi
if [[ ! -f "$NODE_EXE" ]]; then
  echo "错误: 无法定位 node.exe"
  exit 1
fi
echo "Node.js: $NODE_EXE ($(node -v))"
echo ""

# ── 1. 构建前后端 ────────────────────────────────
echo "[1/6] 构建前端..."
cd "$ROOT/web"
pnpm install --frozen-lockfile
pnpm run build

echo ""
echo "[2/6] 构建后端..."
cd "$ROOT/server"
pnpm install --frozen-lockfile
pnpm run build

# ── 2. 准备输出目录 ──────────────────────────────
echo ""
echo "[3/6] 准备输出目录..."
rm -rf "$OUT"
mkdir -p "$OUT"

# ── 3. 复制产物 ──────────────────────────────────
echo "[4/6] 复制构建产物..."

# 编译后的服务端代码
cp -r "$ROOT/server/dist" "$OUT/dist"

# 预装插件源码（供运行时加载）
mkdir -p "$OUT/dist/plugins/preinstalled"
cp -r "$ROOT/server/src/plugins/preinstalled/"* "$OUT/dist/plugins/preinstalled/"

# 数据库迁移文件
cp -r "$ROOT/server/drizzle" "$OUT/drizzle"

# 前端构建产物
cp -r "$ROOT/web/dist" "$OUT/public"

# ── 4. 安装生产依赖 (hoisted 模式) ──────────────
echo ""
echo "[5/6] 安装生产依赖 (hoisted 模式)..."

# 复制 package.json 和 lockfile
cp "$ROOT/server/package.json" "$OUT/package.json"
cp "$ROOT/server/pnpm-lock.yaml" "$OUT/pnpm-lock.yaml"

# 写入 .npmrc 让 pnpm 使用 hoisted 模式（扁平 node_modules，无 symlink）
cat > "$OUT/.npmrc" << 'NPMRC'
node-linker=hoisted
NPMRC

cd "$OUT"
pnpm install --frozen-lockfile --prod

# 清理安装辅助文件（发布不需要）
rm -f "$OUT/.npmrc" "$OUT/pnpm-lock.yaml"

# ── 5. 复制 Node.js 运行时 ──────────────────────
echo ""
echo "[6/6] 复制 Node.js 运行时 & 生成启动脚本..."
cp "$NODE_EXE" "$OUT/node.exe"

# ── 6. 生成 start.bat ───────────────────────────
# 使用 printf 写入，确保 CRLF 行尾（Windows cmd.exe 对 LF-only 解析异常）
{
  printf '@echo off\r\n'
  printf 'chcp 65001 >nul 2>&1\r\n'
  printf 'cd /d "%%~dp0"\r\n'
  printf 'title QQBot Web 管理系统\r\n'
  printf '\r\n'
  printf 'echo ========================================\r\n'
  printf 'echo   QQBot Web 管理系统\r\n'
  printf 'echo ========================================\r\n'
  printf 'echo.\r\n'
  printf '\r\n'
  printf 'if not exist node.exe (\r\n'
  printf '    echo [错误] 未找到 node.exe\r\n'
  printf '    goto :end\r\n'
  printf ')\r\n'
  printf 'if not exist dist\\index.js (\r\n'
  printf '    echo [错误] 未找到 dist\\index.js\r\n'
  printf '    goto :end\r\n'
  printf ')\r\n'
  printf '\r\n'
  printf 'if exist .env (\r\n'
  printf '    echo [*] 已加载 .env 配置文件\r\n'
  printf ') else (\r\n'
  printf '    echo [!] 未找到 .env 文件，使用默认配置\r\n'
  printf '    echo [!] 可复制 .env.example 为 .env 进行自定义配置\r\n'
  printf ')\r\n'
  printf 'echo.\r\n'
  printf '\r\n'
  printf 'echo [*] 正在启动服务...\r\n'
  printf 'echo [*] 启动后请访问 http://localhost:3000\r\n'
  printf 'echo [*] 按 Ctrl+C 停止服务\r\n'
  printf 'echo.\r\n'
  printf '\r\n'
  printf 'node.exe dist/index.js\r\n'
  printf '\r\n'
  printf ':end\r\n'
  printf 'echo.\r\n'
  printf 'echo [*] 服务已停止\r\n'
  printf 'pause\r\n'
} > "$OUT/start.bat"

# ── 7. 生成 .env.example ────────────────────────
cat > "$OUT/.env.example" << 'ENV'
# QQBot Web 管理系统 - 环境变量配置
# 复制此文件为 .env 并根据需要修改

# HTTP 服务端口 (默认 3000)
# PORT=3000

# HTTP 监听地址 (默认 0.0.0.0)
# HOST=0.0.0.0

# SQLite 数据库文件路径 (默认 data/qqbot.db)
# DB_PATH=data/qqbot.db

# 插件存储目录 (默认 data/plugins)
# PLUGINS_DIR=data/plugins

# JWT 密钥 (不设置则自动生成并保存到文件)
# JWT_SECRET=

# JWT 密钥文件路径 (默认 data/.jwt-secret)
# JWT_SECRET_FILE=data/.jwt-secret

# WebSocket 心跳超时 (毫秒, 默认 60000)
# HEARTBEAT_TIMEOUT_MS=60000

# OneBot API 调用超时 (毫秒, 默认 30000)
# API_TIMEOUT_MS=30000

# CORS 允许的来源 (默认 "*"; 生产环境建议设为具体域名)
# CORS_ORIGIN=*
ENV

# ── 完成 ─────────────────────────────────────────
echo ""
echo "=== 构建完成 ==="
echo "输出目录: $OUT"
echo ""
echo "目录内容:"
ls -lh "$OUT"
echo ""

# 统计大小
if command -v du >/dev/null 2>&1; then
  TOTAL_SIZE=$(du -sh "$OUT" 2>/dev/null | cut -f1)
  echo "总大小: $TOTAL_SIZE"
fi

echo ""
echo "使用方法:"
echo "  1. 将 release/QQBot/ 目录复制到目标机器"
echo "  2. (可选) 复制 .env.example 为 .env 并修改配置"
echo "  3. 双击 start.bat 启动服务"
echo "  4. 浏览器访问 http://localhost:3000"
