/**
 * Worker thread for plugin zip validation and extraction.
 *
 * Runs synchronous-heavy AdmZip operations off the main thread so that
 * the main thread can enforce a real timeout via worker.terminate().
 *
 * When imported as a regular module (e.g. in tests), the worker entry
 * code does NOT run — only the exported validation functions are available.
 */
import { parentPort, workerData } from 'node:worker_threads';
import AdmZip from 'adm-zip';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// ── Resource limit constants (shared with tests) ─────────────────────
export const MAX_EXTRACTED_SIZE = 50 * 1024 * 1024;   // 50 MB extracted
export const MAX_FILE_COUNT = 500;
export const MAX_DEPTH = 10;
export const MAX_SINGLE_FILE = 10 * 1024 * 1024;      // 10 MB per file

// ── Validation functions (exported for testability) ──────────────────

/** Post-extraction: walk the extracted directory tree and enforce limits */
export function checkExtractedLimits(
  dir: string,
  baseDir: string = dir,
  depth: number = 0,
  stats = { size: 0, count: 0 },
): void {
  if (depth > MAX_DEPTH) {
    throw new Error(`插件目录层级过深（超过 ${MAX_DEPTH} 层）`);
  }
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      checkExtractedLimits(full, baseDir, depth + 1, stats);
    } else {
      const st = statSync(full);
      if (st.size > MAX_SINGLE_FILE) {
        throw new Error(`文件 ${entry.name} 超过单文件大小限制（${MAX_SINGLE_FILE / 1024 / 1024} MB）`);
      }
      stats.size += st.size;
      stats.count++;
      if (stats.size > MAX_EXTRACTED_SIZE) {
        throw new Error(`解压后总大小超过限制（${MAX_EXTRACTED_SIZE / 1024 / 1024} MB）`);
      }
      if (stats.count > MAX_FILE_COUNT) {
        throw new Error(`文件数量超过限制（${MAX_FILE_COUNT} 个）`);
      }
    }
  }
}

/** Pre-extraction: validate zip entries from headers before writing to disk */
export function checkZipEntries(zip: AdmZip): void {
  const entries = zip.getEntries();
  let totalSize = 0;
  let fileCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    fileCount++;
    if (fileCount > MAX_FILE_COUNT) {
      throw new Error(`文件数量超过限制（${MAX_FILE_COUNT} 个）`);
    }

    const uncompressedSize = entry.header.size;
    if (uncompressedSize > MAX_SINGLE_FILE) {
      throw new Error(`文件 ${entry.entryName} 超过单文件大小限制（${MAX_SINGLE_FILE / 1024 / 1024} MB）`);
    }

    totalSize += uncompressedSize;
    if (totalSize > MAX_EXTRACTED_SIZE) {
      throw new Error(`解压后总大小超过限制（${MAX_EXTRACTED_SIZE / 1024 / 1024} MB）`);
    }

    const depth = entry.entryName.split('/').length - 1;
    if (depth > MAX_DEPTH) {
      throw new Error(`插件目录层级过深（超过 ${MAX_DEPTH} 层）`);
    }
  }
}

/** Zip Slip protection: ensure no entry escapes the target directory */
export function checkZipSlip(zip: AdmZip, targetDir: string): void {
  const resolvedTarget = resolve(targetDir) + sep;
  for (const entry of zip.getEntries()) {
    const entryPath = resolve(targetDir, entry.entryName);
    if (!entryPath.startsWith(resolvedTarget)) {
      throw new Error('插件包含非法路径');
    }
  }
}

// ── Worker entry point (only runs when loaded as a worker thread) ────

if (parentPort) {
  const { tmpZip, tmpDir } = workerData as { tmpZip: string; tmpDir: string };
  try {
    const zip = new AdmZip(tmpZip);

    checkZipSlip(zip, tmpDir);
    checkZipEntries(zip);

    zip.extractAllTo(tmpDir, true);

    checkExtractedLimits(tmpDir);

    parentPort.postMessage({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort.postMessage({ success: false, error: message });
  }
}
