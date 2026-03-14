import type { FastifyInstance } from 'fastify';
import { mkdirSync, rmSync, existsSync, createReadStream, readFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import type { PluginManager } from '../plugins/plugin-manager.js';
import { auditService } from '../services/audit.js';

const UPLOAD_TMP_DIR = resolve('data/tmp');

// Resource limits for the streaming upload (main thread)
const MAX_ZIP_SIZE = 20 * 1024 * 1024;        // 20 MB zip
export const UPLOAD_PROCESS_TIMEOUT_MS = 60_000;       // 60 second overall timeout

const TIMEOUT_MSG = `插件上传处理超时（${UPLOAD_PROCESS_TIMEOUT_MS / 1000}s）`;

/** Resolve the worker file URL — handles both compiled (.js) and dev (.ts) */
function getWorkerUrl(): URL {
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`./plugin-upload-worker${ext}`, import.meta.url);
}

/** Race a promise against an AbortSignal. Rejects with the given message when aborted. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, msg: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(msg));
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error(msg)), { once: true });
    }),
  ]);
}

/**
 * Spawn a worker thread to parse, validate, and extract the zip.
 *
 * - Accepts an AbortSignal for external timeout control.
 * - When aborted, terminates the worker and waits for the exit event
 *   before rejecting — ensures no file handles remain open.
 * - The promise settles only on the worker 'exit' event, guaranteeing
 *   the worker process has fully stopped before cleanup can proceed.
 */
export function runUploadWorker(tmpZip: string, tmpDir: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(TIMEOUT_MSG));
      return;
    }

    const workerUrl = getWorkerUrl();
    const worker = new Worker(workerUrl, { workerData: { tmpZip, tmpDir } });

    let result: { success: boolean; error?: string } | null = null;
    let workerError: Error | null = null;

    const onAbort = () => { worker.terminate(); };
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.on('message', (msg: { success: boolean; error?: string }) => {
      result = msg;
    });

    worker.on('error', (err: Error) => {
      workerError = err;
    });

    // 'exit' is always the last event — settle here to guarantee worker has fully stopped
    worker.on('exit', () => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(new Error(TIMEOUT_MSG));
      } else if (workerError) {
        reject(workerError);
      } else if (result) {
        if (result.success) resolve();
        else reject(new Error(result.error || '插件处理失败'));
      } else {
        reject(new Error('Worker 异常退出'));
      }
    });
  });
}

export function pluginRoutes(fastify: FastifyInstance, pluginManager: PluginManager): void {
  mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

  // GET /api/plugins — list all plugins
  fastify.get('/api/plugins', async () => {
    return { plugins: pluginManager.getAllPlugins() };
  });

  // GET /api/plugins/:id — plugin detail
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info) {
      return reply.code(404).send({ error: '插件不存在' });
    }
    return info;
  });

  // GET /api/plugins/:id/icon — serve plugin icon (public, no auth required)
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id/icon', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info || info.builtin) {
      return reply.code(404).send({ error: '插件不存在' });
    }
    const iconPath = join(pluginManager.getPluginDir(request.params.id), 'icon.png');
    if (!existsSync(iconPath)) {
      return reply.code(404).send({ error: '图标不存在' });
    }
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(createReadStream(iconPath));
  });

  // GET /api/plugins/:id/readme — serve plugin README.md (requires auth)
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id/readme', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info || info.builtin) {
      return reply.code(404).send({ error: '插件不存在' });
    }
    const readmePath = join(pluginManager.getPluginDir(request.params.id), 'README.md');
    if (!existsSync(readmePath)) {
      return reply.code(404).send({ error: '文档不存在' });
    }
    const content = readFileSync(readmePath, 'utf-8');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(content);
  });

  // POST /api/plugins/upload — upload and install plugin zip
  fastify.post('/api/plugins/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: '未上传文件' });
    }

    const tmpZip = join(UPLOAD_TMP_DIR, `upload-${Date.now()}.zip`);
    const tmpDir = join(UPLOAD_TMP_DIR, `plugin-${Date.now()}`);

    // Overall timeout covering all phases: stream upload → worker → install
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_PROCESS_TIMEOUT_MS);

    try {
      // Phase 1: Stream file to disk with size check
      let written = 0;
      const fileStream = file.file;
      const writeStream = createWriteStream(tmpZip);

      const onAbort = () => {
        fileStream.destroy(new Error(TIMEOUT_MSG));
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });

      fileStream.on('data', (chunk: Buffer) => {
        written += chunk.length;
        if (written > MAX_ZIP_SIZE) {
          fileStream.destroy(new Error(`插件包大小超过限制（${MAX_ZIP_SIZE / 1024 / 1024} MB）`));
        }
      });

      await pipeline(fileStream, writeStream);
      controller.signal.removeEventListener('abort', onAbort);

      if (written > MAX_ZIP_SIZE) {
        return reply.code(400).send({ error: `插件包大小超过限制（${MAX_ZIP_SIZE / 1024 / 1024} MB）` });
      }

      if (controller.signal.aborted) {
        throw new Error(TIMEOUT_MSG);
      }

      // Phase 2: Worker thread zip validation + extraction
      // Worker promise settles only on exit — guarantees worker is dead before proceeding
      await runUploadWorker(tmpZip, tmpDir, controller.signal);

      // Phase 3: Install the validated & extracted plugin (raced against timeout)
      const info = await raceAbort(
        pluginManager.installPlugin(tmpDir),
        controller.signal,
        TIMEOUT_MSG,
      );

      auditService.log('plugin_install', info.id, `安装插件: ${info.name}`, (request.user as { username?: string })?.username, request.ip);
      return info;
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      if (controller.signal.aborted && !message.includes('超时')) {
        return reply.code(400).send({ error: TIMEOUT_MSG });
      }
      return reply.code(400).send({ error: message });
    } finally {
      clearTimeout(timer);
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(tmpZip, { force: true });
    }
  });

  // POST /api/plugins/:id/enable
  fastify.post<{ Params: { id: string } }>('/api/plugins/:id/enable', async (request, reply) => {
    try {
      await pluginManager.enablePlugin(request.params.id);
      auditService.log('plugin_enable', request.params.id, '启用插件', (request.user as { username?: string })?.username, request.ip);
      return { success: true };
    } catch (err) {
      return reply.code(400).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // POST /api/plugins/:id/disable
  fastify.post<{ Params: { id: string } }>('/api/plugins/:id/disable', async (request, reply) => {
    try {
      await pluginManager.disablePlugin(request.params.id);
      auditService.log('plugin_disable', request.params.id, '禁用插件', (request.user as { username?: string })?.username, request.ip);
      return { success: true };
    } catch (err) {
      return reply.code(400).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // POST /api/plugins/reload — reload all plugins
  fastify.post('/api/plugins/reload', async (request) => {
    const result = await pluginManager.reloadAllPlugins();
    auditService.log('plugin_reload_all', 'all', '重载全部插件', (request.user as { username?: string })?.username, request.ip);
    return result;
  });

  // PUT /api/plugins/:id/priority
  fastify.put<{ Params: { id: string }; Body: { priority: number } }>(
    '/api/plugins/:id/priority',
    async (request, reply) => {
      const { priority } = request.body as { priority: number };
      if (typeof priority !== 'number' || priority < 0) {
        return reply.code(400).send({ error: '无效的优先级值' });
      }
      pluginManager.updatePriority(request.params.id, priority);
      return { success: true };
    },
  );

  // DELETE /api/plugins/:id
  fastify.delete<{ Params: { id: string } }>('/api/plugins/:id', async (request, reply) => {
    try {
      await pluginManager.deletePlugin(request.params.id);
      auditService.log('plugin_delete', request.params.id, '删除插件', (request.user as { username?: string })?.username, request.ip);
      return { success: true };
    } catch (err) {
      return reply.code(400).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // GET /api/plugins/:id/config — get plugin config schema + current values
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id/config', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info) {
      return reply.code(404).send({ error: '插件不存在' });
    }
    const values = pluginManager.getPluginConfigValues(request.params.id);
    // Merge defaults for keys not yet set
    const merged: Record<string, unknown> = {};
    for (const item of info.configSchema) {
      merged[item.key] = item.key in values ? values[item.key] : item.default;
    }
    return { schema: info.configSchema, values: merged };
  });

  // PUT /api/plugins/:id/config — save plugin config values
  fastify.put<{ Params: { id: string }; Body: { values: Record<string, unknown> } }>(
    '/api/plugins/:id/config',
    async (request, reply) => {
      const info = pluginManager.getPluginInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: '插件不存在' });
      }
      const { values } = request.body as { values: Record<string, unknown> };
      if (!values || typeof values !== 'object') {
        return reply.code(400).send({ error: '无效的配置数据' });
      }
      try {
        pluginManager.setPluginConfigValues(request.params.id, values);
        auditService.log('plugin_config_update', request.params.id, '更新插件配置', (request.user as { username?: string })?.username, request.ip);
        return { success: true };
      } catch (err) {
        return reply.code(400).send({ error: String(err instanceof Error ? err.message : err) });
      }
    },
  );
}
