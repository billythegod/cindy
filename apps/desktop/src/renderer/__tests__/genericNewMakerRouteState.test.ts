import { beforeEach, describe, expect, it, vi } from 'vitest';

const origins = new Map<string, string>();
const localSessionIds = new Set<string>();
const botSessions = new Map<string, string>();
vi.mock('@/features/bots/botStore', () => ({
  getBotProfiles: () => [...botSessions.keys()].map((id) => ({ id })),
  canonicalBotSessionId: (bot: { id: string }) => botSessions.get(bot.id),
}));
vi.mock('@/lib/sessionsStore', () => ({
  sessionsStore: {
    findById: (id: string) => (localSessionIds.has(id) ? { id } : null),
  },
}));
vi.mock('@/features/device-link/remoteProjectsStore', () => ({
  getSessionDeviceId: (id: string) => origins.get(id),
  remoteProjectsStore: {
    getDeviceList: () => [
      { deviceId: 'computer-a', deviceName: 'Computer A', connected: false },
      { deviceId: 'computer-b', deviceName: 'Computer B', connected: true },
    ],
  },
}));

import { __resetStickySessionOriginForTest } from '@/features/device-link/stickySessionOrigin';
import { makeGenericNewMakerRouteState } from '@/features/cc-agent/lib/genericNewMakerRouteState';
import {
  consumeNewMakerDialogueTargetRequest,
  readNewMakerDialogueTargetRequest,
} from '@/features/cc-agent/lib/newMakerRouteState';

beforeEach(() => {
  origins.clear();
  localSessionIds.clear();
  botSessions.clear();
  __resetStickySessionOriginForTest();
});

describe('new task inherits the current task computer', () => {
  it.each([
    '/cc-agent/task-a',
    '/cc-agent/orca/task-a',
    '/cc-agent/files/task-a',
    '/bots/bot-a/session/task-a',
    '/bots/bot-a/history/task-a',
    '/bots/remote/computer-a/bot-a',
  ])('inherits the task computer from %s, including an offline computer', (path) => {
    origins.set('task-a', 'computer-a');
    const state = makeGenericNewMakerRouteState(path);
    expect(state.workspacePrompt).toBe('generic');
    expect(readNewMakerDialogueTargetRequest(state)).toMatchObject({
      deviceId: 'computer-a',
      deviceName: 'Computer A',
      preserveWorkspaceIfSameDevice: true,
    });
  });

  it('follows the newly viewed task instead of the previous draft computer', () => {
    origins.set('task-a', 'computer-a');
    origins.set('task-b', 'computer-b');
    makeGenericNewMakerRouteState('/cc-agent/task-a');
    expect(
      readNewMakerDialogueTargetRequest(makeGenericNewMakerRouteState('/cc-agent/task-b')),
    ).toMatchObject({ deviceId: 'computer-b', deviceName: 'Computer B' });
  });

  it('returns to this computer from a local task', () => {
    localSessionIds.add('local-task');
    expect(
      readNewMakerDialogueTargetRequest(makeGenericNewMakerRouteState('/cc-agent/local-task')),
    ).toMatchObject({ deviceId: null, deviceName: null, preserveWorkspaceIfSameDevice: true });
  });

  it('inherits explicit remote bot ownership before the session list loads', () => {
    expect(
      readNewMakerDialogueTargetRequest(
        makeGenericNewMakerRouteState('/bots/remote/computer-a/bot-a'),
      ),
    ).toMatchObject({ deviceId: 'computer-a' });
  });

  it('follows remote bot, local canonical bot, then local history navigation', () => {
    botSessions.set('bot-local', 'local-task');
    expect(
      readNewMakerDialogueTargetRequest(
        makeGenericNewMakerRouteState('/bots/remote/computer-a/bot-a'),
      ),
    ).toMatchObject({ deviceId: 'computer-a' });
    expect(
      readNewMakerDialogueTargetRequest(makeGenericNewMakerRouteState('/bots/bot-local')),
    ).toMatchObject({ deviceId: null });
    localSessionIds.add('local-task');
    for (const path of [
      '/bots/bot-local/session/local-task',
      '/bots/bot-local/history/local-task',
    ]) {
      expect(readNewMakerDialogueTargetRequest(makeGenericNewMakerRouteState(path))).toMatchObject({
        deviceId: null,
      });
    }
  });

  it('keeps remote ownership during a reconnect instead of falling back locally', () => {
    origins.set('task-a', 'computer-a');
    makeGenericNewMakerRouteState('/cc-agent/task-a');
    origins.clear();
    expect(
      readNewMakerDialogueTargetRequest(makeGenericNewMakerRouteState('/cc-agent/task-a')),
    ).toMatchObject({ deviceId: 'computer-a' });
  });

  it('preserves the draft until a cold-start task origin is known', () => {
    expect(makeGenericNewMakerRouteState('/cc-agent/task-a')).toEqual({
      workspacePrompt: 'generic',
    });
    origins.set('task-a', 'computer-a');
    expect(
      readNewMakerDialogueTargetRequest(makeGenericNewMakerRouteState('/cc-agent/task-a')),
    ).toMatchObject({ deviceId: 'computer-a' });
  });

  it.each([
    '/cc-agent/new',
    '/cc-agent/scheduled',
    '/cc-agent/orca/new',
    '/settings',
    '/plugins',
    '/bots',
    '/bots/roster',
    '/bots/remote',
    '/bots/unknown',
    '/bots/bot-a/direct/thread-a',
  ])('preserves the draft when no task is active at %s', (path) => {
    expect(makeGenericNewMakerRouteState(path)).toEqual({ workspacePrompt: 'generic' });
  });

  it('consumes the inherited target once so history does not override later user choices', () => {
    origins.set('task-a', 'computer-a');
    const state = makeGenericNewMakerRouteState('/cc-agent/task-a');
    expect(consumeNewMakerDialogueTargetRequest(state)).toEqual({ workspacePrompt: 'generic' });
    expect(readNewMakerDialogueTargetRequest(state)).not.toBeNull();
  });
});
