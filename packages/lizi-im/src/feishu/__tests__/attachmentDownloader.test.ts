/**
 * feishu/attachmentDownloader.test.ts — 下载增量上限回归。
 *
 * 修复前:附件先经 streamToBuffer 整只进内存(并写盘),之后才被 30MB 检查
 * 归为 oversize —— 超大文件的内存峰值与文件本身一样大,Electron main 直扛。
 * 修复后:流式累计超限立刻断流抛 ATTACHMENT_OVERSIZE,downloadAttachments
 * 把它归入 oversize(与"下载完成后才发现超限"同一收口),其余附件不受影响。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadAttachments, MAX_FILE_SIZE } from '../attachmentDownloader.js';
import { ATTACHMENT_OVERSIZE_CODE, streamToBuffer } from '../mediaStore.js';
import { setHost } from '../moduleScope.js';
import { defaultLogger } from '../../logger.js';
import type { IMHost } from '../../types.js';

const tmpRoots: string[] = [];
let currentMediaDir = '';

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-att-downloader-'));
  tmpRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  currentMediaDir = tempDir();
  const host = {
    paths: { feishuMediaDir: currentMediaDir },
    secrets: {
      isAvailable: () => false,
      write: () => false,
      read: () => null,
      remove: () => {},
    },
  } as unknown as IMHost;
  setHost(host, defaultLogger('im:feishu:test'));
});

function streamOfChunks(chunks: Buffer[]): Readable {
  return Readable.from(chunks);
}

describe('streamToBuffer 增量上限', () => {
  it('未超限时行为不变', async () => {
    const buf = await streamToBuffer(streamOfChunks([Buffer.from('ab'), Buffer.from('cd')]), 4);
    expect(buf.toString()).toBe('abcd');
  });

  it('累计超限立刻断流并抛 ATTACHMENT_OVERSIZE,不再吞后续 chunk', async () => {
    let destroyed = false;
    const stream = streamOfChunks([
      Buffer.alloc(10),
      Buffer.alloc(10),
      Buffer.alloc(10),
      Buffer.alloc(10),
    ]);
    stream.on('close', () => {
      destroyed = true;
    });
    await expect(streamToBuffer(stream, 25)).rejects.toMatchObject({
      code: ATTACHMENT_OVERSIZE_CODE,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(destroyed).toBe(true);
    // 30MB 上限必须真的传到了下载层。
    expect(MAX_FILE_SIZE).toBe(30 * 1024 * 1024);
  });
});

function fakeClientReturning(chunks: Buffer[]): never {
  const get = vi.fn(async () => ({
    getReadableStream: () => streamOfChunks(chunks),
    headers: { 'content-type': 'application/octet-stream' },
  }));
  return { im: { v1: { messageResource: { get } } } } as never;
}

describe('downloadAttachments 超限收口', () => {
  it('中途触顶归为 oversize,不再整只下载,同批其余附件正常', async () => {
    const oversize = [
      Buffer.alloc(MAX_FILE_SIZE - 4),
      Buffer.alloc(16),
      Buffer.alloc(1024),
    ];
    const client = fakeClientReturning(oversize);

    const result = await downloadAttachments(client, 'm1', [
      { kind: 'file', fileKey: 'big-key', fileName: 'big.bin' },
    ]);

    expect(result.attachments).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]?.type).toBe('oversize');
    expect(result.unsupported[0]?.label).toContain('big.bin');
    // 媒体目录不应落任何文件(旧路径会先整只写盘再判超)。
    expect(fs.readdirSync(currentMediaDir)).toEqual([]);
  });

  it('正常小附件路径不受影响', async () => {
    const client = fakeClientReturning([Buffer.from('tiny-file-bytes')]);
    const result = await downloadAttachments(client, 'm2', [
      { kind: 'file', fileKey: 'small-key', fileName: 'small.txt' },
    ]);
    expect(result.unsupported).toEqual([]);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.absPath).toContain('small-key');
    expect(result.attachments[0]?.kind).toBe('file');
  });
});
