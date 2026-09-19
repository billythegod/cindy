import { expect, it, vi } from 'vitest';
import { ClipboardSync, type RemoteDesktopCapabilities } from '@cindy/device-link';
import { DEFAULT_VIEWER_PREFERENCES } from '../../../shared/remoteDesktopViewer';
import { ViewerSafety } from '../safety';

function fixture() {
  const safety = new ViewerSafety();
  const request = vi.fn(async () => ({ enabled: true })) as any;
  const options = {
    lease: 'lease',
    caps: { privacyScreen: true, hostMute: true, clipboardSync: true } as RemoteDesktopCapabilities,
    preferences: { ...DEFAULT_VIEWER_PREFERENCES, privacyScreen: true, hostMute: true },
    current: () => true,
    clipboardCurrent: () => false,
    request,
  };
  return { safety, options, request };
}
it('applies preferences once and prioritizes privacy failures over mute failures', async () => {
  const { safety, options, request } = fixture();
  request.mockRejectedValue(new Error('DESKTOP_UNAVAILABLE'));
  expect((await safety.tick(options)).notice).toBe('privacyFailed');
  const count = request.mock.calls.length;
  await safety.tick(options);
  expect(request.mock.calls.length).toBe(count);
  safety.invalidate();
  request.mockResolvedValue({ enabled: true });
  expect(await safety.tick(options)).toMatchObject({ privacyActive: true, notice: null });
});
it('does not apply opt-ins without confirmed control', async () => {
  const { safety, options, request } = fixture();
  await safety.tick({ ...options, current: () => false });
  expect(request).not.toHaveBeenCalled();
});
it('pauses until old work settles and discards its late success', async () => {
  const { safety, options, request } = fixture();
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = safety.tick(options);
  let paused = false;
  const pause = safety.pause().then(() => {
    paused = true;
  });
  await Promise.resolve();
  expect(paused).toBe(false);
  finish({ enabled: true });
  await Promise.all([pending, pause]);
  expect(safety.snapshot()).toMatchObject({ privacyActive: false, notice: null });
  expect(request).toHaveBeenCalledTimes(1);
});

it('keeps conflict feedback until content is actually synchronized', async () => {
  const { safety, options } = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const tick = vi
    .spyOn(ClipboardSync.prototype, 'tick')
    .mockRejectedValueOnce(new Error('CLIPBOARD_CONFLICT'))
    .mockResolvedValue(undefined);
  const sync = {
    ...options,
    preferences: { ...options.preferences, clipboardSync: true },
    clipboardCurrent: () => true,
    clipboard: { version: async () => 'v', read: async () => '{}', write: async () => 'v' },
  };
  try {
    expect((await safety.tick(sync)).notice).toBe('clipboardSyncConflict');
    now.mockReturnValue(12000);
    expect((await safety.tick(sync)).notice).toBe('clipboardSyncConflict');
  } finally {
    now.mockRestore();
    tick.mockRestore();
  }
});
