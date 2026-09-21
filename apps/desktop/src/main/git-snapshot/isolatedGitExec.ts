/**
 * Snapshot Git invocations must not honor repository-local executable config.
 *
 * Turn-start snapshots now run by default on existing Git directories. A
 * complete attacker-supplied `.git/config` can set `core.fsmonitor`,
 * `core.hooksPath`, or LFS `filter.*.clean/process` to relative executables.
 * Every snapshot `git` call therefore overrides those keys.
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
  ];
}

export async function isolatedGitExec(
  args: readonly string[],
  cwd?: string,
  opts?: GitExecOpts,
): Promise<GitExecResult> {
  const hooksPath = await getEmptyHooksDir();
  return gitExec([...snapshotGitIsolationArgs(hooksPath), ...args], cwd, opts);
}
