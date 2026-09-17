import { execFileSync } from 'node:child_process';
import os from 'node:os';

/** Default name reported to the relay; user-assigned names are handled by the server. */
export function deviceName(): string {
  if (process.platform === 'darwin') {
    try {
      // Hello construction is synchronous. Bound this local OS query so a failed
      // lookup cannot hold up the connection indefinitely; never invoke a shell.
      const name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], {
        encoding: 'utf8',
        timeout: 500,
        maxBuffer: 16 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (name) return name;
    } catch {
      // Missing/unavailable ComputerName is expected to fall back to hostname.
    }
  }

  const name = os
    .hostname()
    .trim()
    .replace(/\.local\.?$/i, '')
    .trim();
  return name || 'Unknown Device';
}
