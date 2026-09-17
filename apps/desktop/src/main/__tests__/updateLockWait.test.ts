import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { shouldKeepWaitingForWindowsUpdateLock } from '../updateLockWait';

describe('Windows update lock wait', () => {
  it('keeps waiting after 30s when Retry still owns .updating', () => {
    expect(
      shouldKeepWaitingForWindowsUpdateLock({
        lockExists: true,
        elapsedMs: 30_000,
        maxWaitMs: 30_000,
        holderPid: 4242,
        holderAlive: true,
        unlinkFailed: true,
      }),
    ).toBe(true);
  });

  it('attempts unlink after the timeout even if a live PID was recycled', () => {
    expect(
      shouldKeepWaitingForWindowsUpdateLock({
        lockExists: true,
        elapsedMs: 30_000,
        maxWaitMs: 30_000,
        holderPid: 4242,
        holderAlive: true,
        unlinkFailed: false,
      }),
    ).toBe(false);
  });

  it('keeps waiting when unlink fails because the updater still holds the file', () => {
    expect(
      shouldKeepWaitingForWindowsUpdateLock({
        lockExists: true,
        elapsedMs: 45_000,
        maxWaitMs: 30_000,
        holderPid: 4242,
        holderAlive: false,
        unlinkFailed: true,
      }),
    ).toBe(true);
  });

  it('is used by Windows startup instead of a fixed 30s break', () => {
    const source = fs.readFileSync(
      new URL('../bootstrap-electron.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('shouldKeepWaitingForWindowsUpdateLock');
  });

  it('stops waiting once the lock is gone', () => {
    expect(
      shouldKeepWaitingForWindowsUpdateLock({
        lockExists: false,
        elapsedMs: 1_000,
        maxWaitMs: 30_000,
        holderPid: null,
        holderAlive: false,
        unlinkFailed: false,
      }),
    ).toBe(false);
  });
});
