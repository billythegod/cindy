import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLinuxAurInstallation } from '../linuxAurInstallation';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const executablePath = '/usr/lib/cindy/Cindy';

beforeEach(() => {
  vi.mocked(execFileSync).mockReset();
  vi.spyOn(fs, 'realpathSync').mockReturnValue(executablePath);
});

afterEach(() => vi.restoreAllMocks());

describe('Linux AUR installation detection', () => {
  it.each(['cindy-bin', 'cindy-cn-bin'])('recognizes only pacman ownership by %s', (owner) => {
    const query = vi.fn(() => owner + '\n');
    expect(isLinuxAurInstallation(executablePath, 'linux', query)).toBe(true);
    expect(query).toHaveBeenCalledWith(executablePath);
  });

  it.each(['', 'cindy', 'cindydev', 'cindy-bin-debug', 'other cindy-bin', 'cindy-bin\nother'])(
    'does not classify %j as a supported AUR owner',
    (owner) => {
      expect(isLinuxAurInstallation(executablePath, 'linux', () => owner)).toBe(false);
    },
  );

  it('queries the real executable with bounded, read-only pacman arguments', () => {
    vi.mocked(execFileSync).mockReturnValue('cindy-cn-bin\n');
    expect(isLinuxAurInstallation('/usr/bin/cindy', 'linux')).toBe(true);
    expect(fs.realpathSync).toHaveBeenCalledWith('/usr/bin/cindy');
    expect(execFileSync).toHaveBeenCalledWith('/usr/bin/pacman', ['-Qqo', '--', executablePath], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 4_096,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it.each(['ENOENT', 'EACCES', 'ETIMEDOUT'])('preserves the existing path on %s', (code) => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('query unavailable'), { code });
    });
    expect(isLinuxAurInstallation(executablePath, 'linux')).toBe(false);
  });

  it('does not query pacman if the executable cannot be resolved', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(isLinuxAurInstallation(executablePath, 'linux')).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each(['darwin', 'win32'] as const)('does not query on %s', (platform) => {
    const query = vi.fn(() => 'cindy-bin');
    expect(isLinuxAurInstallation(executablePath, platform, query)).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(fs.realpathSync).not.toHaveBeenCalled();
  });
});
