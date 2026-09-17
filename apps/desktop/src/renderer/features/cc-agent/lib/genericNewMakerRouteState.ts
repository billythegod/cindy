import { matchPath } from 'react-router-dom';
import { resolveAgentIslandVisibleSessionIdFromPath } from '@/lib/agentIslandVisibleSessionRoute';
import { sessionsStore } from '@/lib/sessionsStore';
import { getStickySessionDeviceId } from '@/features/device-link/stickySessionOrigin';
import { remoteProjectsStore } from '@/features/device-link/remoteProjectsStore';
import { makeDialogueNewMakerRouteState, type NewMakerRouteState } from './newMakerRouteState';

/** Capture the current task's computer at the new-task action, before leaving its route. */
export function makeGenericNewMakerRouteState(pathname: string): NewMakerRouteState {
  const sessionId =
    resolveAgentIslandVisibleSessionIdFromPath(pathname) ??
    matchPath('/cc-agent/orca/:sessionId', pathname)?.params.sessionId ??
    matchPath('/cc-agent/files/:sessionId', pathname)?.params.sessionId;
  if (!sessionId || sessionId === 'new') return { workspacePrompt: 'generic' };

  const deviceId = getStickySessionDeviceId(sessionId);
  // A missing remote origin can also mean bootstrap has not finished. Only a
  // cached local row confirms this computer; otherwise preserve the draft.
  if (!deviceId && !sessionsStore.findById(sessionId)) return { workspacePrompt: 'generic' };
  const state = makeDialogueNewMakerRouteState(
    deviceId
      ? {
          deviceId,
          deviceName:
            remoteProjectsStore.getDeviceList().find((device) => device.deviceId === deviceId)
              ?.deviceName ?? deviceId,
        }
      : null,
  );
  return {
    ...state,
    workspacePrompt: 'generic',
    dialogueTargetRequest: {
      ...state.dialogueTargetRequest,
      preserveWorkspaceIfSameDevice: true,
    },
  };
}
