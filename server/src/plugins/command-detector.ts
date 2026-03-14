// 插件指令自动检测 — 从入口文件源码中扫描指令和权限
import type { PluginCommand } from '../types/plugin.js';

export interface DetectedCommand {
  command: string;
  permission: 'all' | 'master';
}

// 权限相关关键词
const PERMISSION_PATTERNS = [
  /isMaster/,
  /masterQQ/,
  /master_qq/,
  /权限不足/,
  /仅主人/,
  /isOwner/,
  /role\s*===?\s*['"]owner['"]/,
  /permission.*master/i,
];

/**
 * 从源码中检测指令及其权限
 *
 * 扫描 3 种指令匹配模式：
 * 1. `text === '/xxx'` / `raw === '/xxx'`（等值比较）
 * 2. `.startsWith('/xxx')`（前缀匹配）
 * 3. `case '/xxx':`（switch/case）
 *
 * 支持中文指令名
 */
export function detectCommands(source: string): DetectedCommand[] {
  if (!source) return [];

  const lines = source.split('\n');
  const found = new Map<string, DetectedCommand>();

  // 正则：匹配指令字符串（/开头，支持中文）
  // Pattern 1: text === '/xxx' 或 raw === '/xxx'（双引号或单引号）
  const eqPattern = /===?\s*['"](\/([\w\u4e00-\u9fff]+))['"]/g;
  // Pattern 2: .startsWith('/xxx') — allow trailing chars like space before closing quote
  const startsWithPattern = /\.startsWith\(\s*['"](\/([\w\u4e00-\u9fff]+))[^'"]*['"]\s*\)/g;
  // Pattern 3: case '/xxx':
  const casePattern = /case\s+['"](\/([\w\u4e00-\u9fff]+))['"]:/g;

  const patterns = [eqPattern, startsWithPattern, casePattern];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const command = match[1];
      if (found.has(command)) continue;

      const matchIndex = match.index;
      const permission = detectPermission(source, lines, matchIndex, command);
      found.set(command, { command, permission });
    }
  }

  return Array.from(found.values());
}

/**
 * 检测指令对应的权限
 *
 * 两步判断：
 * 1. 内联检查：从指令匹配位置向后看约 30 行
 * 2. 函数追踪：如果指令块调用了命名函数，检查该函数体
 */
function detectPermission(
  source: string,
  lines: string[],
  matchIndex: number,
  _command: string,
): 'all' | 'master' {
  // 找到 matchIndex 所在的行号
  let lineNo = 0;
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    pos += lines[i].length + 1; // +1 for \n
    if (pos > matchIndex) {
      lineNo = i;
      break;
    }
  }

  // Step 1: 内联检查 — 从指令行向后看 30 行
  const endLine = Math.min(lineNo + 30, lines.length);
  const inlineBlock = lines.slice(lineNo, endLine).join('\n');

  if (hasPermissionPattern(inlineBlock)) {
    return 'master';
  }

  // Step 2: 函数追踪 — 检查是否调用了命名函数
  // 匹配 await xxx(、this.xxx(、xxx( 等调用形式
  const callPatterns = [
    /(?:await\s+)?(?:this\.)?(\w+)\s*\(/g,
  ];

  const calledFunctions = new Set<string>();
  for (const cp of callPatterns) {
    cp.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = cp.exec(inlineBlock)) !== null) {
      const fnName = cm[1];
      // 排除常见内置方法
      if (!['if', 'else', 'for', 'while', 'switch', 'case', 'return', 'await',
        'sendMessage', 'getConfig', 'setConfig', 'callApi', 'trim', 'startsWith',
        'endsWith', 'slice', 'split', 'join', 'push', 'pop', 'shift', 'toString',
        'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'JSON', 'console',
        'Math', 'Date', 'Array', 'Object', 'Promise', 'require', 'import',
      ].includes(fnName)) {
        calledFunctions.add(fnName);
      }
    }
  }

  // 在源码中找到这些函数的定义并检查其函数体
  for (const fnName of calledFunctions) {
    const fnBody = extractFunctionBody(source, fnName);
    if (fnBody && hasPermissionPattern(fnBody)) {
      return 'master';
    }
  }

  return 'all';
}

/**
 * 检测代码片段中是否包含权限相关模式
 */
function hasPermissionPattern(code: string): boolean {
  return PERMISSION_PATTERNS.some((p) => p.test(code));
}

/**
 * 从源码中提取指定函数的函数体
 * 支持 function xxx(、async function xxx(、const xxx = 等形式
 */
function extractFunctionBody(source: string, fnName: string): string | null {
  // 匹配函数定义的几种形式
  const patterns = [
    // function fnName( 或 async function fnName(
    new RegExp(`(?:async\\s+)?function\\s+${escapeRegex(fnName)}\\s*\\(`),
    // const/let/var fnName = (...) => 或 = function(
    new RegExp(`(?:const|let|var)\\s+${escapeRegex(fnName)}\\s*=`),
    // 对象方法：fnName( 或 async fnName(
    new RegExp(`(?:async\\s+)?${escapeRegex(fnName)}\\s*\\(`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;

    const startIdx = match.index;
    // 从匹配位置找到第一个 { 然后跟踪大括号配对
    const braceStart = source.indexOf('{', startIdx);
    if (braceStart === -1 || braceStart - startIdx > 200) continue;

    let depth = 0;
    let braceEnd = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          braceEnd = i;
          break;
        }
      }
    }

    if (braceEnd > braceStart) {
      return source.slice(braceStart, braceEnd + 1);
    }
  }

  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 合并 manifest 声明的指令和源码检测到的指令
 *
 * 规则：
 * - 指令列表 = manifest ∪ detected（按 command 去重）
 * - description：manifest 有则用，否则空字符串
 * - usage：仅来自 manifest
 * - permission：manifest 优先 → detected → 'all'
 *   （manifest 是开发者显式声明，比代码扫描更准确）
 */
export function mergeCommands(
  manifestCommands: PluginCommand[] | undefined,
  detected: DetectedCommand[],
): PluginCommand[] {
  const result = new Map<string, PluginCommand>();

  // 先放 manifest 声明的
  for (const cmd of manifestCommands ?? []) {
    result.set(cmd.command, { ...cmd });
  }

  // 合并 detected（仅补充 manifest 中没有的指令）
  for (const det of detected) {
    const existing = result.get(det.command);
    if (!existing) {
      result.set(det.command, {
        command: det.command,
        description: '',
        permission: det.permission,
      });
    }
  }

  return Array.from(result.values());
}
