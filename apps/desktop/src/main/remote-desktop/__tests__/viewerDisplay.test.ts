import { describe, expect, it, vi } from 'vitest';
import { RemoteDesktopController, type DesktopControllerDeps } from '../controller';
import type { RemoteDesktopLease } from '@cindy/device-link';
import type { ViewerDisplayHandle } from '../viewerDisplay';

function fixture() {
  const handle: ViewerDisplayHandle = {
    resize: vi.fn(async (width, height) => ({ id: '2', name: 'Viewer', width, height })),
    restore: vi.fn(async () => ({ id: '1', name: 'Main', width: 1920, height: 1080 })),
    dispose: vi.fn(),
  };
  const deps: DesktopControllerDeps = {
    authorized: () => true,
    capabilities: async () => ({
      version: 1,
      enabled: true,
      canControl: true,
      platform: 'darwin',
      displays: [{ id: '1', name: 'Main', width: 1920, height: 1080 }],
    }),
    frame: vi.fn(async () => 'jpeg'),
    startInput: vi.fn(async () => {}),
    input: vi.fn(),
    stopInput: vi.fn(),
    stopVideo: vi.fn(),
    offer: vi.fn(async () => 'answer'),
    changed: vi.fn(),
    createViewerDisplay: vi.fn(async () => handle),
  };
  const host = new RemoteDesktopController(deps);
  const start = async (control = true) => {
    const lease = (await host.request('phone', {
      op: 'start',
      displayId: '1',
    })) as RemoteDesktopLease;
    if (control) await host.request('phone', { op: 'control', lease: lease.lease, enabled: true });
    return lease;
  };
  return { host, deps, handle, start };
}

describe('viewer-sized desktop ownership', () => {
  it('waits for held inputs to release and cancels before creating a display after disconnect', async () => {
    const f = fixture(),
      lease = await f.start();
    let release!: () => void;
    f.deps.releaseInput = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = f.host.request('phone', {
      op: 'viewerDisplay',
      lease: lease.lease,
      width: 900,
      height: 1600,
    });
    expect(f.deps.createViewerDisplay).not.toHaveBeenCalled();
    f.host.stop('phone');
    release();
    await expect(pending).rejects.toThrow('DESKTOP_LEASE_EXPIRED');
    expect(f.deps.createViewerDisplay).not.toHaveBeenCalled();
  });
  it('keeps the lease, replaces geometry and requires fresh control before input', async () => {
    const f = fixture(),
      lease = await f.start();
    const result = await f.host.request('phone', {
      op: 'viewerDisplay',
      lease: lease.lease,
      width: 900,
      height: 1600,
    });
    expect(result).toEqual({
      lease: lease.lease,
      display: { id: '2', name: 'Viewer', width: 900, height: 1600 },
      controlling: false,
    });
    expect(f.host.hasLease(lease.lease)).toBe(true);
    await expect(
      f.host.request('phone', {
        op: 'input',
        lease: lease.lease,
        sequence: 1,
        events: [{ kind: 'move', x: 0.5, y: 0.5 }],
      }),
    ).rejects.toThrow('DESKTOP_VIEW_ONLY');
    await f.host.request('phone', { op: 'control', lease: lease.lease, enabled: true });
    expect(f.deps.startInput).toHaveBeenLastCalledWith('2');
    await f.host.request('phone', {
      op: 'viewerDisplay',
      lease: lease.lease,
      width: 1600,
      height: 900,
    });
    expect(f.deps.createViewerDisplay).toHaveBeenCalledTimes(1);
    f.host.stop();
    expect(f.handle.dispose).toHaveBeenCalledOnce();
  });

  it('restores the original display without replacing the lease and can match again', async () => {
    const f = fixture(),
      lease = await f.start();
    await f.host.request('phone', {
      op: 'viewerDisplay',
      lease: lease.lease,
      width: 900,
      height: 1600,
    });
    await expect(
      f.host.request('phone', { op: 'restoreViewerDisplay', lease: lease.lease }),
    ).rejects.toThrow('DESKTOP_VIEW_ONLY');
    await f.host.request('phone', { op: 'control', lease: lease.lease, enabled: true });
    const result = await f.host.request('phone', {
      op: 'restoreViewerDisplay',
      lease: lease.lease,
    });
    expect(result).toEqual({
      lease: lease.lease,
      controlling: false,
      display: { id: '1', name: 'Main', width: 1920, height: 1080 },
    });
    expect(f.handle.restore).toHaveBeenCalledOnce();
    expect(f.host.hasLease(lease.lease)).toBe(true);
    expect(f.host.displayGeometryMatches('1', 1920, 1080)).toBe(true);
    await f.host.request('phone', { op: 'control', lease: lease.lease, enabled: true });
    await f.host.request('phone', {
      op: 'viewerDisplay',
      lease: lease.lease,
      width: 1600,
      height: 900,
    });
    expect(f.deps.createViewerDisplay).toHaveBeenCalledTimes(2);
  });

  it('rejects view-only and foreign peers without changing displays', async () => {
    const f = fixture(),
      lease = await f.start(false);
    const request = { op: 'viewerDisplay', lease: lease.lease, width: 900, height: 1600 };
    await expect(f.host.request('phone', request)).rejects.toThrow('DESKTOP_VIEW_ONLY');
    await expect(f.host.request('other', request)).rejects.toThrow('DESKTOP_LEASE_EXPIRED');
    expect(f.deps.createViewerDisplay).not.toHaveBeenCalled();
  });

  it('disposes a late native handle after disconnect and cannot revive the lease', async () => {
    const f = fixture(),
      lease = await f.start();
    let resolve!: (handle: ViewerDisplayHandle) => void;
    f.deps.createViewerDisplay = () =>
      new Promise((done) => {
        resolve = done;
      });
    const pending = f.host.request('phone', {
      op: 'viewerDisplay',
      lease: lease.lease,
      width: 900,
      height: 1600,
    });
    f.host.stop('phone');
    resolve(f.handle);
    await expect(pending).rejects.toThrow('DESKTOP_LEASE_EXPIRED');
    expect(f.handle.dispose).toHaveBeenCalledOnce();
    expect(f.handle.resize).not.toHaveBeenCalled();
    expect(f.host.state).toBeNull();
  });

  it('drops old geometry input/frames while resizing and bounds concurrent changes', async () => {
    const f = fixture(),
      lease = await f.start();
    let finish!: () => void;
    f.handle.resize = () =>
      new Promise((resolve) => {
        finish = () => resolve({ id: '2', name: 'Viewer', width: 900, height: 1600 });
      });
    const request = { op: 'viewerDisplay', lease: lease.lease, width: 900, height: 1600 };
    const pending = f.host.request('phone', request);
    await Promise.resolve();
    expect(f.host.changingDisplay).toBe(true);
    await expect(f.host.request('phone', request)).rejects.toThrow('DESKTOP_DISPLAY_BUSY');
    await expect(
      f.host.request('other', { op: 'start', displayId: '1', takeover: true }),
    ).rejects.toThrow('DESKTOP_BUSY');
    f.host.input(lease.lease, 1, [{ kind: 'move', x: 0.5, y: 0.5 }]);
    expect(f.deps.input).not.toHaveBeenCalled();
    expect(await f.host.request('phone', { op: 'frame', lease: lease.lease })).toEqual({
      jpeg: null,
    });
    finish();
    await pending;
    expect(f.host.changingDisplay).toBe(false);
  });

  it('ends the lease and releases the temporary display on native failure', async () => {
    const f = fixture(),
      lease = await f.start();
    f.handle.resize = async () => {
      throw new Error('DISPLAY_MIRROR_FAILED');
    };
    await expect(
      f.host.request('phone', {
        op: 'viewerDisplay',
        lease: lease.lease,
        width: 900,
        height: 1600,
      }),
    ).rejects.toThrow();
    expect(f.handle.dispose).toHaveBeenCalledOnce();
    expect(f.host.state).toBeNull();
  });
});
