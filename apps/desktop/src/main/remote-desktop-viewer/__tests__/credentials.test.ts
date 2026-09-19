import { beforeEach, expect, it, vi } from 'vitest';
import { ViewerCredentials } from '../credentials';

const native = vi.hoisted(() => ({ call: vi.fn(), dispose: vi.fn() }));
vi.mock('../../remote-desktop/credentialHost', () => ({
  RemoteCredentialHost: class {
    viewerCall = native.call;
    dispose = native.dispose;
  },
  remoteCredentialHost: {
    currentToken: () => ({
      realm: 'global',
      membership: 'owner',
      authDevice: 'local',
      token: 'test-token',
    }),
  },
}));
vi.mock('../../i18n', () => ({ getResolvedMainLocale: () => 'en' }));
vi.mock('electron', () => ({ nativeTheme: { shouldUseDarkColors: false } }));
beforeEach(() => {
  vi.resetAllMocks();
});
const mac = it.runIf(process.platform === 'darwin');
mac.each(['unlocked', 'unknown'])('does not authenticate when host state is %s', async (state) => {
  native.call.mockResolvedValue({ autoUnlock: true });
  const request = vi.fn(async () => ({ version: 1, state })) as any;
  const credentials = new ViewerCredentials({ request });
  await credentials.run('target', 'darwin', 'unlock', undefined, () => {});
  expect(request).toHaveBeenCalledTimes(1);
  expect(native.call.mock.calls.map((call) => call[1])).toEqual(['viewerSettings']);
});
mac(
  'preserves a disabled biometric preference when reenabling and never receives a password',
  async () => {
    let receives = 0;
    native.call.mockImplementation(async (_realm, method, args) => {
      if (method === 'viewerSettings')
        return { autoUnlock: false, biometricAvailable: true, biometricPreferred: false };
      if (method === 'viewerBegin') {
        expect(args.biometric).toBe(false);
        return { handle: 'local', offer: 'encrypted-offer', descriptor: 'public-local' };
      }
      if (method === 'viewerReceive')
        return JSON.stringify(
          ++receives === 1 ? { kind: 'ready' } : { kind: 'authenticated', accepted: true },
        );
      if (method === 'viewerPassword') return 'ciphertext-only';
      if (method === 'viewerEnd') return '';
      return 'encrypted-ready';
    });
    const request = vi.fn(async (message: any) => {
      if (message.kind === 'prepare') {
        expect(message.setup).toBe(true);
        return { version: 1, ready: true, descriptor: 'public-host' };
      }
      if (message.kind === 'open') return { handle: 'remote', offer: 'encrypted-offer' };
      return { ciphertext: 'encrypted-reply' };
    }) as any;
    await new ViewerCredentials({ request }).run('target', 'darwin', 'enable', undefined, () => {});
    expect(
      request.mock.calls.some(([message]: any[]) => message.ciphertext === 'ciphertext-only'),
    ).toBe(true);
    expect(native.call.mock.calls.filter((call) => call[1] === 'viewerPassword')).toHaveLength(1);
  },
);
mac('cancels native preparation before it can send a late credential offer', async () => {
  let finish!: () => void;
  native.call.mockImplementation(async (_realm, method) =>
    method === 'viewerSettings'
      ? {}
      : new Promise<void>((resolve) => {
          finish = resolve;
        }),
  );
  const request = vi.fn(async () => ({
    version: 1,
    ready: true,
    descriptor: 'public-host',
  })) as any;
  const credentials = new ViewerCredentials({ request });
  const pending = credentials.run('target', 'darwin', 'enable', undefined, () => {});
  const rejected = expect(pending).rejects.toThrow('CREDENTIAL_CANCELLED');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  credentials.dispose();
  finish();
  await rejected;
  expect(request).toHaveBeenCalledTimes(1);
  expect(native.dispose).toHaveBeenCalledOnce();
});
