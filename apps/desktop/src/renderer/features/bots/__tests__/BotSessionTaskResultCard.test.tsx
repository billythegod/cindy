import { readBotCollaborationMeta } from '../../../../shared/botCollaboration';
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BotSessionTaskResultCard } from '../BotSessionTaskResultCard';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/chat/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content, currentSessionId, workingDir }: any) => <a data-session={currentSessionId} data-workdir={workingDir}>{content}</a> }));
vi.mock('@/components/chat/ChatSessionFileContext', () => ({ useChatSessionFile: () => ({ origin: { kind: 'device', deviceId: 'home' }, sessionId: 'parent', workingDir: '/parent-task' }), ChatSessionFileProvider: ({ children }: any) => children }));
afterEach(cleanup);
const card = { v: 1, role: 'delegation-result', delegationId: 'task-1', fromBotId: 'cindy', fromBotName: 'Cindy', toBotId: null, toBotName: 'Cindy', parentSessionId: 'parent', childSessionId: 'child', objective: 'Report', result: { workingDir: '/child-task', runSequence: 2, status: 'completed', text: 'Second result', artifacts: [{ absolutePath: '/reports/second.pdf' }] } };
it('keeps the execution result and its files in the receipt, without fetching or restarting', () => {
  expect(readBotCollaborationMeta(card)).toMatchObject({ role: 'delegation-result' });
  const { container } = render(<BotSessionTaskResultCard data={{ botCollaboration: card }} />);
  expect(container.querySelector('details')?.open).toBe(false);
  expect(screen.getByText('Second result')).toBeTruthy();
  expect(container.querySelector('a')?.dataset.session).toBe('child');
  expect(container.querySelector('a')?.dataset.workdir).toBe('/child-task');
  expect(container.querySelector('a')?.textContent).toContain('/reports/second.pdf');
});
it('uses human fallback for a stopped task with no result and rejects malformed receipts', () => {
  const { rerender } = render(<BotSessionTaskResultCard data={{ botCollaboration: { ...card, result: { ...card.result, status: 'cancelled', text: '', artifacts: [] } } }} />);
  expect(screen.getByText('bots.collab.noWrittenResult')).toBeTruthy();
  rerender(<BotSessionTaskResultCard data={{ botCollaboration: { ...card, result: {} } }} />);
  expect(screen.queryByText('Report')).toBeNull();
});

it('keeps frozen failure details behind their own disclosure', () => {
  const { container } = render(<BotSessionTaskResultCard data={{ botCollaboration: { ...card, result: { ...card.result, status: 'timed-out', error: 'TIMEOUT: upstream did not finish' } } }} />);
  expect(container.querySelector('summary')?.textContent).toContain('bots.collab.status.timed-out');
  expect(container.querySelector('summary')?.textContent).not.toContain('TIMEOUT:');
  const details = screen.getByText('TIMEOUT: upstream did not finish').closest('details');
  expect(details?.open).toBe(false);
  expect(details?.querySelector('summary')?.textContent).toBe('appError.details');
});
