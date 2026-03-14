import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock auditService (imported by plugin.ts at module level)
vi.mock('../../services/audit.js', () => ({
  auditService: { log: vi.fn() },
}));

// Mock Worker from node:worker_threads
// The factory closure reads mockWorkerInstance at call time (not definition time)
let mockWorkerInstance: EventEmitter & { terminate: ReturnType<typeof vi.fn> };

vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(function () {
    return mockWorkerInstance;
  }),
}));

import { runUploadWorker, raceAbort, UPLOAD_PROCESS_TIMEOUT_MS } from '../../routes/plugin.js';

function createMockWorker() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    terminate: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkerInstance = createMockWorker();
});

describe('runUploadWorker', () => {
  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runUploadWorker('a.zip', '/tmp/dir', controller.signal))
      .rejects.toThrow('超时');
  });

  it('resolves when worker posts success and exits', async () => {
    const promise = runUploadWorker('a.zip', '/tmp/dir');
    mockWorkerInstance.emit('message', { success: true });
    mockWorkerInstance.emit('exit', 0);
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with worker error message on failure', async () => {
    const promise = runUploadWorker('a.zip', '/tmp/dir');
    mockWorkerInstance.emit('message', { success: false, error: '校验失败' });
    mockWorkerInstance.emit('exit', 1);
    await expect(promise).rejects.toThrow('校验失败');
  });

  it('does not settle until exit event fires', async () => {
    const promise = runUploadWorker('a.zip', '/tmp/dir');

    // Worker posts success but hasn't exited yet
    mockWorkerInstance.emit('message', { success: true });

    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });

    // Allow microtasks to run — if promise had settled, .then would execute
    await new Promise(r => setTimeout(r, 0));
    expect(settled).toBe(false);

    // Exit fires — now it settles
    mockWorkerInstance.emit('exit', 0);
    await expect(promise).resolves.toBeUndefined();
  });

  it('terminates worker on abort and waits for exit before rejecting', async () => {
    const controller = new AbortController();
    const promise = runUploadWorker('a.zip', '/tmp/dir', controller.signal);

    // Abort — should call worker.terminate()
    controller.abort();
    expect(mockWorkerInstance.terminate).toHaveBeenCalled();

    // Promise must NOT settle before exit event
    let settled = false;
    promise.catch(() => { settled = true; });
    await new Promise(r => setTimeout(r, 0));
    expect(settled).toBe(false);

    // Now emit exit — promise should reject with timeout message
    mockWorkerInstance.emit('exit', 1);
    await expect(promise).rejects.toThrow('超时');
  });

  it('rejects when worker exits abnormally without message', async () => {
    const promise = runUploadWorker('a.zip', '/tmp/dir');
    mockWorkerInstance.emit('exit', 1);
    await expect(promise).rejects.toThrow('Worker 异常退出');
  });

  it('rejects with worker error when error event fires before exit', async () => {
    const promise = runUploadWorker('a.zip', '/tmp/dir');
    mockWorkerInstance.emit('error', new Error('Worker crashed'));
    mockWorkerInstance.emit('exit', 1);
    await expect(promise).rejects.toThrow('Worker crashed');
  });
});

describe('raceAbort', () => {
  it('resolves when promise resolves before signal', async () => {
    const controller = new AbortController();
    const result = await raceAbort(Promise.resolve(42), controller.signal, '超时');
    expect(result).toBe(42);
  });

  it('rejects when signal fires before promise settles', async () => {
    const controller = new AbortController();
    const never = new Promise(() => {});
    const p = raceAbort(never, controller.signal, '流程超时');
    controller.abort();
    await expect(p).rejects.toThrow('流程超时');
  });

  it('rejects immediately when signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(raceAbort(Promise.resolve(1), controller.signal, '已超时'))
      .rejects.toThrow('已超时');
  });
});

describe('overall timeout coverage', () => {
  it('UPLOAD_PROCESS_TIMEOUT_MS is exported and equals 60 seconds', () => {
    expect(UPLOAD_PROCESS_TIMEOUT_MS).toBe(60_000);
  });

  it('raceAbort protects any async phase against total timeout', async () => {
    // Simulate: Phase 1 (upload) took 50s, Phase 2 (worker) took 8s, Phase 3 (install) runs...
    // Total timeout fires at 60s, during Phase 3.
    // raceAbort should reject the install promise when abort fires.
    const controller = new AbortController();

    // Simulate a slow install that never resolves
    const slowInstall = new Promise<string>(() => {});
    const raced = raceAbort(slowInstall, controller.signal, '插件上传处理超时（60s）');

    // Abort fires (simulates total timeout)
    controller.abort();

    await expect(raced).rejects.toThrow('插件上传处理超时（60s）');
  });

  it('worker abort + raceAbort together cover the full pipeline', async () => {
    const controller = new AbortController();

    // Phase 2: worker is running
    const workerPromise = runUploadWorker('a.zip', '/tmp/dir', controller.signal);

    // Total timeout fires
    controller.abort();
    expect(mockWorkerInstance.terminate).toHaveBeenCalled();

    // Worker exits after terminate
    mockWorkerInstance.emit('exit', 1);
    await expect(workerPromise).rejects.toThrow('超时');

    // Phase 3 would never start, but if it did, raceAbort catches it
    const installPromise = raceAbort(
      new Promise<void>(() => {}),
      controller.signal,
      '插件上传处理超时（60s）',
    );
    await expect(installPromise).rejects.toThrow('超时');
  });
});
