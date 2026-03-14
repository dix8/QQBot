import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import {
  checkExtractedLimits,
  checkZipEntries,
  checkZipSlip,
  MAX_FILE_COUNT,
  MAX_DEPTH,
  MAX_SINGLE_FILE,
  MAX_EXTRACTED_SIZE,
} from '../../routes/plugin-upload-worker.js';

const TMP_DIR = resolve('data/tmp/test-upload-worker');

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('checkZipEntries', () => {
  it('accepts a valid zip', () => {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from('{}'));
    zip.addFile('index.js', Buffer.from('module.exports = {}'));
    expect(() => checkZipEntries(zip)).not.toThrow();
  });

  it('rejects when file count exceeds limit', () => {
    const zip = new AdmZip();
    for (let i = 0; i <= MAX_FILE_COUNT; i++) {
      zip.addFile(`file-${i}.txt`, Buffer.from('x'));
    }
    expect(() => checkZipEntries(zip)).toThrow('文件数量超过限制');
  });

  it('rejects when a single file exceeds size limit', () => {
    const zip = new AdmZip();
    // Create a zip entry that reports a large uncompressed size
    // AdmZip sets header.size from buffer length
    const bigBuf = Buffer.alloc(MAX_SINGLE_FILE + 1, 0);
    zip.addFile('big.bin', bigBuf);
    expect(() => checkZipEntries(zip)).toThrow('超过单文件大小限制');
  });

  it('rejects when directory depth exceeds limit', () => {
    const zip = new AdmZip();
    const deep = Array.from({ length: MAX_DEPTH + 1 }, (_, i) => `d${i}`).join('/') + '/file.txt';
    zip.addFile(deep, Buffer.from('x'));
    expect(() => checkZipEntries(zip)).toThrow('目录层级过深');
  });
});

describe('checkZipSlip', () => {
  it('accepts normal paths', () => {
    const zip = new AdmZip();
    zip.addFile('a/b/c.txt', Buffer.from('x'));
    expect(() => checkZipSlip(zip, '/tmp/safe')).not.toThrow();
  });

  it('rejects entries that resolve outside target directory', () => {
    // AdmZip sanitizes ../  in addFile, so we test the function logic
    // by manually crafting an entry whose resolved path escapes the target.
    // An absolute-path entry name is another form of zip slip.
    const zip = new AdmZip();
    zip.addFile('safe.txt', Buffer.from('ok'));

    // Monkey-patch getEntries to simulate a crafted zip with traversal entry
    const original = zip.getEntries.bind(zip);
    zip.getEntries = () => {
      const entries = original();
      entries.push({ entryName: '../../escape.txt' } as any);
      return entries;
    };
    expect(() => checkZipSlip(zip, '/tmp/safe')).toThrow('非法路径');
  });
});

describe('checkExtractedLimits', () => {
  it('accepts a valid directory tree', () => {
    mkdirSync(join(TMP_DIR, 'sub'), { recursive: true });
    writeFileSync(join(TMP_DIR, 'manifest.json'), '{}');
    writeFileSync(join(TMP_DIR, 'sub', 'index.js'), 'module.exports = {}');
    expect(() => checkExtractedLimits(TMP_DIR)).not.toThrow();
  });

  it('rejects when directory depth exceeds limit', () => {
    let dir = TMP_DIR;
    for (let i = 0; i <= MAX_DEPTH + 1; i++) {
      dir = join(dir, `d${i}`);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'file.txt'), 'x');
    expect(() => checkExtractedLimits(TMP_DIR)).toThrow('目录层级过深');
  });

  it('rejects when file count exceeds limit', () => {
    mkdirSync(TMP_DIR, { recursive: true });
    for (let i = 0; i <= MAX_FILE_COUNT; i++) {
      writeFileSync(join(TMP_DIR, `file-${i}.txt`), 'x');
    }
    expect(() => checkExtractedLimits(TMP_DIR)).toThrow('文件数量超过限制');
  });

  it('rejects when single file exceeds size limit', () => {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(join(TMP_DIR, 'big.bin'), Buffer.alloc(MAX_SINGLE_FILE + 1, 0));
    expect(() => checkExtractedLimits(TMP_DIR)).toThrow('超过单文件大小限制');
  });
});
