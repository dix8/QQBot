import { describe, it, expect } from 'vitest';
import { detectCommands, mergeCommands } from '../../plugins/command-detector.js';
import type { PluginCommand } from '../../types/plugin.js';

describe('detectCommands', () => {
  describe('指令匹配模式', () => {
    it('检测 === 等值比较', () => {
      const source = `
        if (text === '/ping') {
          handlePing();
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ command: '/ping', permission: 'all' });
    });

    it('检测 == 等值比较', () => {
      const source = `
        if (raw == '/status') {
          showStatus();
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/status');
    });

    it('检测双引号', () => {
      const source = `
        if (text === "/hello") {
          greet();
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/hello');
    });

    it('检测 .startsWith() 前缀匹配', () => {
      const source = `
        if (text.startsWith('/echo ')) {
          echo(text.slice(6));
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/echo');
    });

    it('检测 switch/case', () => {
      const source = `
        switch (text) {
          case '/ping':
            handlePing();
            break;
          case '/info':
            handleInfo();
            break;
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(2);
      const commands = result.map((r) => r.command).sort();
      expect(commands).toEqual(['/info', '/ping']);
    });

    it('混合检测多种模式', () => {
      const source = `
        if (text === '/ping') {
          handlePing();
        } else if (text.startsWith('/echo')) {
          handleEcho();
        }
        switch (cmd) {
          case '/help':
            showHelp();
            break;
        }
      `;
      const result = detectCommands(source);
      const commands = result.map((r) => r.command).sort();
      expect(commands).toEqual(['/echo', '/help', '/ping']);
    });
  });

  describe('中文指令', () => {
    it('检测中文指令名', () => {
      const source = `
        if (text === '/帮助') {
          showHelp();
        } else if (text === '/天气') {
          showWeather();
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(2);
      const commands = result.map((r) => r.command).sort();
      expect(commands).toEqual(['/天气', '/帮助']);
    });

    it('检测中文指令 startsWith', () => {
      const source = `
        if (text.startsWith('/查询')) {
          query(text.slice(3));
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/查询');
    });
  });

  describe('去重', () => {
    it('同一指令多次出现只保留一个', () => {
      const source = `
        if (text === '/ping') {
          handlePing();
        }
        // 另一处也检测 /ping
        if (raw === '/ping') {
          handlePing2();
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/ping');
    });

    it('=== 和 startsWith 同一指令去重', () => {
      const source = `
        if (text === '/echo') {
          showUsage();
        } else if (text.startsWith('/echo')) {
          doEcho();
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/echo');
    });
  });

  describe('权限检测', () => {
    it('内联 isMaster 检查 → master', () => {
      const source = `
        if (text === '/ban') {
          if (!isMaster(event.user_id)) {
            sendMessage('权限不足');
            return;
          }
          doBan();
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].permission).toBe('master');
    });

    it('内联 masterQQ 检查 → master', () => {
      const source = `
        if (text === '/admin') {
          if (masterQQ.includes(event.user_id)) {
            doAdmin();
          }
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].permission).toBe('master');
    });

    it('内联"权限不足"提示 → master', () => {
      const source = `
        if (text === '/kick') {
          if (!checkAdmin()) {
            ctx.sendMessage(type, target, '权限不足');
            return;
          }
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].permission).toBe('master');
    });

    it('无权限模式 → all', () => {
      const source = `
        if (text === '/hello') {
          ctx.sendMessage(type, target, 'Hello!');
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].permission).toBe('all');
    });

    it('函数追踪：调用的函数中有权限检查 → master', () => {
      const source = `
        async function handleNickname(event) {
          if (!isMaster(event.user_id)) {
            return;
          }
          // 设置昵称逻辑
        }

        if (text === '/昵称') {
          await handleNickname(event);
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/昵称');
      expect(result[0].permission).toBe('master');
    });

    it('函数追踪：调用的函数无权限检查 → all', () => {
      const source = `
        async function handlePing(event) {
          await ctx.sendMessage(type, target, 'pong');
        }

        if (text === '/ping') {
          await handlePing(event);
        }
      `;
      const result = detectCommands(source);
      expect(result).toHaveLength(1);
      expect(result[0].permission).toBe('all');
    });
  });

  describe('边界情况', () => {
    it('空源码返回空数组', () => {
      expect(detectCommands('')).toEqual([]);
    });

    it('无指令的源码返回空数组', () => {
      const source = `
        export default {
          onLoad(ctx) {
            ctx.logger.info('loaded');
          }
        };
      `;
      expect(detectCommands(source)).toEqual([]);
    });

    it('非 / 开头的字符串不视为指令', () => {
      const source = `
        if (text === 'hello') {
          greet();
        }
      `;
      expect(detectCommands(source)).toEqual([]);
    });
  });
});

describe('mergeCommands', () => {
  it('manifest 为空，仅返回 detected', () => {
    const detected = [
      { command: '/ping', permission: 'all' as const },
      { command: '/ban', permission: 'master' as const },
    ];
    const result = mergeCommands(undefined, detected);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ command: '/ping', description: '', permission: 'all' });
    expect(result[1]).toEqual({ command: '/ban', description: '', permission: 'master' });
  });

  it('detected 为空，仅返回 manifest', () => {
    const manifest: PluginCommand[] = [
      { command: '/ping', description: '回复 pong', permission: 'all' },
    ];
    const result = mergeCommands(manifest, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ command: '/ping', description: '回复 pong', permission: 'all' });
  });

  it('合并取并集，按 command 去重', () => {
    const manifest: PluginCommand[] = [
      { command: '/ping', description: '回复 pong', permission: 'all' },
    ];
    const detected = [
      { command: '/ping', permission: 'all' as const },
      { command: '/echo', permission: 'all' as const },
    ];
    const result = mergeCommands(manifest, detected);
    expect(result).toHaveLength(2);
    const commands = result.map((r) => r.command).sort();
    expect(commands).toEqual(['/echo', '/ping']);
  });

  it('description 优先用 manifest', () => {
    const manifest: PluginCommand[] = [
      { command: '/ping', description: '回复 pong', permission: 'all' },
    ];
    const detected = [{ command: '/ping', permission: 'all' as const }];
    const result = mergeCommands(manifest, detected);
    expect(result[0].description).toBe('回复 pong');
  });

  it('detected 的指令无 description 时为空字符串', () => {
    const detected = [{ command: '/echo', permission: 'all' as const }];
    const result = mergeCommands([], detected);
    expect(result[0].description).toBe('');
  });

  it('usage 仅来自 manifest', () => {
    const manifest: PluginCommand[] = [
      { command: '/echo', description: '复读', usage: '/echo <内容>', permission: 'all' },
    ];
    const detected = [{ command: '/echo', permission: 'all' as const }];
    const result = mergeCommands(manifest, detected);
    expect(result[0].usage).toBe('/echo <内容>');
  });

  it('permission：manifest 优先于 detected', () => {
    const manifest: PluginCommand[] = [
      { command: '/ban', description: '禁言', permission: 'master' },
    ];
    const detected = [{ command: '/ban', permission: 'all' as const }];
    const result = mergeCommands(manifest, detected);
    expect(result[0].permission).toBe('master');
  });

  it('两者都为空时返回空数组', () => {
    expect(mergeCommands(undefined, [])).toEqual([]);
    expect(mergeCommands([], [])).toEqual([]);
  });
});
