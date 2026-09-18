import fs from 'node:fs/promises';
import path from 'node:path';
import { ownerScopedUserDataPath } from '../appSessionState.js';
import { dialogueWorkspaceDayKey } from '../localDb/dialogueWorkspace.js';
import { dialogueWorkspaceRoots } from '../dialogue-workspace-settings.js';
import { worktreeConversationFallbackDir } from './workingDirectoryRecovery.js';

/** Saved custom roots remain required after restart and after changing the setting. */
export function requiredDialogueRecoveryRoot(workingDir: string): string | undefined {
  const defaultRoot = ownerScopedUserDataPath('dialogues');
  return dialogueWorkspaceRoots()
    .filter((root) => {
      if (path.relative(defaultRoot, root) === '') return false;
      const relative = path.relative(root, workingDir);
      return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    })
    .sort((a, b) => b.length - a.length)[0];
}

/** Emergency storage must not depend on the custom volume that may have failed. */
export async function allocateDialogueRecoveryWorkspace(
  sessionId: string,
  workingDir: string,
  mode: 'ordinary' | 'unrestored-worktree',
): Promise<string> {
  const root = ownerScopedUserDataPath('dialogues');
  const directory = mode === 'unrestored-worktree'
    ? worktreeConversationFallbackDir(root, sessionId, workingDir)
    : path.join(root, dialogueWorkspaceDayKey(Date.now()), sessionId);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}
