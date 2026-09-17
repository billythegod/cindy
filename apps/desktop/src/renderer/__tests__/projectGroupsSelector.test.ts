import { describe, expect, it } from 'vitest';
import type { Session } from '@/lib/ccAgent.types';
import { groupSessions, type GroupSessionsOptions } from '@/features/cc-agent/lib/projectGrouping';
import { createProjectGroupsSelector } from '@/features/cc-agent/lib/projectGroupsSelector';

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    workingDir: `/workspace/${id}`,
    workspaceKind: 'project',
    status: 'active',
    pinnedAt: null,
    userSendAt: '2026-08-01T00:00:00Z',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    _count: { messages: 1 },
    ...patch,
  } as Session;
}

describe('project grouping projection', () => {
  it('publishes row patches in every bucket without invalidating unrelated projects', () => {
    const rows = [session('a', { pinnedAt: '2026-08-01T00:00:00Z' }), session('b')];
    const options = { includePinnedInProjects: true };
    const select = createProjectGroupsSelector();
    const before = select(rows, options);
    const changed = {
      ...rows[0],
      title: 'new title',
      totalCostUsd: 12,
      updatedAt: '2026-08-02T00:00:00Z',
      _count: { messages: 20 },
    };
    const after = select([changed, rows[1]], options);
    expect(after).toEqual(groupSessions([changed, rows[1]], options));
    expect(after.pinned[0]).toBe(changed);
    expect(after.projects.find((p) => p.workingDir.endsWith('/a'))?.sessions[0]).toBe(changed);
    expect(after.projects.find((p) => p.workingDir.endsWith('/b'))).toBe(
      before.projects.find((p) => p.workingDir.endsWith('/b')),
    );
    expect(after.dialogues).toBe(before.dialogues);
    expect(select([changed, rows[1]], options)).toBe(after);
  });

  it.each([
    { workingDir: '/other/repo' },
    { pinnedAt: '2026-09-01T00:00:00Z' },
    { status: 'archived' },
    { workspaceKind: 'dialogue' },
    { userSendAt: '2026-09-01T00:00:00Z' },
    { createdAt: '2020-01-01T00:00:00Z' },
    { remoteHostId: 'ssh-host' },
    { deviceLinkDeviceId: 'device', deviceLinkDeviceName: 'Mac' },
    { deviceLinkConnectionStatus: 'disconnected' },
    { source: 'scheduler' },
    { orcaRole: 'lead' },
    { agentKind: 'pi' },
  ] as Partial<Session>[])(
    'matches canonical regrouping when structural fields change: %j',
    (patch) => {
      const rows = [session('a'), session('b', { workingDir: '/other/a' })];
      const select = createProjectGroupsSelector();
      select(rows);
      const changed = [{ ...rows[0], ...patch }, rows[1]];
      expect(select(changed)).toEqual(groupSessions(changed));
    },
  );

  it('invalidates first-message classification and the fallback draft clock', () => {
    const draft = session('draft', { userSendAt: null, _count: { messages: 0 } });
    const select = createProjectGroupsSelector();
    expect(select([draft]).unclassified).toHaveLength(1);
    const firstReply = { ...draft, _count: { messages: 1 } };
    expect(select([firstReply])).toEqual(groupSessions([firstReply]));
    expect(select([firstReply]).projects).toHaveLength(1);
    const later = { ...firstReply, updatedAt: '2026-09-01T00:00:00Z' };
    expect(select([later]).projects[0].latestActivityAt).toBe(later.updatedAt);
  });

  it('preserves stable-sort input order and resets on removal or empty data', () => {
    const rows = [session('a', { workingDir: '/same' }), session('b', { workingDir: '/same' })];
    const select = createProjectGroupsSelector();
    select(rows);
    for (const next of [[rows[1], rows[0]], [rows[1]], [], rows]) {
      expect(select(next)).toEqual(groupSessions(next));
    }
  });

  it('invalidates aliases, platform, pinned/draft policy, persistent projects and bot ownership', () => {
    const rows = [session('a')];
    const select = createProjectGroupsSelector();
    const policies: GroupSessionsOptions[] = [
      {},
      { projectAliases: new Map([['local:/workspace/a', 'Alias']]) },
      { localPlatform: 'win32' },
      { includePinnedInProjects: true },
      { includeDraftsInProjects: true },
      {
        persistentLocalProjects: [
          { workingDir: '/empty', lastUsedAt: '2026-09-01T00:00:00Z', knownAgentKinds: ['pi'] },
        ],
      },
      {
        botOwnerBySessionId: new Map([
          ['a', { botId: 'bot', displayName: 'Bot', avatar: 'star', avatarColor: 'blue' }],
        ]),
      },
    ];
    for (const options of policies)
      expect(select(rows, options)).toEqual(groupSessions(rows, options));
    const options = policies.at(-1)!;
    const updated = [{ ...rows[0], title: 'bot row update' }];
    expect(select(updated, options)).toEqual(groupSessions(updated, options));
    expect(select(updated, options).bots[0].sessions[0]).toBe(updated[0]);
  });

  it('reuses equal persistent catalogues but refreshes changed project metadata', () => {
    const rows = [session('a')];
    const projects = [
      { workingDir: '/empty', lastUsedAt: '2026-09-01T00:00:00Z', knownAgentKinds: ['pi'] },
    ];
    const select = createProjectGroupsSelector();
    const first = select(rows, { persistentLocalProjects: projects });
    expect(
      select(rows, {
        persistentLocalProjects: projects.map((p) => ({
          ...p,
          knownAgentKinds: [...p.knownAgentKinds],
        })),
      }),
    ).toBe(first);
    const changed = { persistentLocalProjects: [{ ...projects[0], knownAgentKinds: ['cc'] }] };
    expect(select(rows, changed)).toEqual(groupSessions(rows, changed));
  });
});
