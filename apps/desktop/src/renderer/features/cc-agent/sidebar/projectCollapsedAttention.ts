import type { AttentionKind } from '@/lib/sessionAttentionStore';
import {
  hasPendingSessionInterruption,
  type SessionInterruptionState,
} from '@cindy/maker-shared/session-activity';
import type { RemoteSessionActivityPhase } from '@/features/device-link/remoteSessionActivityStore';

export type CollapsedAttentionTone = 'error' | 'done';
/** @deprecated 保留旧名给既有调用点;新代码用 CollapsedAttentionTone。 */
export type CollapsedProjectAttentionTone = CollapsedAttentionTone;

interface CollapsedAttentionInput {
  sessions: readonly ({
    id: string;
    deviceLinkDeviceId?: string | null;
  } & SessionInterruptionState)[];
  runningSessionIds: ReadonlySet<string>;
  notifications: ReadonlySet<string>;
  attentionKinds: ReadonlyMap<string, AttentionKind>;
  urgentSessionIds: ReadonlySet<string>;
  remotePhaseOf: (
    sessionId: string,
    deviceId?: string | null,
  ) => RemoteSessionActivityPhase | undefined;
}

export interface CollapsedAttentionSummary {
  /** 折叠容器右侧状态槽要显示的档位;两者都没有则 null(回落时间文字)。 */
  tone: CollapsedAttentionTone | null;
  /**
   * 未处理错误的子任务 id。保留收起态下错误条目的可达性，
   * 但不再据此显示红点或遮住其它子任务的成功未读提示。
   */
  errorSessionIds: readonly string[];
}

/**
 * 折叠容器汇总成功未读绿点，并保留错误子任务的可达性。
 * 错误不显示红点；等待回复与运行态不在此处升格。
 *
 * 这是折叠态「什么算告警」的**唯一**判据:项目折叠头取 tone,定时任务分组头同时取
 * tone 与 errorSessionIds(见该字段注释)。要改语义就只改这里,别在消费侧另写一份。
 */
export function resolveCollapsedAttention({
  sessions,
  runningSessionIds,
  notifications,
  attentionKinds,
  urgentSessionIds,
  remotePhaseOf,
}: CollapsedAttentionInput): CollapsedAttentionSummary {
  let hasDone = false;
  const errorSessionIds: string[] = [];

  for (const session of sessions) {
    if (hasPendingSessionInterruption(session)) {
      errorSessionIds.push(session.id);
      continue;
    }
    if (urgentSessionIds.has(session.id)) {
      errorSessionIds.push(session.id);
      continue;
    }
    const remotePhase = remotePhaseOf(session.id, session.deviceLinkDeviceId);
    if (remotePhase) {
      if (remotePhase === 'error') errorSessionIds.push(session.id);
      else if (remotePhase === 'completed') hasDone = true;
      // 远程活动镜像是远程行右侧状态的权威来源；running / needs-interaction
      // 分别显示 spinner / 蓝点，不能再被本地残留状态误汇总成红绿点。
      continue;
    }

    if (urgentSessionIds.has(session.id)) {
      errorSessionIds.push(session.id);
      continue;
    }
    if (!notifications.has(session.id)) continue;

    const attentionKind = attentionKinds.get(session.id);
    if (attentionKind === 'error') {
      errorSessionIds.push(session.id);
      continue;
    }
    if (attentionKind === 'awaiting' || runningSessionIds.has(session.id)) continue;
    hasDone = true;
  }

  return {
    // Keep failed children discoverable, but no longer advertise failures with a dot.
    tone: hasDone ? 'done' : null,
    errorSessionIds,
  };
}

/** 只要 tone 的调用点(项目折叠头)。语义见 resolveCollapsedAttention。 */
export function resolveCollapsedProjectAttentionTone(
  input: CollapsedAttentionInput,
): CollapsedAttentionTone | null {
  return resolveCollapsedAttention(input).tone;
}

/**
 * 定时任务分组头右侧状态槽的最终档位。
 *
 * 组头平时是「最新一条运行的代理」(状态 / loading / 点击目标都跟最新那条一致,
 * 2026-08 既有裁决),展开态照此不变;收起态它代表的却是**整组**,于是按整组汇总补两档:
 *   - 汇总出 error → 强制红。压过 latest 的 running spinner,与全端色表
 *     error > awaiting > running > done 一致 ——「等你处理」永远最高。
 *   - 汇总出 done → 只在组头自身无状态可显(time)时补绿。绿点若压掉 spinner 会造成
 *     「仍在跑却看起来已完成」的错觉(sidebarRightStatus 里有同款告警)。
 * awaiting(蓝)刻意不升格,与项目折叠头口径一致。
 */
export { resolveCollapsedGroupRightStatus } from '@cindy/maker-shared/session-activity';

/**
 * 组头点击打开哪一条。展开态仍打开最新一条；收起态保留错误条目的打开入口。
 */
export function resolveCollapsedGroupHeaderSessionId({
  collapsed,
  latestSessionId,
  attention,
}: {
  collapsed: boolean;
  latestSessionId: string | undefined;
  attention: Pick<CollapsedAttentionSummary, 'tone' | 'errorSessionIds'>;
}): string | undefined {
  if (collapsed && attention.errorSessionIds[0]) {
    return attention.errorSessionIds[0];
  }
  return latestSessionId;
}
