import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let userDataDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected app path: ${name}`);
      return userDataDir;
    },
  },
}));

vi.mock('../appSessionState.js', () => ({
  ownerScopedUserDataPath: (...parts: string[]) => path.join(userDataDir, ...parts),
  activeOwnerScopeKey: () => userDataDir,
}));

vi.mock('../logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));

describe('dialogue workspace directory', () => {
  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdt-dialogues-'));
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('uses local calendar buckets under app userData/dialogues', async () => {
    const {
      buildDialogueWorkspaceDir,
      dialogueWorkspaceDayKey,
      dialogueWorkspaceRootDir,
    } = await import('../localDb/dialogueWorkspace');
    const now = new Date(2026, 4, 20, 12, 0, 0).getTime();

    expect(dialogueWorkspaceDayKey(now)).toBe('2026-05-20');
    expect(dialogueWorkspaceRootDir()).toBe(path.join(userDataDir, 'dialogues'));
    expect(buildDialogueWorkspaceDir('session-1', now)).toBe(
      path.join(userDataDir, 'dialogues', '2026-05-20', 'session-1'),
    );
  });

  it('creates the managed dialogue directory when requested', async () => {
    const { ensureDialogueWorkspaceDir } = await import('../localDb/dialogueWorkspace');
    const now = new Date(2026, 4, 20, 12, 0, 0).getTime();

    const dir = ensureDialogueWorkspaceDir('session-2', now);

    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(dir).toBe(path.join(userDataDir, 'dialogues', '2026-05-20', 'session-2'));
  });

  it('switches only new allocations, retains every old root on reset and across reloads', async () => {
    const { ensureDialogueWorkspaceDir, isManagedDialogueWorkspace } = await import('../localDb/dialogueWorkspace');
    const { writeDialogueWorkspaceDirectory, readDialogueWorkspaceSettings } = await import('../dialogue-workspace-settings');
    const now = new Date(2026, 8, 18, 12).getTime();
    const oldDir = ensureDialogueWorkspaceDir('old', now);
    fs.writeFileSync(path.join(oldDir, 'work.txt'), 'keep me');
    const custom = path.join(userDataDir, 'external', 'dialogues');
    await writeDialogueWorkspaceDirectory(custom);
    const customDir = ensureDialogueWorkspaceDir('new', now);
    expect(customDir).toBe(path.join(custom, '2026-09-18', 'new'));
    await writeDialogueWorkspaceDirectory(path.join(userDataDir, 'another'));
    await writeDialogueWorkspaceDirectory(null);
    expect(readDialogueWorkspaceSettings()).toEqual({
      directory: path.join(userDataDir, 'dialogues'), isCustomized: false,
    });
    expect(fs.readFileSync(path.join(oldDir, 'work.txt'), 'utf8')).toBe('keep me');
    expect(fs.existsSync(customDir)).toBe(true);
    expect(isManagedDialogueWorkspace(oldDir)).toBe(true);
    expect(isManagedDialogueWorkspace(customDir)).toBe(true);
    expect(isManagedDialogueWorkspace(path.join(custom + '-project', '2026-09-18', 'new'))).toBe(false);
    const saved = JSON.parse(fs.readFileSync(path.join(userDataDir, 'dialogue-workspace-settings.json'), 'utf8'));
    expect(saved).not.toHaveProperty('directory');
    vi.resetModules();
    const reloaded = await import('../localDb/dialogueWorkspace');
    expect(reloaded.isManagedDialogueWorkspace(customDir)).toBe(true);
    expect(reloaded.dialogueWorkspaceRootDir()).toBe(path.join(userDataDir, 'dialogues'));
  });

  it('keeps settings and recognized roots isolated when the owner changes', async () => {
    const { writeDialogueWorkspaceDirectory } = await import('../dialogue-workspace-settings');
    const { dialogueWorkspaceRootDir, dialogueWorkspaceRoots } = await import('../localDb/dialogueWorkspace');
    const firstOwner = userDataDir;
    const custom = path.join(firstOwner, 'custom');
    await writeDialogueWorkspaceDirectory(custom);
    try {
      userDataDir = path.join(firstOwner, 'second-owner');
      expect(dialogueWorkspaceRootDir()).toBe(path.join(userDataDir, 'dialogues'));
      expect(dialogueWorkspaceRoots()).not.toContain(custom);
    } finally {
      userDataDir = firstOwner;
    }
    expect(dialogueWorkspaceRootDir()).toBe(custom);
  });

  it('rejects invalid paths and preserves unreadable settings on writes', async () => {
    const { writeDialogueWorkspaceDirectory } = await import('../dialogue-workspace-settings');
    await expect(writeDialogueWorkspaceDirectory('relative')).rejects.toThrow();
    await expect(writeDialogueWorkspaceDirectory(path.join(userDataDir, 'bad') + '\0')).rejects.toThrow();
    const file = path.join(userDataDir, 'dialogue-workspace-settings.json');
    fs.writeFileSync(file, '{broken');
    await expect(writeDialogueWorkspaceDirectory(path.join(userDataDir, 'custom'))).rejects.toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });
});
