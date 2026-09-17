import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const AUR_CINDY_PACKAGE_NAMES = new Set(['cindy-bin', 'cindy-cn-bin']);

export type PacmanOwnerQuery = (exePath: string) => string;

function queryPacmanOwner(exePath: string): string {
  return execFileSync('/usr/bin/pacman', ['-Qqo', '--', fs.realpathSync(exePath)], {
    encoding: 'utf8',
    timeout: 2_000,
    maxBuffer: 4_096,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function isLinuxAurInstallation(
  exePath: string,
  platform: NodeJS.Platform = process.platform,
  query: PacmanOwnerQuery = queryPacmanOwner,
): boolean {
  if (platform !== 'linux') return false;
  try {
    return AUR_CINDY_PACKAGE_NAMES.has(query(exePath).trim());
  } catch {
    return false;
  }
}
