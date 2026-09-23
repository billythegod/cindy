/**
 * `maker:agent:binary-version` — About 页的本地版本与线上更新判断。
 *
 * 普通调用不能等网络（离线时关于页要立刻显示本地版本）；checkLatest 只在线上
 * 版本严格更高时报告可更新，与启动安装「保留不旧于 manifest 的本地版本」同口径。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fetchManifest: vi.fn(),
  execFile: vi.fn(),
  versions: new Map<string, string>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      h.handlers.set(channel, handler);
    }),
  },
}));
vi.mock('node:child_process', () => ({ execFile: h.execFile }));
vi.mock('../../logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../pi-kernel.js', () => ({ registerPiKernelIpc: vi.fn() }));
vi.mock('../../manifestService.js', () => ({ fetchManifest: h.fetchManifest }));
vi.mock('../../agent-binaries/index.js', () => ({
  getReadyBinaryPath: (kind: string) => `/managed/${kind}`,
  getCachedBinaryStatus: () => ({ binaryReady: false, binaryPath: null }),
  isVettedAgentBinaryPath: () => true,
}));

const { registerMakerBinaryVersionIpc } = await import('../binary-version.js');
const { MAKER_INVOKE } = await import('../channels.js');

function invoke(kind: unknown, options?: unknown) {
  const handler = h.handlers.get(MAKER_INVOKE.AGENT_BINARY_VERSION);
  if (!handler) throw new Error('handler not registered');
  return handler({}, kind, options) as Promise<{
    version: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
  }>;
}

describe('maker:agent:binary-version', () => {
  beforeEach(() => {
    h.handlers.clear();
    h.fetchManifest.mockReset();
    h.versions.clear();
    h.execFile.mockReset().mockImplementation((
      binaryPath: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, h.versions.get(binaryPath) ?? '', '');
    });
    registerMakerBinaryVersionIpc();
  });

  it('returns the local version without touching the network', async () => {
    h.versions.set('/managed/claude-code', '2.1.258 (Claude Code)');
    h.fetchManifest.mockReturnValue(new Promise(() => {}));

    await expect(invoke('claude-code')).resolves.toMatchObject({
      version: '2.1.258 (Claude Code)',
      latestVersion: null,
      updateAvailable: false,
    });
    expect(h.fetchManifest).not.toHaveBeenCalled();
  });

  it('reports an update only when the channel version is strictly newer', async () => {
    h.versions.set('/managed/codex', 'codex-cli 0.145.0');
    h.fetchManifest.mockResolvedValue({ codexPackage: { version: '0.146.0' } });
    await expect(invoke('codex', { checkLatest: true })).resolves.toMatchObject({
      latestVersion: '0.146.0',
      updateAvailable: true,
    });
  });

  it('does not offer an update from a legacy codex manifest field the installer cannot consume', async () => {
    h.versions.set('/managed/codex', 'codex-cli 0.145.0');
    h.fetchManifest.mockResolvedValue({ codex: { version: '0.146.0' } });
    await expect(invoke('codex', { checkLatest: true })).resolves.toMatchObject({
      latestVersion: null,
      updateAvailable: false,
    });
  });

  it.each(['0.145.0', '0.144.9'])('does not offer a no-op update when the channel has %s', async (latest) => {
    h.versions.set('/managed/codex', 'codex-cli 0.145.0');
    h.fetchManifest.mockResolvedValue({ codexPackage: { version: latest } });
    await expect(invoke('codex', { checkLatest: true })).resolves.toMatchObject({
      latestVersion: latest,
      updateAvailable: false,
    });
  });

  it('never offers the About update for Pi, which has its own kernel manager', async () => {
    h.versions.set('/managed/pi', 'pi 0.84.4');
    h.fetchManifest.mockResolvedValue({ pi: { version: '0.90.0' } });
    await expect(invoke('pi', { checkLatest: true })).resolves.toMatchObject({ updateAvailable: false });
  });

  it('keeps the local version when the manifest is unreachable', async () => {
    h.versions.set('/managed/claude-code', '2.1.258 (Claude Code)');
    h.fetchManifest.mockRejectedValue(new Error('offline'));
    await expect(invoke('claude-code', { checkLatest: true })).resolves.toMatchObject({
      version: '2.1.258 (Claude Code)',
      latestVersion: null,
      updateAvailable: false,
    });
  });

  it('rejects malformed options', async () => {
    await expect(invoke('codex', { checkLatest: 'yes' })).rejects.toThrow();
    await expect(invoke('codex', 'checkLatest')).rejects.toThrow();
  });
});
