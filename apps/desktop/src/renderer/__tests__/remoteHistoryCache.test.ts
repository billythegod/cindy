import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HistoryViewController,
  projectHistoryView,
  type HistoryViewSnapshot,
} from '@cindy/maker-shared/message-window';
import { encodeRemoteHistory } from '../../shared/remoteHistoryCache';
import { readRemoteHistoryCache, remoteHistoryCacheWriter } from '../lib/remoteHistoryCache';
import {
  clearCachedMessages,
  clearMirrorCacheAccountState,
} from '../features/device-link/mirrorCacheClient';
import { setDataOwnerGeneration } from '../contexts/dataOwnerGeneration';

const row = {
  id: 'm',
  clientId: 'm',
  role: 'user',
  content: 'cached text',
  createdAt: '2026-09-17T00:00:00Z',
};
const snapshot: HistoryViewSnapshot<typeof row> = {
  items: projectHistoryView([row], false),
  details: new Map(),
  expanded: new Set(),
  nextCursor: null,
  hasMore: false,
  ready: true,
  loading: false,
  error: null,
};
const getMessages = vi.fn();
const putMessages = vi.fn();
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
beforeEach(() => {
  clearMirrorCacheAccountState();
  setDataOwnerGeneration('owner');
  getMessages
    .mockReset()
    .mockResolvedValue({
      messages: [],
      historyView: encodeRemoteHistory(snapshot),
      invalidation: 0,
      ownerToken: 'owner-token',
      accountCounter: 0,
    });
  putMessages.mockReset().mockResolvedValue({ ok: true, invalidation: 0 });
  vi.stubGlobal('window', {
    electronAPI: { deviceLink: { mirrorCache: { getMessages, putMessages } } },
  });
});
afterEach(() => {
  clearMirrorCacheAccountState();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('structured history mirror lifecycle', () => {
  it('does not let a writer waiting for clear A cross clear B', async () => {
    await readRemoteHistoryCache('dev', 'session');
    let finishA!: (value: unknown) => void;
    let finishB!: (value: unknown) => void;
    putMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishA = resolve;
        }),
    );
    clearCachedMessages('dev', 'session');
    remoteHistoryCacheWriter('dev', 'session')(snapshot);
    putMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishB = resolve;
        }),
    );
    clearCachedMessages('dev', 'session');
    const next = remoteHistoryCacheWriter('dev', 'session');
    finishA({ ok: true, invalidation: 1 });
    finishB({ ok: true, invalidation: 2 });
    await flush();
    expect(putMessages).toHaveBeenCalledTimes(2);
    next(snapshot);
    await flush();
    expect(putMessages.mock.calls[2][3]).toBe(2);
  });

  it('bounds a stalled clear and does not remember its response after owner change', async () => {
    vi.useFakeTimers();
    await readRemoteHistoryCache('dev', 'session');
    let finish!: (value: unknown) => void;
    putMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    clearCachedMessages('dev', 'session');
    remoteHistoryCacheWriter('dev', 'session')(snapshot);
    await vi.advanceTimersByTimeAsync(3000);
    expect(putMessages).toHaveBeenCalledTimes(2);
    expect(putMessages.mock.calls[1][3]).toBeUndefined();
    setDataOwnerGeneration('other');
    clearMirrorCacheAccountState();
    finish({ ok: true, invalidation: 99 });
    await flush();
    const { knownMainInvalidationFor } = await import('../features/device-link/mirrorCacheClient');
    expect(knownMainInvalidationFor('session')).toBeUndefined();
  });

  it('restores offline without a network read; fresh history wins over late disk', async () => {
    const page = vi.fn(async () => ({
      version: 1 as const,
      items: [],
      nextCursor: null,
      hasMore: false,
    }));
    const view = new HistoryViewController({ page, details: vi.fn(), expanded: vi.fn() });
    view.setNetworkAvailable(false);
    await view.restoreCachedView(() => readRemoteHistoryCache('dev', 'session'));
    expect(page).not.toHaveBeenCalled();
    expect(view.getSnapshot().items).toEqual(snapshot.items);
    view.setActive(false);
    const fresh = new HistoryViewController({ page, details: vi.fn(), expanded: vi.fn() });
    let finish!: (value: typeof snapshot) => void;
    const restore = fresh.restoreCachedView(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await fresh.refresh();
    finish(snapshot);
    await restore;
    expect(fresh.getSnapshot().items).toEqual([]);
    fresh.setActive(false);
  });

  it.each(['clear', 'owner'] as const)(
    'rejects late disk and pending writes across %s',
    async (boundary) => {
      await readRemoteHistoryCache('dev', 'session');
      const writer = remoteHistoryCacheWriter('dev', 'session');
      let finish!: (value: unknown) => void;
      getMessages.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const reading = readRemoteHistoryCache('dev', 'session');
      if (boundary === 'clear') clearCachedMessages('dev', 'session');
      else setDataOwnerGeneration('other');
      finish({
        messages: [],
        historyView: encodeRemoteHistory(snapshot),
        invalidation: 0,
        ownerToken: 'owner-token',
        accountCounter: 0,
      });
      expect(await reading).toBeNull();
      writer(snapshot);
      await flush();
      expect(putMessages.mock.calls.filter((call) => call[6] !== undefined)).toHaveLength(0);
    },
  );

  it('captures the pending clear counter for the new read, but rejects the old writer', async () => {
    await readRemoteHistoryCache('dev', 'session');
    const old = remoteHistoryCacheWriter('dev', 'session');
    let finish!: (value: unknown) => void;
    putMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    clearCachedMessages('dev', 'session');
    const next = remoteHistoryCacheWriter('dev', 'session');
    next(snapshot);
    old(snapshot);
    await flush();
    expect(putMessages).toHaveBeenCalledTimes(1);
    finish({ ok: true, invalidation: 1 });
    await flush();
    expect(putMessages).toHaveBeenCalledTimes(2);
    expect(putMessages.mock.calls[1][3]).toBe(1);
    expect(putMessages.mock.calls[1][6]).toBe(encodeRemoteHistory(snapshot));
  });
});
