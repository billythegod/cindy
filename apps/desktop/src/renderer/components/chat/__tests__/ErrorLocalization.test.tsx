// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { SUPPORTED_LOCALES } from '../../../../shared/locale';
import en from '@/i18n/locales/en/common.json';
import zhCN from '@/i18n/locales/zh-CN/common.json';
import zhTW from '@/i18n/locales/zh-TW/common.json';
import ja from '@/i18n/locales/ja/common.json';
import ko from '@/i18n/locales/ko/common.json';

vi.mock('@/components/ui/confirm-dialog-provider', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('@/hooks/useCodexRuntimeRoute', () => ({ useCodexRuntimeRoute: () => ({ authInjection: 'env-key' }) }));
vi.mock('@/hooks/useCodexSessionExpiredPrompt', () => ({ isCodexSessionExpiredError: () => false, useCodexSessionExpiredPrompt: () => vi.fn() }));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [], refetch: vi.fn() }) }));
vi.mock('@/hooks/useCodexAuth', () => ({ useCodexAuth: () => ({ state: { kind: 'disconnected' } }), isChatGptConnectionConnected: () => false }));
import { ErrorBanner } from '../ErrorBanner';
import { ErrorMessageCard } from '../ErrorMessageCard';
import { ErrorTailErrorBanner } from '../InterruptedTurnBanner';

const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko };
const raw = JSON.stringify({ error: {
  message: 'X-OpenAI-Internal-Codex-Responses-Lite requires `parallel_tool_calls` to be false.',
  type: 'invalid_request_error', code: 'unsupported_value', param: 'parallel_tool_calls',
} });
afterEach(cleanup);

describe.each(SUPPORTED_LOCALES)('error presentation in %s', locale => {
  it.each(['live', 'tail', 'history'] as const)('localizes %s and keeps diagnostics collapsed, with existing recovery', async surface => {
    const i18n = createInstance();
    await i18n.init({ lng: locale, fallbackLng: 'en', resources: Object.fromEntries(Object.entries(locales).map(([lng, common]) => [lng, { translation: common }])) });
    const retry = vi.fn();
    render(<I18nextProvider i18n={i18n}>{surface === 'live'
      ? <ErrorBanner error={raw} retryText="original-welcome" onRetry={retry} />
      : surface === 'tail'
        ? <ErrorTailErrorBanner errorText={raw} onContinue={retry} onDismiss={vi.fn()} />
        : <ErrorMessageCard message={raw} />}</I18nextProvider>);
    const copy = locales[locale].chat.errorBanner;
    expect(screen.getByText(copy.requestFormatError)).toBeTruthy();
    expect(screen.queryByText(raw)).toBeNull();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(copy.networkShowRaw));
    expect(screen.getByText(raw)).toBeTruthy();
    fireEvent.click(screen.getByText(copy.networkHideRaw));
    expect(screen.queryByText(raw)).toBeNull();
    if (surface !== 'history') {
      fireEvent.click(screen.getByTitle(copy.retryTitle));
      expect(retry).toHaveBeenCalledTimes(1);
      if (surface === 'live') expect(retry).toHaveBeenCalledWith('original-welcome');
    }
    const next = locale === 'en' ? 'ja' : 'en';
    await act(async () => { await i18n.changeLanguage(next); });
    expect(screen.getByText(locales[next].chat.errorBanner.requestFormatError)).toBeTruthy();
    expect(screen.getByText(locales[next].chat.errorBanner.networkShowRaw)).toBeTruthy();
  });

  it.each(['live', 'history'] as const)('hides unknown English errors and redacts details in %s', async surface => {
    const i18n = createInstance();
    await i18n.init({ lng: locale, fallbackLng: 'en', resources: { [locale]: { translation: locales[locale] } } });
    const error = 'Unexpected provider failure; api_key=private-test-value';
    render(<I18nextProvider i18n={i18n}>{surface === 'live'
      ? <ErrorBanner error={error} onRetry={vi.fn()} />
      : <ErrorMessageCard message={error} />}</I18nextProvider>);
    expect(screen.getByText(locales[locale].chat.errorBanner.replyFailed)).toBeTruthy();
    expect(screen.queryByText(/Unexpected provider/)).toBeNull();
    fireEvent.click(screen.getByText(locales[locale].chat.errorBanner.networkShowRaw));
    expect(screen.getByText(/Unexpected provider failure/).textContent).toContain('[REDACTED]');
    expect(screen.queryByText(/private-test-value/)).toBeNull();
  });
});
