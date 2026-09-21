import { beforeEach, describe, expect, it, vi } from 'vitest';

const gitExecMock = vi.hoisted(() => vi.fn());

vi.mock('../worktree/gitExec', () => ({
  gitExec: (...args: unknown[]) => gitExecMock(...args),
}));

import { isolatedGitExec, snapshotGitIsolationArgs } from '../git-snapshot/isolatedGitExec';

describe('isolatedGitExec', () => {
  beforeEach(() => {
    gitExecMock.mockReset();
    gitExecMock.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('disables repository-local fsmonitor, hooks, and LFS filters', async () => {
    await isolatedGitExec(['status', '--porcelain=v1', '-z'], '/repo');

    expect(gitExecMock).toHaveBeenCalledOnce();
    const [args, cwd] = gitExecMock.mock.calls[0] as [string[], string];
    expect(cwd).toBe('/repo');
    expect(args).toContain('core.fsmonitor=');
    expect(args).toContain('core.useBuiltinFSMonitor=false');
    expect(args).toContain('filter.lfs.clean=');
    expect(args).toContain('filter.lfs.smudge=');
    expect(args).toContain('filter.lfs.process=');
    expect(args.some((arg) => arg.startsWith('core.hooksPath='))).toBe(true);
    expect(args[args.length - 3]).toBe('status');
    expect(args.slice(-2)).toEqual(['--porcelain=v1', '-z']);
  });

  it('keeps isolation args ahead of the git subcommand', () => {
    const args = snapshotGitIsolationArgs('/tmp/empty-hooks');
    expect(args.indexOf('core.fsmonitor=')).toBeLessThan(args.length);
    expect(args[1]).toBe('core.hooksPath=/tmp/empty-hooks');
  });
});
