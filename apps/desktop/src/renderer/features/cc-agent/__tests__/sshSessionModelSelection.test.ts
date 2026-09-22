import { describe, expect, it, vi } from 'vitest';
import type { CatalogModel, ProviderView } from '@cindy/model-providers';
import { resolveSshSessionModelSelection } from '../sshSessionModelSelection';
import { sshModel, sshProvider } from './sshModelFixtures';

function resolve(
  providers: ProviderView[],
  patch: Partial<Parameters<typeof resolveSshSessionModelSelection>[0]> = {},
) {
  return resolveSshSessionModelSelection({
    providers,
    loading: false,
    loadFailed: false,
    agentKind: 'codex',
    preferred: { model: 'gpt-5.5-codex', effort: 'medium', fastMode: true },
    ...patch,
  });
}

describe('SSH creation model selection', () => {
  it('replaces a removed model with an actual catalog route without naming another default', () => {
    expect(resolve([sshProvider('custom-account')])).toEqual({
      ok: true,
      model: 'available-model',
      providerId: 'custom-account',
      effort: 'high',
      fastMode: false,
    });
  });

  it('preserves a valid preference and uses that source’s effort and Fast capabilities', () => {
    const preferred = {
      model: 'chosen',
      providerId: 'second',
      effort: 'low',
      fastMode: true,
    } as const;
    expect(
      resolve(
        [
          sshProvider('first', [sshModel('chosen')]),
          sshProvider('second', [sshModel('chosen', { efforts: ['low'], supportsFastMode: true })]),
        ],
        { preferred },
      ),
    ).toEqual({ ok: true, ...preferred });
  });

  it('replaces an invalid source preference and pins the compatible same-model route', () => {
    const local = sshProvider('openai');
    local.routing.codex!.wireProtocol = 'openai-chat';
    expect(
      resolve([local, sshProvider('remote-compatible')], {
        preferred: {
          model: 'available-model',
          providerId: 'openai',
          effort: 'high',
          fastMode: true,
        },
      }),
    ).toMatchObject({ ok: true, model: 'available-model', providerId: 'remote-compatible' });
  });

  it.each(['chatgpt/only-local', 'xai/only-local'])(
    'rejects subscription bridge model %s',
    (id) => {
      expect(resolve([sshProvider('source', [sshModel(id)])])).toEqual({
        ok: false,
        reason: 'no-route',
      });
    },
  );

  it('rejects a catalog containing only local bridges or independent OAuth accounts', () => {
    const bridge = sshProvider('bridge');
    bridge.routing.codex!.wireProtocol = 'openai-chat';
    const account = sshProvider('openai-second');
    account.auth = { method: 'oauth', native: 'codex' };
    expect(resolve([bridge, account])).toEqual({ ok: false, reason: 'no-route' });
  });

  it.each([
    { disabled: true },
    { status: 'retired' },
    { mode: 'image_generation' },
  ] satisfies Partial<CatalogModel>[])('rejects a non-selectable model: %j', (patch) => {
    expect(resolve([sshProvider('source', [sshModel('bad', patch)])])).toEqual({
      ok: false,
      reason: 'no-route',
    });
  });

  it('excludes disconnected, suspended, failed-discovery and disabled runtimes', () => {
    const disconnected = { ...sshProvider('disconnected'), connected: false };
    const suspended = { ...sshProvider('suspended'), suspended: true };
    const failed = {
      ...sshProvider('failed'),
      modelDiscoveryFailure: { kind: 'upstream' as const, at: '2026-09-22T00:00:00Z' },
    };
    const disabled = sshProvider('disabled');
    disabled.routing.codex!.disabled = true;
    expect(resolve([disconnected, suspended, failed, disabled])).toEqual({
      ok: false,
      reason: 'no-route',
    });
  });

  it('does not confuse model visibility with route admission', () => {
    expect(
      resolve([sshProvider('source', [sshModel('hidden', { defaultEnabled: false })])]),
    ).toMatchObject({
      ok: true,
      model: 'hidden',
      providerId: 'source',
    });
  });

  it('applies saved tuning to the resolved model and clamps unsupported effort', () => {
    const getPresetEffort = vi.fn(() => 'max' as const);
    const getPresetFast = vi.fn(() => true);
    expect(
      resolve([sshProvider('source', [sshModel('available-model', { supportsFastMode: true })])], {
        getPresetEffort,
        getPresetFast,
      }),
    ).toMatchObject({ ok: true, effort: 'high', fastMode: true });
    expect(getPresetEffort).toHaveBeenCalledWith('codex', 'source', 'available-model');
    expect(getPresetFast).toHaveBeenCalledWith('codex', 'source', 'available-model');
  });

  it('retains the ordinary draft policy when the catalog has no effort levels', () => {
    expect(
      resolve([sshProvider('source', [sshModel('plain', { efforts: [], defaultEffort: null })])]),
    ).toMatchObject({
      ok: true,
      effort: 'medium',
      fastMode: false,
    });
  });

  it.each([
    { loading: true, loadFailed: false, reason: 'catalog-loading' },
    { loading: true, loadFailed: true, reason: 'catalog-error' },
    { loading: false, loadFailed: true, reason: 'catalog-error' },
  ])('never selects from unready/stale data: %j', ({ loading, loadFailed, reason }) => {
    expect(resolve([sshProvider('source')], { loading, loadFailed })).toEqual({
      ok: false,
      reason,
    });
  });

  it.each(['claude-code', 'pi'] as const)('preserves ordinary SSH creation for %s', (agentKind) => {
    expect(resolve([sshProvider('source', undefined, agentKind)], { agentKind })).toMatchObject({
      ok: true,
      providerId: 'source',
      model: 'available-model',
    });
  });
});
