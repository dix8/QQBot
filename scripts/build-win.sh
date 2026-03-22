#!/usr/bin/env bash
# ─────────────────────────────────────────────────
# Windows 便携分发包构建脚本（本地 & CI 共用）
# 用法:
#   bash scripts/build-win.sh             # 本地完整构建
#   bash scripts/build-win.sh --skip-build # CI 中跳过前后端构建（已预先构建）
# 产物: release/QQBot/  (解压即用)
# ─────────────────────────────────────────────────
set -euo pipefail

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release/QQBot"

echo "=== QQBot Windows 便携包构建 ==="
echo "项目根目录: $ROOT"
echo "输出目录:   $OUT"
echo "跳过构建:   $SKIP_BUILD"
echo ""

# ── 0. 前置检查 ──────────────────────────────────
command -v pnpm >/dev/null 2>&1 || { echo "错误: 未找到 pnpm，请先安装"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "错误: 未找到 node"; exit 1; }

NODE_EXE="$(which node).exe" 2>/dev/null || NODE_EXE="$(which node)"
if [[ ! -f "$NODE_EXE" ]]; then
  NODE_EXE="$(which node)"
fi
if [[ ! -f "$NODE_EXE" ]]; then
  echo "错误: 无法定位 node.exe"
  exit 1
fi
echo "Node.js: $NODE_EXE ($(node -v))"
echo ""

# ── 1. 构建前后端（CI 可跳过）────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo "[1/7] 构建前端..."
  cd "$ROOT/web"
  pnpm install --frozen-lockfile
  pnpm run build

  echo ""
  echo "[2/7] 构建后端..."
  cd "$ROOT/server"
  pnpm install --frozen-lockfile
  pnpm run build
else
  echo "[1/7] 跳过前端构建（--skip-build）"
  echo "[2/7] 跳过后端构建（--skip-build）"
fi

# ── 2. 准备输出目录 ──────────────────────────────
echo ""
echo "[3/7] 准备输出目录..."
rm -rf "$OUT"
mkdir -p "$OUT"

# ── 3. 复制产物 ──────────────────────────────────
echo "[4/7] 复制构建产物..."

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
echo "[5/7] 安装生产依赖 (hoisted 模式)..."

cp "$ROOT/server/package.json" "$OUT/package.json"
cp "$ROOT/server/pnpm-lock.yaml" "$OUT/pnpm-lock.yaml"

cat > "$OUT/.npmrc" << 'NPMRC'
node-linker=hoisted
NPMRC

cd "$OUT"
pnpm install --frozen-lockfile --prod

# 清理安装辅助文件
rm -f "$OUT/.npmrc" "$OUT/pnpm-lock.yaml"

# ── 5. 复制 Node.js 运行时 ──────────────────────
echo ""
echo "[6/7] 复制 Node.js 运行时..."
cp "$NODE_EXE" "$OUT/node.exe"

# ── 6. 生成 start.bat & .env.example ────────────
echo "[7/7] 生成启动脚本和配置模板..."

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

# ── 7. 校验完整产物 ─────────────────────────────
echo ""
echo "=== 校验产物完整性 ==="
VERIFY_PASS=true
for f in dist/index.js public/index.html node.exe start.bat .env.example package.json; do
  if [ -f "$OUT/$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f (缺失!)"
    VERIFY_PASS=false
  fi
done
if [ -d "$OUT/node_modules" ]; then
  echo "  ✓ node_modules/"
else
  echo "  ✗ node_modules/ (缺失!)"
  VERIFY_PASS=false
fi

if [ "$VERIFY_PASS" = false ]; then
  echo ""
  echo "错误: 产物校验失败!"
  exit 1
fi

# ── 完成 ─────────────────────────────────────────
echo ""
echo "=== 构建完成 ==="
echo "输出目录: $OUT"
echo ""
echo "目录内容:"
ls -lh "$OUT"
echo ""

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
