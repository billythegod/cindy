import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as unknown[][] }));
vi.mock('../localDb/client/current.js', () => ({
  getDbClient: () => ({ drizzle: { select: () => {
    const query = { from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query, limit: async () => state.rows.shift() ?? [], get: async () => state.rows.shift()?.[0] };
    return query;
  } } }),
}));
import { readSessionNotificationPreview } from '../localDb/sessionNotificationPreview';
beforeEach(() => { state.rows = []; });
const session = { source: 'bot', activeTurnStartedAt: 100, lastTurnEndedAt: 200, clearedAt: null };
it('reads canonical teammate identity and this turn final from the durable transcript', async () => {
  state.rows = [[session], [{ name: 'Cindy' }], [{ clientId: 'final-2', role: 'assistant', content: '**完成**', createdAt: 150, agentMeta: JSON.stringify({ turnCompleted: true, assistantPhase: 'final_answer' }) }]];
  expect(await readSessionNotificationPreview('main')).toEqual({ teammateName: 'Cindy', reply: { clientId: 'final-2', text: '**完成**' }, eventId: 'final-2' });
});
it('suppresses an old idle event after a new input started', async () => {
  state.rows = [[{ ...session, activeTurnStartedAt: 300 }], [{ name: 'Cindy' }]];
  expect(await readSessionNotificationPreview('main')).toEqual({ teammateName: 'Cindy', suppress: true });
});
it('does not reuse an older final in a tool-only completed turn', async () => {
  state.rows = [[session], [{ name: 'Cindy' }], [{ clientId: 'old', role: 'assistant', content: 'Old answer', createdAt: 10, agentMeta: JSON.stringify({ turnCompleted: true }) }]];
  expect(await readSessionNotificationPreview('main')).toEqual({ teammateName: 'Cindy', reply: undefined, eventId: 'turn:100:200' });
});
