// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  compact: null as any,
  input: null as any,
  context: {
    status: 'online',
    connectionEpoch: 1,
    recoveringDeviceIds: new Set<string>(),
    getPresenceAvailability: () => true,
  },
}));
vi.mock('react-native', () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ScrollView: ({ children }: any) => <div>{children}</div>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: any) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  useWindowDimensions: () => ({ height: 800, width: 400 }),
}));
vi.mock('@/components/AppText', () => ({
  Text: ({ children }: any) => <span>{children}</span>,
  TextInput: (props: any) => {
    h.input = props;
    return <input readOnly value={props.value} />;
  },
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: ({ children }: any) => <div>{children}</div> },
  useSharedValue: (value: any) => ({ value }),
  useAnimatedStyle: () => ({}),
  runOnJS: (fn: any) => fn,
  withTiming: (v: any) => v,
  cancelAnimation: vi.fn(),
  ReduceMotion: { System: 'system' },
}));
vi.mock('@/platform/gestureHandler', () => {
  const builder: any = new Proxy({}, { get: () => () => builder });
  return { Gesture: { Pan: () => builder }, GestureDetector: ({ children }: any) => children };
});
vi.mock('lucide-react-native', () => ({
  GripVertical: () => null,
  Pencil: () => null,
  MoreHorizontal: () => null,
  ArrowLeft: () => null,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('@/device-link/DeviceLinkContext', () => ({
  useDeviceLink: () => ({ ...h.context, invoke: h.invoke }),
  subscribeRemoteTaskTagsChanged: () => () => {},
}));
vi.mock('@/session/remoteSessionStore', () => ({
  remoteSessionStore: {
    getSessions: () => [],
    getSessionDeviceId: () => 'host',
    subscribe: () => () => {},
  },
  useRemoteSessions: () => [],
}));
import { TaskTagsPanel, TaskTagDots } from '@/session/TaskTags';
import { resetTaskTagCatalogCache } from '@/session/taskTagCatalogCache';
const tag = { id: 'tag', name: 'Work', color: 'red' as const, revision: 1, favoriteOrder: null };
let root: ReturnType<typeof createRoot>;
let node: HTMLDivElement;
const session = { id: 'task', tags: [], canonicalDeviceId: 'host' } as any;
const render = async () =>
  act(async () =>
    root.render(
      <TaskTagsPanel
        session={session}
        expanded={false}
        onExpandedChange={() => {}}
        renderCompact={(state) => {
          h.compact = state;
          return null;
        }}
      />,
    ),
  );
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  resetTaskTagCatalogCache();
  h.context.status = 'online';
  h.context.connectionEpoch = 1;
  h.context.recoveringDeviceIds.clear();
  h.invoke.mockReset().mockResolvedValue({ tags: [tag], sessions: [] });
  node = document.createElement('div');
  root = createRoot(node);
});
afterEach(() => act(() => root.unmount()));
it('refreshes only after the target peer recovers and retains cached offline navigation', async () => {
  await render();
  h.context.recoveringDeviceIds.add('other');
  await render();
  expect(h.invoke).toHaveBeenCalledTimes(1);
  h.context.recoveringDeviceIds.add('host');
  await render();
  expect(h.compact.disabled).toBe(true);
  expect(h.compact.canManage).toBe(true);
  expect(h.compact.tags).toHaveLength(1);
  h.context.recoveringDeviceIds.delete('host');
  await render();
  expect(h.invoke).toHaveBeenCalledTimes(2);
  h.context.connectionEpoch++;
  await render();
  expect(h.invoke).toHaveBeenCalledTimes(3);
  h.context.status = 'offline';
  await render();
  expect(h.compact.canManage).toBe(true);
});
it('discards the request from before peer recovery', async () => {
  let finish!: (value: any) => void;
  h.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  h.context.recoveringDeviceIds.add('host');
  await render();
  h.context.recoveringDeviceIds.delete('host');
  await render();
  await act(async () => finish({ tags: [{ ...tag, name: 'Stale' }], sessions: [] }));
  expect(h.compact.tags[0].name).toBe('Work');
});
it('renders every dot when the optional visible limit is omitted', async () => {
  await act(async () =>
    root.render(<TaskTagDots tags={[tag, { ...tag, id: 'two', name: 'Life' }]} />),
  );
  expect(node.querySelectorAll('div')).toHaveLength(4);
});

it('retries a committed attachment whose response was lost without updating a stale revision', async () => {
  let fail = true;
  h.invoke.mockImplementation(async (_device, _channel, [request]) => {
    if (request.action === 'update') throw new Error('CONFLICT');
    if (request.action === 'attach' && fail) {
      fail = false;
      throw new Error('timeout');
    }
    return { tags: request.action === 'get' ? [] : [tag], sessions: [] };
  });
  await act(async () =>
    root.render(<TaskTagsPanel session={session} expanded onExpandedChange={() => {}} />),
  );
  const click = async (label: string) => {
    const button = Array.from(node.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    )!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  await click('taskTags.add');
  await act(async () => h.input.onChangeText('Work'));
  await click('taskTags.create');
  expect(h.input.editable).toBe(false);
  await click('taskTags.save');
  const actions = h.invoke.mock.calls.map((call) => call[2][0].action);
  expect(actions).toEqual(['get', 'create', 'attach', 'attach']);
  expect(node.querySelector('input')).toBeNull();
});
