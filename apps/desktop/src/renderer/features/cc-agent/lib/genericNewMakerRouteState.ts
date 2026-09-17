import { matchPath } from 'react-router-dom';
import { resolveAgentIslandVisibleSessionIdFromPath } from '@/lib/agentIslandVisibleSessionRoute';
import { sessionsStore } from '@/lib/sessionsStore';
import { canonicalBotSessionId, getBotProfiles } from '@/features/bots/botStore';
import { getStickySessionDeviceId } from '@/features/device-link/stickySessionOrigin';
import { remoteProjectsStore } from '@/features/device-link/remoteProjectsStore';
import { makeDialogueNewMakerRouteState, type NewMakerRouteState } from './newMakerRouteState';

/** Capture the current task's computer at the new-task action, before leaving its route. */
export function makeGenericNewMakerRouteState(pathname: string): NewMakerRouteState {
  const remoteBot = matchPath('/bots/remote/:deviceId/:botId', pathname);
  const botId = matchPath('/bots/:botId', pathname)?.params.botId;
  const bot =
    botId && botId !== 'roster' && botId !== 'remote'
      ? getBotProfiles().find((profile) => profile.id === botId)
      : undefined;
  const localBotSessionId = bot ? canonicalBotSessionId(bot) : undefined;
  const sessionId =
    resolveAgentIslandVisibleSessionIdFromPath(pathname) ??
    matchPath('/cc-agent/orca/:sessionId', pathname)?.params.sessionId ??
    matchPath('/cc-agent/files/:sessionId', pathname)?.params.sessionId ??
    matchPath('/bots/:botId/session/:sessionId', pathname)?.params.sessionId ??
    matchPath('/bots/:botId/history/:sessionId', pathname)?.params.sessionId ??
    localBotSessionId;
  if (!remoteBot && (!sessionId || sessionId === 'new')) return { workspacePrompt: 'generic' };

  const deviceId =
    remoteBot?.params.deviceId ?? (sessionId ? getStickySessionDeviceId(sessionId) : undefined);
  // A missing remote origin can also mean bootstrap has not finished. Only a
  // cached local row confirms this computer; otherwise preserve the draft.
  if (!deviceId && !localBotSessionId && (!sessionId || !sessionsStore.findById(sessionId))) {
    return { workspacePrompt: 'generic' };
  }
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
