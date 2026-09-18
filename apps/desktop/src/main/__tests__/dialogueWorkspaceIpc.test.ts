import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createDialogueWorkspaceHandlers, customDialogueWorkspaceRoot, checkDialogueDirectoryWritable } from '../dialogue-workspace-ipc';

function setup() {
  let scope = 'owner-a:1';
  let directory = path.resolve('default');
  const deps = {
    captureScope: () => scope,
    isScopeCurrent: (captured: string) => scope === captured,
    read: () => ({ directory, isCustomized: directory !== path.resolve('default') }),
    write: vi.fn(async (next: string | null) => { directory = next ?? path.resolve('default'); }),
    chooseDirectory: vi.fn(async (): Promise<string | null> => path.resolve('selected')),
    resolveDirectory: (selected: string) => path.join(selected, 'dialogues', 'owner-a'),
    checkWritable: vi.fn(async () => {}),
  };
  return { deps, handlers: createDialogueWorkspaceHandlers(deps), changeOwner: () => { scope = 'owner-b:2'; } };
}

describe('dialogue directory settings IPC', () => {
  it('builds owner-isolated locations using the target platform path API', () => {
    expect(customDialogueWorkspaceRoot('D:\\My Files', 'owner-a', path.win32))
      .toBe(path.win32.join('D:\\My Files', 'dialogues', 'owner-a'));
    expect(customDialogueWorkspaceRoot('\\\\server\\share', 'owner-a', path.win32))
      .toBe(path.win32.join('\\\\server\\share', 'dialogues', 'owner-a'));
    for (const selected of ['/Volumes/Work Drive', '/home/me/资料', '/mnt/back\\slash']) {
      expect(customDialogueWorkspaceRoot(selected, 'owner-a', path.posix))
        .toBe(path.posix.join(selected, 'dialogues', 'owner-a'));
    }
  });

  it('probes a real directory without leaving files and rejects a file as a directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cindy-dialogue-probe-'));
    try {
      const selected = path.join(root, 'workspace');
      await checkDialogueDirectoryWritable(selected);
      expect(await fs.readdir(selected)).toEqual([]);
      const file = path.join(root, 'existing.txt');
      await fs.writeFile(file, 'keep');
      await expect(checkDialogueDirectoryWritable(file)).rejects.toThrow();
      expect(await fs.readFile(file, 'utf8')).toBe('keep');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('checks the dedicated directory before committing and supports reset', async () => {
    const { deps, handlers } = setup();
    const directory = path.resolve('selected', 'dialogues', 'owner-a');
    expect(await handlers.choose()).toEqual({ directory, isCustomized: true });
    expect(deps.checkWritable).toHaveBeenCalledWith(directory);
    expect(deps.checkWritable.mock.invocationCallOrder[0]).toBeLessThan(deps.write.mock.invocationCallOrder[0]);
    expect(await handlers.reset()).toEqual({ directory: path.resolve('default'), isCustomized: false });
    expect(deps.write).toHaveBeenLastCalledWith(null);
  });

  it('cancellation leaves the previous setting untouched', async () => {
    const { deps, handlers } = setup();
    deps.chooseDirectory.mockResolvedValue(null);
    await handlers.choose();
    expect(deps.checkWritable).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('an unwritable directory never becomes the saved setting', async () => {
    const { deps, handlers } = setup();
    deps.checkWritable.mockRejectedValue(new Error('denied'));
    await expect(handlers.choose()).rejects.toThrow('denied');
    expect(deps.write).not.toHaveBeenCalled();
  });

  it.each(['picker', 'probe'] as const)('rejects owner changes during the %s', async (stage) => {
    const { deps, handlers, changeOwner } = setup();
    if (stage === 'picker') {
      deps.chooseDirectory.mockImplementation(async () => { changeOwner(); return path.resolve('selected'); });
    } else {
      deps.checkWritable.mockImplementation(async () => { changeOwner(); });
    }
    await expect(handlers.choose()).rejects.toThrow('PRECONDITION_FAILED');
    expect(deps.write).not.toHaveBeenCalled();
    if (stage === 'picker') expect(deps.checkWritable).not.toHaveBeenCalled();
  });

  it('does not let reset overtake an open folder picker', async () => {
    const { deps, handlers } = setup();
    let finish!: (value: string | null) => void;
    deps.chooseDirectory.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = handlers.choose();
    await expect(handlers.reset()).rejects.toThrow('PRECONDITION_FAILED');
    finish(null);
    await pending;
    await handlers.reset();
    expect(deps.write).toHaveBeenCalledOnce();
  });
});
