import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

const AUR_CINDY_PACKAGE_NAMES = new Set(['cindy-bin', 'cindy-cn-bin']);

export type PacmanOwnerQuery = (exePath: string) => Promise<string>;

async function queryPacmanOwner(exePath: string): Promise<string> {
  const realExePath = await fs.realpath(exePath);
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/pacman',
      ['-Qqo', '--', realExePath],
      {
        encoding: 'utf8',
        timeout: 2_000,
        maxBuffer: 4_096,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function isLinuxAurInstallation(
  exePath: string,
  platform: NodeJS.Platform = process.platform,
  query: PacmanOwnerQuery = queryPacmanOwner,
): Promise<boolean> {
  if (platform !== 'linux') return false;
  try {
    return AUR_CINDY_PACKAGE_NAMES.has((await query(exePath)).trim());
  } catch {
    return false;
  }
}
