import type { HistoryMessageSource, HistoryViewSnapshot } from '@cindy/maker-shared/message-window';
import {
  decodeRemoteHistory,
  encodeRemoteHistory,
  MAX_HISTORY_CACHE_CHARS,
} from '../../shared/remoteHistoryCache';
import {
  readCachedMessages,
  persistCachedMessages,
  clearCachedMessages,
  sessionCacheInvalidationToken,
  invalidationAtRequestStart,
  ownerTokenAtRequestStart,
  accountCounterAtRequestStart,
} from '@/features/device-link/mirrorCacheClient';
import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
} from '@/contexts/dataOwnerGeneration';

/** Capture before the remote read, never when the eventual snapshot is written. */
export function remoteHistoryCacheWriter(deviceId: string, sessionId: string) {
  const owner = getDataOwnerGeneration();
  const token = sessionCacheInvalidationToken(sessionId);
  const invalidation = invalidationAtRequestStart(deviceId, sessionId);
  const ownerToken = ownerTokenAtRequestStart(sessionId);
  const account = accountCounterAtRequestStart(sessionId);
  return <T extends HistoryMessageSource>(snapshot: HistoryViewSnapshot<T>) => {
    if (
      !isDataOwnerGenerationCurrent(owner) ||
      token !== sessionCacheInvalidationToken(sessionId) ||
      !snapshot.ready ||
      snapshot.loading ||
      snapshot.error
    )
      return;
    const text = encodeRemoteHistory(snapshot);
    if (text.length > MAX_HISTORY_CACHE_CHARS) {
      clearCachedMessages(deviceId, sessionId);
      return;
    }
    persistCachedMessages(deviceId, sessionId, [], invalidation, ownerToken, account, text);
  };
}

export async function readRemoteHistoryCache<T extends HistoryMessageSource>(
  deviceId: string,
  sessionId: string,
): Promise<HistoryViewSnapshot<T> | null> {
  const token = sessionCacheInvalidationToken(sessionId);
  let snapshot: HistoryViewSnapshot<T> | null = null;
  await readCachedMessages(deviceId, sessionId, (value) => {
    snapshot = decodeRemoteHistory<T>(value);
  });
  return token === sessionCacheInvalidationToken(sessionId) ? snapshot : null;
}
