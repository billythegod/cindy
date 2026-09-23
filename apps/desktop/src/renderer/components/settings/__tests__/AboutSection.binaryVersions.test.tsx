// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { AgentVersionsRows } from '../AboutSection';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog-provider';

const getBinaryVersion = vi.fn();
const relaunchForHarnessUpdate = vi.fn();

describe('AboutSection agent binary versions', () => {
  const renderRows = () =>
    render(
      <ConfirmDialogProvider>
        <AgentVersionsRows />
      </ConfirmDialogProvider>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      maker: {
        agent: {
          getBinaryVersion,
        },
      },
    };
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('requests and renders Claude Code, Codex, and Pi versions', async () => {
    getBinaryVersion.mockImplementation((kind: string) =>
      Promise.resolve({
        kind,
        binaryPath: `/${kind}`,
        version:
          kind === 'claude-code'
            ? '2.1.258 (Claude Code)'
            : kind === 'codex'
              ? 'codex-cli 0.145.0'
              : 'pi 0.84.4',
      }),
    );

    renderRows();

    await waitFor(() => expect(getBinaryVersion).toHaveBeenCalledTimes(3));
    expect(getBinaryVersion).toHaveBeenCalledWith('claude-code');
    expect(getBinaryVersion).toHaveBeenCalledWith('codex');
    expect(getBinaryVersion).toHaveBeenCalledWith('pi');
    await waitFor(() => {
      expect(screen.getByText('settings.about.claudeCodeVersionLabel')).toBeTruthy();
      expect(screen.getByText('settings.about.codexVersionLabel')).toBeTruthy();
      expect(screen.getByText('settings.about.piVersionLabel')).toBeTruthy();
      expect(screen.getByText('0.84.4')).toBeTruthy();
    });
  });

  it('shows the existing not-ready state when Pi is unavailable', async () => {
    getBinaryVersion.mockImplementation((kind: string) =>
      Promise.resolve(
        kind === 'pi'
          ? { kind, binaryPath: null, version: null, error: 'binary_not_ready' }
          : { kind, binaryPath: `/${kind}`, version: '1.0.0' },
      ),
    );

    renderRows();

    await waitFor(() => expect(screen.getByText('settings.about.version.notReady')).toBeTruthy());
  });

  it('shows an update button only when the online version differs', async () => {
    getBinaryVersion.mockImplementation((kind: string) =>
      Promise.resolve({
        kind,
        binaryPath: `/${kind}`,
        version: '1.0.0',
        latestVersion: kind === 'codex' ? '1.1.0' : '1.0.0',
      }),
    );

    renderRows();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'settings.about.harnessUpdateButton' })).toBeTruthy();
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('requires confirmation before scheduling the harness relaunch', async () => {
    getBinaryVersion.mockImplementation((kind: string) =>
      Promise.resolve({
        kind,
        binaryPath: `/${kind}`,
        version: '1.0.0',
        latestVersion: kind === 'codex' ? '1.1.0' : '1.0.0',
      }),
    );
    relaunchForHarnessUpdate.mockResolvedValue({ accepted: true });
    (window as unknown as { electronAPI: { relaunchForHarnessUpdate: typeof relaunchForHarnessUpdate } })
      .electronAPI.relaunchForHarnessUpdate = relaunchForHarnessUpdate;

    renderRows();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'settings.about.harnessUpdateButton' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'settings.about.harnessUpdateButton' }));
    expect(relaunchForHarnessUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'settings.about.harnessUpdateConfirm' }));
    await waitFor(() => expect(relaunchForHarnessUpdate).toHaveBeenCalledOnce());
  });
});
