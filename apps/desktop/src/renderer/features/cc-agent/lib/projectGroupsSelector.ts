import type { Session } from '@/lib/ccAgent.types';
import {
  groupSessions,
  type GroupSessionsOptions,
  type ProjectGroupsResult,
} from './projectGrouping';

// Only known row-only changes can reuse a grouping. New/unknown fields take
// the canonical path, so adding a grouping input cannot silently stale it.
const ROW_ONLY_FIELDS = new Set([
  'title',
  'preview',
  'summary',
  'totalCostUsd',
  'totalMoney',
  'totalTokenUsage',
  'contextTokens',
  'contextWindow',
  'updatedAt',
  '_count',
]);

function sameGroupingInput(a: Session, b: Session): boolean {
  if ((a.userSendAt ?? a.updatedAt) !== (b.userSendAt ?? b.updatedAt)) return false;
  // Message count only affects whether a task is a draft. A new reply must not
  // regroup every project, but the first message still must move the task.
  if (((a._count?.messages ?? 0) === 0) !== ((b._count?.messages ?? 0) === 0)) return false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!ROW_ONLY_FIELDS.has(key) && a[key as keyof Session] !== b[key as keyof Session]) {
      return false;
    }
  }
  return true;
}

function sameOptions(a: GroupSessionsOptions, b: GroupSessionsOptions): boolean {
  const ap = a.persistentLocalProjects;
  const bp = b.persistentLocalProjects;
  return (
    a.projectAliases === b.projectAliases &&
    a.includePinnedInProjects === b.includePinnedInProjects &&
    a.includeDraftsInProjects === b.includeDraftsInProjects &&
    a.localPlatform === b.localPlatform &&
    a.botOwnerBySessionId === b.botOwnerBySessionId &&
    (ap === bp ||
      (!!ap &&
        !!bp &&
        ap.length === bp.length &&
        ap.every((p, i) => {
          const next = bp[i];
          return (
            p.workingDir === next.workingDir &&
            p.lastUsedAt === next.lastUsedAt &&
            p.knownAgentKinds.length === next.knownAgentKinds.length &&
            p.knownAgentKinds.every((kind, j) => kind === next.knownAgentKinds[j])
          );
        })))
  );
}

/** One previous projection per consumer; immutable inputs, no retained history.
 * Keep unchanged groups/rows referentially stable while publishing fresh row
 * values. Membership, order, identity or option changes use groupSessions.
 */
export function createProjectGroupsSelector() {
  let previous:
    | {
        sessions: readonly Session[];
        options: GroupSessionsOptions;
        result: ProjectGroupsResult;
      }
    | undefined;
  return (
    sessions: readonly Session[],
    options: GroupSessionsOptions = {},
  ): ProjectGroupsResult => {
    let result: ProjectGroupsResult | undefined;
    if (
      previous &&
      sameOptions(previous.options, options) &&
      previous.sessions.length === sessions.length
    ) {
      const replacements = new Map<Session, Session>();
      const reusable = sessions.every((session, i) => {
        const old = previous!.sessions[i];
        if (old === session) return true;
        if (!sameGroupingInput(old, session)) return false;
        replacements.set(old, session);
        return true;
      });
      if (reusable) {
        const replaceRows = (rows: Session[]): Session[] =>
          rows.some((row) => replacements.has(row))
            ? rows.map((row) => replacements.get(row) ?? row)
            : rows;
        const replaceGroups = <T extends { sessions: Session[] }>(groups: T[]): T[] => {
          let changed = false;
          const next = groups.map((group) => {
            const rows = replaceRows(group.sessions);
            if (rows === group.sessions) return group;
            changed = true;
            return { ...group, sessions: rows };
          });
          return changed ? next : groups;
        };
        result =
          replacements.size === 0
            ? previous.result
            : {
                pinned: replaceRows(previous.result.pinned),
                dialogues: replaceRows(previous.result.dialogues),
                unclassified: replaceRows(previous.result.unclassified),
                bots: replaceGroups(previous.result.bots),
                projects: replaceGroups(previous.result.projects),
              };
      }
    }
    result ??= groupSessions(sessions, options);
    previous = { sessions, options, result };
    return result;
  };
}
