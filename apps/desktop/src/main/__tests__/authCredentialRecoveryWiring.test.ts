import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(new URL('../bootstrap-electron.ts', import.meta.url), 'utf8');

describe('production credential recovery wiring', () => {
  it('connects observed failures to recovery without probing the credential backend', () => {
    const wiring = bootstrap.match(
      /const authCredentialRecovery = createAuthCredentialRecovery\(\{([\s\S]*?)\n\}\);/,
    )?.[1];
    expect(wiring).toBeDefined();
    expect(wiring).toContain("enabled: process.platform === 'darwin' && app.isPackaged");
    expect(wiring).toContain('authManager.needsCredentialProcessRecovery()');
    expect(wiring).not.toContain('safeStorage');
    expect(wiring).toContain('authManager.isAuthFlowBusy()');
    expect(wiring).toContain('hasUpdateRelaunchBusyActivity');
    expect(wiring).toContain('evaluateRelaunchBusyActivity(readRelaunchActivitySources())');
    expect(wiring).toContain('app.relaunch({ args })');
    expect(wiring).toContain('app.quit()');
  });

  it('requests recovery after auth initialization and resume, and removes screen listeners on quit', () => {
    expect(bootstrap).toMatch(
      /authCredentialRecovery.request\(\);\s*await authManager.ensureStableOwnerPostCommitTasks\('auth-initialize'\)/,
    );
    expect(bootstrap).toMatch(
      /powerMonitor.on\('resume', \(\) => \{\s*authCredentialRecovery.request\(\)/,
    );
    for (const [event, handler] of [
      ['lock-screen', 'onScreenLock'],
      ['unlock-screen', 'onScreenUnlock'],
    ]) {
      expect(bootstrap).toContain(`powerMonitor.on('${event}', authCredentialRecovery.${handler})`);
      expect(bootstrap).toContain(
        `powerMonitor.removeListener('${event}', authCredentialRecovery.${handler})`,
      );
    }
    expect(bootstrap).toMatch(
      /onQuit\(\s*'auth-credential-recovery',\s*\(\) => \{\s*authCredentialRecovery.dispose\(\)/,
    );
  });
});
