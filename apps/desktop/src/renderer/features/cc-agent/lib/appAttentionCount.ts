import type { Session } from '@/lib/ccAgent.types';
import { isOrcaWorkerSession } from '@/lib/orcaSessionIdentity';
import type { AttentionKind } from '@/lib/sessionAttentionStore';
import {
  projectSidebarSessionActivity,
  resolveSidebarRightStatus,
  type SidebarRightStatusInput,
} from '../sidebar/sidebarRightStatus';

export interface AppAttentionCountInput {
  sessions: readonly Session[];
  attentionKinds: ReadonlyMap<string, AttentionKind>;
  runningSessionIds: ReadonlySet<string>;
  localActivities: ReadonlyMap<string, SidebarRightStatusInput['liveActivity']>;
}

/** 与任务行的红/蓝/绿点同源，不随搜索、折叠或当前机器筛选改变。 */
export function countAppAttention(input: AppAttentionCountInput): number {
  const attentionIds = new Set<string>();
  for (const session of input.sessions) {
    if (
      session.status !== 'active' ||
      isOrcaWorkerSession(session) ||
      session.deviceLinkDeviceId !== undefined ||
      session.source === 'scheduler' ||
      session.source === 'learn'
    )
      continue;
    const activity = projectSidebarSessionActivity({
      interruption: session,
      sessionId: session.id,
      title: session.title,
      recordStatus: session.status,
      liveActivity: input.localActivities.get(session.id),
      attentionKind: input.attentionKinds.get(session.id),
      isUrgentFromContext: false,
      isRunning: input.runningSessionIds.has(session.id),
      hasAttentionNotification: input.attentionKinds.has(session.id),
    });
    const status = resolveSidebarRightStatus(activity);
    if (status === 'done' || status === 'awaiting' || status === 'error') {
      attentionIds.add(session.id);
    }
  }
  return attentionIds.size;
}
