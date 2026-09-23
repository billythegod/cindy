// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialProvider } from '@cindy/auth-client';

const native = vi.hoisted(() => ({
  platform: 'ios',
  listeners: new Set<(state: string) => void>(),
  available: vi.fn(),
  supported: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (
      _event: string,
      listener: (state: string) => void,
    ) => {
      native.listeners.add(listener);
      return { remove: () => native.listeners.delete(listener) };
    },
  },
  Platform: {
    get OS() {
      return native.platform;
    },
  },
}));

vi.mock('@/auth/nativeSocial', () => ({
  isNativeSocialProviderAvailable: native.available,
  isNativeSocialProviderSupported: native.supported,
}));

import { useMobileSocialProviderModes } from '../useMobileSocialProviderModes';

const providers: SocialProvider[] = ['wechat'];

function Probe() {
  const modes = useMobileSocialProviderModes({ providers, region: 'cn' });
  return (
    <div>
      {[...modes.keys()].map((provider) => (
        <button data-testid={`login.${provider}Button`} key={provider} />
      ))}
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;

async function renderProbe() {
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
  });
}

function wechatButton() {
  return host.querySelector('[data-testid="login.wechatButton"]');
}

describe('mobile social provider visibility', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    native.platform = 'ios';
    native.available.mockReset().mockResolvedValue(false);
    native.supported.mockReset().mockReturnValue(true);
    host = document.createElement('div');
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    expect(native.listeners.size).toBe(0);
  });

  it('hides WeChat on iOS without probing the SDK', async () => {
    native.available.mockResolvedValue(true);
    await renderProbe();
    expect(wechatButton()).toBeNull();
    expect(native.available).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
  });

  it('hides WeChat on Android without probing installation', async () => {
    native.platform = 'android';
    await renderProbe();
    expect(wechatButton()).toBeNull();
    expect(native.available).not.toHaveBeenCalled();
  });
});
