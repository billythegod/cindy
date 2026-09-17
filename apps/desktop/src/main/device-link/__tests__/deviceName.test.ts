import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { deviceName } from '../deviceName';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:os', () => ({ default: { hostname: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  vi.mocked(os.hostname).mockReturnValue('DashdeMacBook-Pro.local');
});
afterEach(() => vi.restoreAllMocks());

describe('deviceName', () => {
  it('prefers the macOS ComputerName, preserving Chinese, spaces and literal suffixes', () => {
    vi.mocked(execFileSync).mockReturnValue('  Dash的 MacBook Pro.local\n');
    expect(deviceName()).toBe('Dash的 MacBook Pro.local');
    expect(execFileSync).toHaveBeenCalledWith('/usr/sbin/scutil', ['--get', 'ComputerName'], {
      encoding: 'utf8',
      timeout: 500,
      maxBuffer: 16 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(os.hostname).not.toHaveBeenCalled();
  });

  it('falls back when the OS lookup fails, including command timeout', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('scutil timed out'), { code: 'ETIMEDOUT' });
    });
    expect(deviceName()).toBe('DashdeMacBook-Pro');
  });

  it('falls back when ComputerName is blank', () => {
    vi.mocked(execFileSync).mockReturnValue(' \n');
    expect(deviceName()).toBe('DashdeMacBook-Pro');
  });

  it.each(['win32', 'linux'] as const)('does not run scutil on %s', (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    vi.mocked(os.hostname).mockReturnValue('  WORK-PC  ');
    expect(deviceName()).toBe('WORK-PC');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each([
    [' Mac.LOCAL. ', 'Mac'],
    ['Mac.local.example', 'Mac.local.example'],
    ['Mac.example.com', 'Mac.example.com'],
    [' ', 'Unknown Device'],
    ['.local', 'Unknown Device'],
  ])('normalizes fallback hostname %j to %j', (hostname, expected) => {
    vi.mocked(execFileSync).mockReturnValue('');
    vi.mocked(os.hostname).mockReturnValue(hostname);
    expect(deviceName()).toBe(expected);
  });
});
