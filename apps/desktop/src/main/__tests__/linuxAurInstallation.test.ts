import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLinuxAurInstallation } from '../linuxAurInstallation';

const execFileMock = vi.hoisted(() =>
  vi.fn<
    (
      file: string,
      args: readonly string[],
      options: { encoding: string; timeout: number; maxBuffer: number },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => ChildProcess
  >(),
);

vi.mock('node:child_process', () => ({ execFile: execFileMock }));

const executablePath = '/usr/lib/cindy/Cindy';

beforeEach(() => {
  execFileMock.mockReset();
  execFileMock.mockImplementation((...args) => {
    args[3](null, 'cindy-cn-bin', '');
    return {} as ChildProcess;
  });
  vi.spyOn(fs, 'realpath').mockResolvedValue(executablePath);
});

afterEach(() => vi.restoreAllMocks());

describe('Linux AUR installation detection', () => {
  it.each(['cindy-bin', 'cindy-cn-bin'])(
    'recognizes only pacman ownership by %s',
    async (owner) => {
      const query = vi.fn(async () => owner + String.fromCharCode(10));
      await expect(isLinuxAurInstallation(executablePath, 'linux', query)).resolves.toBe(true);
      expect(query).toHaveBeenCalledWith(executablePath);
    },
  );

  it.each([
    '',
    'cindy',
    'cindydev',
    'cindy-bin-debug',
    'other cindy-bin',
    'cindy-bin' + String.fromCharCode(10) + 'other',
  ])('does not classify %j as a supported AUR owner', async (owner) => {
    await expect(isLinuxAurInstallation(executablePath, 'linux', async () => owner)).resolves.toBe(
      false,
    );
  });

  it('queries the real executable with bounded, read-only pacman arguments', async () => {
    await expect(isLinuxAurInstallation('/usr/bin/cindy', 'linux')).resolves.toBe(true);
    expect(fs.realpath).toHaveBeenCalledWith('/usr/bin/cindy');
    expect(execFileMock).toHaveBeenCalledWith(
      '/usr/bin/pacman',
      ['-Qqo', '--', executablePath],
      {
        encoding: 'utf8',
        timeout: 2_000,
        maxBuffer: 4_096,
      },
      expect.any(Function),
    );
  });

  it('allows the event loop to progress while waiting for pacman', async () => {
    execFileMock.mockImplementation(() => ({}) as ChildProcess);
    const settled = vi.fn();
    const pending = isLinuxAurInstallation(executablePath, 'linux').then(settled);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(execFileMock).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();
    execFileMock.mock.calls[0][3](null, 'cindy-bin', '');
    await pending;
    expect(settled).toHaveBeenCalledWith(true);
  });

  it.each(['ENOENT', 'EACCES', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])(
    'preserves the existing path on asynchronous %s',
    async (code) => {
      execFileMock.mockImplementation((...args) => {
        args[3](Object.assign(new Error('query unavailable'), { code }), 'cindy-bin', '');
        return {} as ChildProcess;
      });
      await expect(isLinuxAurInstallation(executablePath, 'linux')).resolves.toBe(false);
    },
  );

  it('preserves the existing path when starting pacman throws', async () => {
    execFileMock.mockImplementation(() => {
      throw new Error('spawn unavailable');
    });
    await expect(isLinuxAurInstallation(executablePath, 'linux')).resolves.toBe(false);
  });

  it('does not query pacman if the executable cannot be resolved', async () => {
    vi.mocked(fs.realpath).mockRejectedValue(new Error('unavailable'));
    await expect(isLinuxAurInstallation(executablePath, 'linux')).resolves.toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('preserves the existing path when the injected query rejects', async () => {
    await expect(
      isLinuxAurInstallation(executablePath, 'linux', async () => {
        throw new Error('query unavailable');
      }),
    ).resolves.toBe(false);
  });

  it.each(['darwin', 'win32'] as const)('does not query on %s', async (platform) => {
    const query = vi.fn(async () => 'cindy-bin');
    await expect(isLinuxAurInstallation(executablePath, platform, query)).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(fs.realpath).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
