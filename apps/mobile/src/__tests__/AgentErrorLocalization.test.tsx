// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { SUPPORTED_LOCALES } from '@/i18n/locale';
import { InlineQueueSection } from '@/session/InlineQueueSection';
import { SessionTailBanner } from '@/session/SessionTailBanner';
import { AgentErrorDetails } from '@/session/AgentErrorDetails';
import { resolveSessionTailBanner } from '@/session/sessionTailBannerModel';
import { normalizeRemoteMessages } from '@/session/messageNormalize';
import type { InputProjection, RemoteMessage } from '@/session/types';

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const view = (tag: string) => ({ children, onPress, disabled, testID, accessibilityState }: {
    children?: ReactNode; onPress?: () => void; disabled?: boolean; testID?: string; accessibilityState?: { expanded?: boolean };
  }) => createElement(tag, { onClick: onPress, disabled, 'data-testid': testID, 'aria-expanded': accessibilityState?.expanded }, children);
  return { View: view('div'), Text: view('span'), Pressable: view('button'), ActivityIndicator: () => null,
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 } };
});
vi.mock('@/components/AppText', async () => ({ Text: (await import('react-native')).Text }));
vi.mock('lucide-react-native', () => ({ Pause: () => null, Play: () => null }));
vi.mock('@/theme', async () => {
  const tokens = await import('@/theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.lightColors }),
    useThemedStyles: (make: (colors: typeof tokens.lightColors) => unknown) => make(tokens.lightColors) };
});
const raw = JSON.stringify({ error: { message: 'X-OpenAI-Internal-Codex-Responses-Lite requires `parallel_tool_calls` to be false.', type: 'invalid_request_error', param: 'parallel_tool_calls', code: 'unsupported_value' } });
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const row = (text: string): RemoteMessage => ({ id: 'error', clientId: 'error', sessionId: 's', role: 'error', content: JSON.stringify({ message: text }), toolUseId: null, agentMeta: null, createdAt: '2026-09-23T04:13:00Z' });
const clickText = (text: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text);
  expect(button).toBeTruthy(); button!.click();
};

describe.each(SUPPORTED_LOCALES)('mobile errors in %s', locale => {
  it.each(['live', 'tail'] as const)('localizes %s, preserves retry and switches locale without another request', async surface => {
    await i18n.changeLanguage(locale);
    for (const key of ['requestFormatError', 'replyFailed', 'showErrorDetails', 'hideErrorDetails', 'retry']) {
      expect(i18n.getResource(locale, 'common', `session.tail.${key}`)).toBeTypeOf('string');
    }
    const retry = vi.fn();
    const state = resolveSessionTailBanner({ messages: [row(raw)], session: null, projection: { error: null, credentialSwitchWait: null }, isSessionStreaming: false, continuationInFlight: false, sessionMetadataSyncedForConnection: true, interruptAcked: false, hiddenErrorClientIds: new Set() });
    expect(state?.kind).toBe('error-tail');
    await act(async () => root.render(surface === 'live'
      ? <InlineQueueSection projection={{ error: raw, errorRetryText: 'original-welcome' } as InputProjection} readOnlyReason={null} errorRecoveryReadOnlyReason={null} onRetryError={retry} onClearError={vi.fn()} onResume={vi.fn()} />
      : <SessionTailBanner state={state!} onContinue={retry} onDismiss={vi.fn()} />));
    expect(host.textContent).toContain(i18n.t('session.tail.requestFormatError'));
    expect(host.textContent).not.toContain('Responses-Lite');
    expect(retry).not.toHaveBeenCalled();
    await act(async () => clickText(i18n.t('session.tail.showErrorDetails')));
    expect(host.textContent).toContain(raw);
    await act(async () => clickText(i18n.t('session.tail.hideErrorDetails')));
    const next = locale === 'en' ? 'ja' : 'en';
    await act(async () => { await i18n.changeLanguage(next); });
    expect(host.textContent).toContain(i18n.t('session.tail.requestFormatError'));
    expect(host.textContent).toContain(i18n.t('session.tail.showErrorDetails'));
    const retryButton = host.querySelector<HTMLButtonElement>(`[data-testid="${surface === 'live' ? 'queue.inline.retryButton' : 'session.tailBanner.continue'}"]`)!;
    await act(async () => retryButton.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('localizes historical errors and only discloses redacted unknown diagnostics', async () => {
    await i18n.changeLanguage(locale);
    const [lite, unknown] = normalizeRemoteMessages([row(raw), { ...row('Provider exploded; api_key=private-test-value'), id: 'unknown', clientId: 'unknown' }]);
    expect(lite.body).toBe(i18n.t('session.tail.requestFormatError'));
    expect(unknown.body).toBe(i18n.t('session.tail.replyFailed'));
    await act(async () => root.render(<AgentErrorDetails message={unknown.rawError!} />));
    expect(host.textContent).not.toContain('Provider exploded');
    await act(async () => clickText(i18n.t('session.tail.showErrorDetails')));
    expect(host.textContent).toContain('Provider exploded');
    expect(host.textContent).toContain('[REDACTED]');
    expect(host.textContent).not.toContain('private-test-value');
  });
});
