/**
 * Windows startup must not enter the install directory while cindy-updater
 * still owns `.updating`. Retry reopens that handle with FILE_SHARE_READ, so
 * unlinkSync fails; a fixed 30s timeout is not enough for a large ZIP.
 */

export type WindowsUpdateLockWaitInput = {
  lockExists: boolean;
  elapsedMs: number;
  maxWaitMs: number;
  holderPid: number | null;
  holderAlive: boolean;
  unlinkFailed: boolean;
};

export function shouldKeepWaitingForWindowsUpdateLock(
  input: WindowsUpdateLockWaitInput,
): boolean {
  if (!input.lockExists) {
    return false;
  }
  if (input.unlinkFailed) {
    return true;
  }
  if (input.holderAlive && input.elapsedMs < input.maxWaitMs) {
    return true;
  }
  return input.elapsedMs < input.maxWaitMs;
}
