import fs from 'node:fs/promises';
import path from 'node:path';
import { ownerScopedUserDataPath } from '../appSessionState.js';
import { dialogueWorkspaceDayKey } from '../localDb/dialogueWorkspace.js';
import { worktreeConversationFallbackDir } from './workingDirectoryRecovery.js';

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
