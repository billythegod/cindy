import { describe, expect, it } from 'vitest';
import {
  HistoryViewController, HistoryViewHandoff, projectHistoryView, renderHistoryView,
} from '@cindy/maker-shared/message-window';
import { buildRenderItems, groupWorkRuns } from '../components/chat/MessageStream';
import type { HistoryChatMessage } from '../lib/makerChatStore';
import { confirmRemoteUsers, projectRemoteUsers, reserveRemoteUser } from '../lib/remoteUserHandoff';

const row = (clientId: string, isStreaming = false): HistoryChatMessage => ({
  id: clientId, clientId, role: clientId === 'user' ? 'user' : 'assistant',
  content: clientId === 'user' ? 'question' : 'visible answer', isStreaming,
  createdAt: clientId === 'user' ? '2026-09-08T00:00:01Z' : '2026-09-08T00:00:00Z',
});

function fixture() {
  let source = [row('user')];
  const view = new HistoryViewController<HistoryChatMessage>({
    page: async () => ({ version: 1, items: projectHistoryView(source, false), hasMore: false, nextCursor: null }),
    details: async () => ({ version: 1, messages: [], hasMore: false, nextCursor: null }),
    expanded: async () => undefined,
  });
  const handoff = new HistoryViewHandoff<HistoryChatMessage>((message) => message.isStreaming === true);
  const render = (raw: HistoryChatMessage[]) => {
    raw = projectRemoteUsers(raw);
    const snapshot = view.getSnapshot();
    const state = handoff.reconcile(snapshot, raw);
    const build = (rows: readonly HistoryChatMessage[]) => groupWorkRuns(buildRenderItems([...rows]).items, false);
    const items = snapshot.ready ? renderHistoryView({
      view, snapshot, liveMessages: raw, streaming: false,
      isLive: (message) => message.isStreaming === true,
      pendingHandoff: state.pending,
      isLocalUser: (message) => message.role === 'user' && (message.isPendingPersist === true || !!message.blockedByGhost || !!message.localSendPrecedingClientIds),
      build,
      structure: {
        placeholder: () => { throw new Error('This fixture contains prose only'); },
        children: () => undefined,
        sourceIds: () => [],
        rebuild: (item) => item,
      },
    }) : build(raw);
    return { state, text: JSON.stringify(items), items };
  };
  return { view, handoff, render, setSource: (rows: HistoryChatMessage[]) => { source = rows; } };
}

describe('desktop remote history uses the shared live-to-history handoff', () => {
  it.each([false, true])('keeps a sent user through DB echo and stale history, ready=%s', async (ready) => {
    const { view, render, setSource } = fixture();
    if (ready) await view.refresh();
    const pending = reserveRemoteUser({ ...row('sent'), role: 'user' as const, content: 'sent text', isPendingPersist: true }, [row('user')]);
    expect(render([row('user'), pending]).text).toContain('sent text');
    const echo = { ...pending, isPendingPersist: undefined, id: 'db-sent' };
    await view.refresh();
    expect(render([row('user'), echo]).items.filter((item) => item.type === 'message' && item.message.clientId === 'sent')).toHaveLength(1);
    const authoritative = { ...row('sent'), role: 'user' as const, content: 'authoritative sent' };
    setSource([row('user'), authoritative]);
    await view.refresh();
    const confirmed = confirmRemoteUsers([echo], new Set(['sent']));
    expect(confirmed[0].localSendPrecedingClientIds).toBeUndefined();
    expect(render(confirmed).text).toContain('authoritative sent');
    setSource([]);
    await view.refresh();
    expect(render(confirmed).text).not.toContain('sent text');
    expect(render([]).items).toEqual([]);
    view.setActive(false);
  });

  it.each(['2000-01-01', '2040-01-01'])('keeps user before its reply regardless of controller clock %s', async (createdAt) => {
    const { view, render } = fixture();
    await view.refresh();
    const pending = reserveRemoteUser({ ...row('sent'), role: 'user' as const, createdAt }, [row('user')]);
    const answer = row('answer', true);
    // Raw store may have sorted the host reply ahead of the controller's user row.
    const result = render([row('user'), answer, pending]);
    expect(result.items.filter((item) => item.type === 'message').map((item) => item.message.clientId)).toEqual(['user', 'sent', 'answer']);
    const second = reserveRemoteUser({ ...row('second'), role: 'user' as const }, [row('user'), pending, answer]);
    expect(projectRemoteUsers([row('user'), second, answer, pending]).map((item) => item.clientId)).toEqual(['user', 'sent', 'answer', 'second']);
    view.setActive(false);
  });

  it('keeps finalized prose through the first stale page and takes over once by clientId', async () => {
    const { view, render, setSource } = fixture();
    expect(render([row('answer', true)]).text).toContain('visible answer');
    expect(render([row('answer')]).text).toContain('visible answer');
    await view.refresh();
    // The provisional timestamp is older than the history tail; it still belongs
    // to this displayed stream, unlike an arbitrary durable cache row.
    expect(render([row('answer')]).text).toContain('visible answer');
    expect(render([{ ...row('answer'), id: 'persisted-id', rowid: 42 }]).text).toContain('visible answer');
    await view.refresh();
    expect(render([row('answer')]).text).toContain('visible answer');
    setSource([row('user'), { ...row('answer'), id: 'persisted-id', content: 'authoritative answer' }]);
    await view.refresh();
    const final = render([row('answer')]);
    expect(final.state.pending.size).toBe(0);
    expect(final.text).not.toContain('visible answer');
    expect(final.items.filter((item) => item.type === 'message' && item.message.clientId === 'answer')).toHaveLength(1);
    expect(final.text).toContain('authoritative answer');
    view.setActive(false);
  });

  it('retains local pending user bubbles while the assistant awaits history', async () => {
    const { view, render } = fixture();
    await view.refresh();
    render([row('answer', true)]);
    const pending: HistoryChatMessage = { ...row('pending'), role: 'user', content: 'queued follow-up', isPendingPersist: true };
    const final = render([row('answer'), pending]);
    expect(final.text).toContain('visible answer');
    expect(final.text).toContain('queued follow-up');
    expect(final.items.filter((item) => item.type === 'message').map((item) => item.message.clientId)).toEqual(['user', 'answer', 'pending']);
    view.setActive(false);
  });

  it('does not resurrect finalized raw rows after removal, reset or a source switch', async () => {
    const { view, render } = fixture();
    await view.refresh();
    expect(render([row('old')]).text).not.toContain('visible answer');
    render([row('answer', true)]);
    render([]);
    expect(render([row('answer')]).text).not.toContain('visible answer');
    render([row('answer', true)]);
    view.reset();
    render([row('answer')]);
    await view.refresh();
    expect(render([row('answer')]).text).not.toContain('visible answer');
    const replacement = fixture();
    await replacement.view.refresh();
    expect(replacement.render([row('answer')]).text).not.toContain('visible answer');
    replacement.view.setActive(false);
    view.setActive(false);
  });
});
