import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-cache-versions-'));
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }));
vi.mock('../../appSessionState.js', () => ({
  activeOwnerScopeKey: () => 'owner:1',
  dataOwnerStorageKey: (id: string) => id,
}));
vi.mock('../../logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

const {
  fetchRemoteFileToCache,
  putCachedContent,
  findStaleCached,
  getRemoteFileCacheRoot,
  __cacheTesting,
} = await import('../remote-file-cache');
const id = {
  transport: 'device' as const,
  endpointId: 'device',
  workdir: '/repo',
  relPath: 'a.txt',
  size: 3,
  mtimeMs: 1000.1,
};
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

it.each([true, false])(
  'retains both returned versions when old finishes last: %s',
  async (oldLast) => {
    const newer = { ...id, mtimeMs: 2000 };
    const oldPath = __cacheTesting.cachePathFor(id);
    const newPath = __cacheTesting.cachePathFor(newer);
    // Make the background cleanup's directory listing deterministic, including
    // both versions. The real filesystem still handles writes, stats and removals.
    vi.spyOn(fs, 'readdir').mockResolvedValue([
      path.basename(oldPath),
      path.basename(newPath),
    ] as never);
    const remove = vi.spyOn(fs, 'rm');
    const started = barrier();
    const release = barrier();
    const slow = fetchRemoteFileToCache(
      oldLast ? id : newer,
      async (dest) => {
        started.resolve();
        await release.promise;
        await fs.writeFile(dest, oldLast ? 'old' : 'new');
      },
      vi.fn(),
    );
    await started.promise;
    try {
      await fetchRemoteFileToCache(
        oldLast ? newer : id,
        (dest) => fs.writeFile(dest, oldLast ? 'new' : 'old'),
        vi.fn(),
      );
    } finally {
      release.resolve();
    }
    await slow;
    await __cacheTesting.evictLru();
    expect(remove.mock.calls.some(([p]) => p === oldPath || p === newPath)).toBe(false);
    expect(await fs.readFile(oldPath, 'utf8')).toBe('old');
    expect(await fs.readFile(newPath, 'utf8')).toBe('new');
  },
);

it('downloads long multibyte filenames using a short independent staging name', async () => {
  const file = { ...id, relPath: `${'文'.repeat(60)}.txt` };
  const result = await fetchRemoteFileToCache(file, (dest) => fs.writeFile(dest, 'new'), vi.fn());
  expect(await fs.readFile(result, 'utf8')).toBe('new');
});

it('distinguishes same-size sub-millisecond versions in downloads and write-through', async () => {
  await putCachedContent(id, 'old');
  const changed = { ...id, mtimeMs: 1000.2 };
  const executor = vi.fn((dest: string) => fs.writeFile(dest, 'new'));
  const newPath = await fetchRemoteFileToCache(changed, executor, vi.fn());
  expect(executor).toHaveBeenCalledOnce();
  expect(await fs.readFile(newPath, 'utf8')).toBe('new');
  const hit = vi.fn();
  expect(await fetchRemoteFileToCache(changed, hit, vi.fn())).toBe(newPath);
  expect(hit).not.toHaveBeenCalled();
  await putCachedContent({ ...id, mtimeMs: 1000.3 }, 'end');
  expect(await fs.readFile(__cacheTesting.cachePathFor({ ...id, mtimeMs: 1000.3 }), 'utf8')).toBe(
    'end',
  );
});

it('keeps legacy rounded copies available offline without accepting them as exact hits', async () => {
  const exact = { ...id, mtimeMs: 1000 };
  const currentPath = __cacheTesting.cachePathFor(exact);
  const legacy = path.join(
    getRemoteFileCacheRoot(),
    `${path.basename(currentPath).split('-')[0]}-3-1000-a.txt`,
  );
  await fs.mkdir(getRemoteFileCacheRoot(), { recursive: true });
  await fs.writeFile(legacy, 'old');
  expect(await findStaleCached(exact)).toBe(legacy);
  const executor = vi.fn((dest: string) => fs.writeFile(dest, 'new'));
  expect(await fetchRemoteFileToCache(exact, executor, vi.fn())).toBe(currentPath);
  expect(executor).toHaveBeenCalledOnce();
  expect(await fs.readFile(currentPath, 'utf8')).toBe('new');
});

it.each(['resolve', 'reject'] as const)(
  'isolates a retry from a cancelled executor that later %ss',
  async (settle) => {
    const oldStarted = barrier();
    const releaseOld = barrier();
    const newStarted = barrier();
    const releaseNew = barrier();
    const controller = new AbortController();
    let oldTemp = '';
    let newTemp = '';
    const first = fetchRemoteFileToCache(
      id,
      async (dest) => {
        oldTemp = dest;
        await fs.writeFile(dest, 'old');
        oldStarted.resolve();
        await releaseOld.promise;
        if (settle === 'reject') throw new Error('late failure');
        // Deliberately ignore abort and attempt to finish with stale bytes.
      },
      vi.fn(),
      controller.signal,
    );
    await oldStarted.promise;
    controller.abort();
    await expect(first).rejects.toThrow('FILE_PEER_CANCELLED');
    const replacement = vi.fn(async (dest: string) => {
      newTemp = dest;
      await fs.writeFile(dest, 'new');
      newStarted.resolve();
      await releaseNew.promise;
    });
    const retry = fetchRemoteFileToCache(id, replacement, vi.fn());
    try {
      await newStarted.promise;
      expect(newTemp).not.toBe(oldTemp);
      releaseOld.resolve();
      await vi.waitFor(async () => {
        await expect(fs.stat(oldTemp)).rejects.toMatchObject({ code: 'ENOENT' });
      });
      expect(await fs.readFile(newTemp, 'utf8')).toBe('new');
      const unexpected = vi.fn();
      const joined = fetchRemoteFileToCache(id, unexpected, vi.fn());
      releaseNew.resolve();
      const result = await retry;
      expect(await joined).toBe(result);
      expect(unexpected).not.toHaveBeenCalled();
      expect(await fs.readFile(result, 'utf8')).toBe('new');
    } finally {
      releaseOld.resolve();
      releaseNew.resolve();
      await retry.catch(() => undefined);
    }
  },
);

it('does not start work for an already cancelled caller', async () => {
  const controller = new AbortController();
  controller.abort();
  const executor = vi.fn();
  await expect(fetchRemoteFileToCache(id, executor, vi.fn(), controller.signal)).rejects.toThrow(
    'FILE_PEER_CANCELLED',
  );
  expect(executor).not.toHaveBeenCalled();
});
