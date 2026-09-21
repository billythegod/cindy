/**
 * Snapshot Git invocations must not honor repository-local executable config.
 *
 * Turn-start snapshots now run by default on existing Git directories. A
 * complete attacker-supplied `.git/config` can set `core.fsmonitor`,
 * `core.hooksPath`, or arbitrary `filter.*.clean/process` drivers. Every
 * snapshot `git` call therefore overrides hooks, fsmonitor, LFS, and any
 * discovered filter drivers — including `filter.*.required=false` so
 * emptying LFS commands does not fail `git add`.
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

const FILTER_SETTING =
  /^filter\.([^=]+)\.(clean|smudge|process|required)=/i;

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

async function discoveredFilterIsolationArgs(
  isolation: readonly string[],
  cwd?: string,
  opts?: GitExecOpts,
): Promise<string[]> {
  if (!cwd) return [];
  try {
    const { stdout } = await gitExec(
      [...isolation, 'config', '--list'],
      cwd,
      opts,
    );
    const overrides = new Map<string, string>();
    for (const line of stdout.split('\n')) {
      const match = line.match(FILTER_SETTING);
      if (!match) continue;
      const name = match[1];
      const field = match[2].toLowerCase();
      const key = `filter.${name}.${field}`;
      overrides.set(key, field === 'required' ? 'false' : '');
    }
    const args: string[] = [];
    for (const [key, value] of overrides) {
      args.push('-c', `${key}=${value}`);
    }
    return args;
  } catch {
    return [];
  }
}

export async function isolatedGitExec(
  args: readonly string[],
  cwd?: string,
  opts?: GitExecOpts,
): Promise<GitExecResult> {
  const hooksPath = await getEmptyHooksDir();
  const isolation = snapshotGitIsolationArgs(hooksPath);
  if (args[0] === 'config') {
    return gitExec([...isolation, ...args], cwd, opts);
  }
  const filters = await discoveredFilterIsolationArgs(isolation, cwd, opts);
  return gitExec([...isolation, ...filters, ...args], cwd, opts);
}
