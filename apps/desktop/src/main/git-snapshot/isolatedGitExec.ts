/**
 * Snapshot Git invocations must not honor repository-local executable config.
 *
 * Turn-start snapshots now run by default on existing Git directories. A
 * complete attacker-supplied `.git/config` can set hooks, fsmonitor, filter
 * drivers, or diff textconv. Every snapshot `git` call overrides those keys.
 * Config enumeration is fail-closed: if drivers cannot be listed, the
 * snapshot is aborted instead of running unisolated Git.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  gitExec,
  type GitExecOpts,
  type GitExecResult,
} from '../worktree/gitExec';

let emptyHooksDir: Promise<string> | null = null;

const DRIVER_SETTING =
  /^(filter\.[^=]+\.(?:clean|smudge|process|required)|diff\.[^=]+\.(?:textconv|command)|merge\.[^=]+\.driver)=/i;

export class SnapshotGitIsolationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'SnapshotGitIsolationError';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

function toGitConfigPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function getEmptyHooksDir(): Promise<string> {
  if (!emptyHooksDir) {
    emptyHooksDir = fs.mkdtemp(path.join(os.tmpdir(), 'cindy-snapshot-hooks-'));
  }
  return emptyHooksDir;
}

export function snapshotGitIsolationArgs(hooksPath: string): string[] {
  return [
    '-c',
    `core.hooksPath=${toGitConfigPath(hooksPath)}`,
    '-c',
    'core.fsmonitor=',
    '-c',
    'core.useBuiltinFSMonitor=false',
    '-c',
    'filter.lfs.clean=',
    '-c',
    'filter.lfs.smudge=',
    '-c',
    'filter.lfs.process=',
    '-c',
    'filter.lfs.required=false',
  ];
}

function overrideValue(key: string): string {
  return /\.required$/i.test(key) ? 'false' : '';
}

function withNoTextconv(args: readonly string[]): string[] {
  const idx = args.indexOf('diff');
  if (idx === -1 || args.includes('--no-textconv')) return [...args];
  return [...args.slice(0, idx + 1), '--no-textconv', ...args.slice(idx + 1)];
}

async function discoveredDriverIsolationArgs(
  isolation: readonly string[],
  cwd: string,
  opts?: GitExecOpts,
): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await gitExec([...isolation, 'config', '--list'], cwd, opts));
  } catch (cause) {
    throw new SnapshotGitIsolationError(
      'snapshot git isolation could not read repository config; aborting automatic snapshot',
      { cause },
    );
  }
  const overrides = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const match = line.match(DRIVER_SETTING);
    if (!match) continue;
    overrides.set(match[1], overrideValue(match[1]));
  }
  const args: string[] = [];
  for (const [key, value] of overrides) {
    args.push('-c', `${key}=${value}`);
  }
  return args;
}

export async function isolatedGitExec(
  args: readonly string[],
  cwd?: string,
  opts?: GitExecOpts,
): Promise<GitExecResult> {
  const hooksPath = await getEmptyHooksDir();
  const isolation = snapshotGitIsolationArgs(hooksPath);
  const command = withNoTextconv(args);
  if (command[0] === 'config') {
    return gitExec([...isolation, ...command], cwd, opts);
  }
  if (!cwd) {
    throw new SnapshotGitIsolationError(
      'snapshot git isolation requires a repository path',
    );
  }
  const drivers = await discoveredDriverIsolationArgs(isolation, cwd, opts);
  return gitExec([...isolation, ...drivers, ...command], cwd, opts);
}
