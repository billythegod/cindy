import { REMOTE_RESOURCE_GET_CHANNEL, REMOTE_RESOURCE_LIST_CHANNEL, REMOTE_RESOURCE_INVOKE_CHANNEL } from '@cindy/device-link';
import type { RemoteCollectionListResponse, RemoteResource, InvokeResultPayload } from '@cindy/device-link';
import type { DeviceLinkDeviceView } from '../../shared/deviceLinkIpc.js';
import { botPeerAddress, parseBotPeerAddress } from '../../shared/botPeerAddress.js';
import type { BotDirectMessageResult, BotMessageTransport } from './botDirectMessageService.js';

const client = { protocolVersion: 1, primitives: ['status', 'session-link'] };
const ref = (id: string) => ({ collectionId: 'teammates', kind: 'bot', id });
const unavailable = (code: string): Error => Object.assign(new Error(code), { code });

/** Uses the same directory, resource projection and authenticated IPC tunnel as the clients. */
export function createBotMessageTransport(deps: {
  selfDeviceId(): string | null;
  listDevices(): Promise<{ devices: DeviceLinkDeviceView[] }>;
  invoke(deviceId: string, channel: string, args: unknown[], options?: { preSend?: () => void }): Promise<InvokeResultPayload>;
}): BotMessageTransport {
  const value = async <T>(deviceId: string, channel: string, args: unknown[], preSend?: () => void): Promise<T> => {
    const result = await deps.invoke(deviceId, channel, args, { preSend });
    if (!result.ok) {
      const code = result.error.code === 'IPC_ERROR'
        ? /^\[([A-Z_]+)\]/.exec(result.error.message)?.[1] ?? 'REMOTE_UNAVAILABLE'
        : result.error.code;
      throw unavailable(code);
    }
    return result.result as T;
  };
  const device = async (deviceId: string) => {
    const row = (await deps.listDevices()).devices.find(item => item.deviceId === deviceId && !item.isSelf);
    if (!row) throw unavailable('PERMISSION_DENIED');
    if (!row.controlEnabled || !row.remoteControlEnabled) throw unavailable('REMOTE_DISABLED');
    if (!row.online) throw unavailable('DEVICE_OFFLINE');
    return row;
  };
  return {
    selfDeviceId: deps.selfDeviceId,
    async verifySender(input, assertCurrent) {
      assertCurrent();
      const result = await value<{ verified?: boolean }>(input.controllerDeviceId, REMOTE_RESOURCE_INVOKE_CHANNEL,
        [{ client, collectionId: 'teammates', actionId: 'verify-message', resourceRef: ref(input.senderBotId),
          input: { targetBotId: input.targetBotId, message: input.message, messageId: input.messageId } }], assertCurrent);
      return result.verified === true;
    },
    async list() {
      const devices = (await deps.listDevices()).devices.filter(row => !row.isSelf && !['ios', 'android'].includes(row.platform ?? ''));
      const agents: Awaited<ReturnType<BotMessageTransport['list']>>['agents'] = [];
      const unavailableDevices: Awaited<ReturnType<BotMessageTransport['list']>>['unavailableDevices'] = [];
      // Bound fanout independently of how many devices an account has registered.
      for (let offset = 0; offset < devices.length; offset += 3) {
        await Promise.all(devices.slice(offset, offset + 3).map(async row => {
          try {
            if (!row.controlEnabled || !row.remoteControlEnabled) throw unavailable('REMOTE_DISABLED');
            if (!row.online) throw unavailable('DEVICE_OFFLINE');
            const result = await value<RemoteCollectionListResponse>(row.deviceId, REMOTE_RESOURCE_LIST_CHANNEL,
              [{ client, collectionId: 'teammates', limit: 200 }]);
            for (const item of result.items) {
              if (item.ref.collectionId !== 'teammates' || item.ref.kind !== 'bot') continue;
              const name = typeof item.display.title === 'string' ? item.display.title : item.display.title.fallback;
              agents.push({ id: botPeerAddress(row.deviceId, item.ref.id), name,
                deviceId: row.deviceId, deviceName: row.name });
            }
            if (result.nextCursor || result.items.length >= 200) throw unavailable('ROSTER_MAY_BE_TRUNCATED');
          } catch (error) {
            unavailableDevices.push({ deviceId: row.deviceId, deviceName: row.name,
              errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'REMOTE_UNAVAILABLE' });
          }
        }));
      }
      return { agents, unavailableDevices };
    },
    async resolve(targetId) {
      const address = parseBotPeerAddress(targetId);
      if (!address) throw unavailable('INVALID_ARGS');
      await device(address.deviceId);
      const resource = await value<RemoteResource & { teammateMessaging?: { version: number; available: boolean } }>(address.deviceId, REMOTE_RESOURCE_GET_CHANNEL,
        [{ client, ref: ref(address.botId) }]);
      if (resource.ref.id !== address.botId || resource.ref.kind !== 'bot' || resource.ref.collectionId !== 'teammates') {
        throw unavailable('NOT_FOUND');
      }
      if (resource.teammateMessaging?.version !== 1) throw unavailable('UNSUPPORTED_CAPABILITY');
      if (!resource.teammateMessaging.available) throw unavailable('TARGET_BOT_INACTIVE');
      return { id: targetId, name: typeof resource.display.title === 'string' ? resource.display.title : resource.display.title.fallback };
    },
    async send(input, assertCurrent) {
      const address = parseBotPeerAddress(input.targetId);
      if (!address) throw unavailable('INVALID_ARGS');
      try { await device(address.deviceId); assertCurrent(); }
      catch (error) { return { ok: false, errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'OWNER_CHANGED', message: 'Remote message was not sent' }; }
      let response: { effects: unknown[]; teammateMessage?: BotDirectMessageResult };
      try { response = await value<{ effects: unknown[]; teammateMessage?: BotDirectMessageResult }>(address.deviceId,
        REMOTE_RESOURCE_INVOKE_CHANNEL, [{ client, collectionId: 'teammates', actionId: 'send-message',
          resourceRef: ref(address.botId), input: { senderBotId: input.senderBotId,
            message: input.message, messageId: input.messageId } }], assertCurrent);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        const inFlight = error && typeof error === 'object' && 'inFlight' in error && error.inFlight === true;
        if (!inFlight && ['NOT_FOUND', 'UNSUPPORTED_CAPABILITY', 'REMOTE_DISABLED', 'PERMISSION_DENIED',
          'ACCESS_REVOKED', 'CHANNEL_NOT_ALLOWED', 'DEVICE_OFFLINE'].includes(code)) {
          return { ok: false, errorCode: code, message: `Remote message rejected: ${code}` };
        }
        throw error;
      }
      const receipt = response.teammateMessage;
      if (!receipt || typeof receipt !== 'object' || typeof receipt.ok !== 'boolean') throw unavailable('DELIVERY_UNKNOWN');
      if (!receipt.ok) {
        if (typeof receipt.errorCode !== 'string') throw unavailable('DELIVERY_UNKNOWN');
        // Remote roster IDs are local to that host. Do not return them as fallback
        // targets on this device, nor echo arbitrary remote error text.
        return { ok: false, errorCode: receipt.errorCode, message: `Remote message rejected: ${receipt.errorCode}` };
      }
      if (receipt.messageId !== input.messageId || receipt.accepted !== true || typeof receipt.delivered !== 'boolean'
        || !['queued', 'resumed', 'created', 'already-active'].includes(receipt.wakeKind)) throw unavailable('DELIVERY_UNKNOWN');
      return { ok: true, accepted: true, delivered: receipt.delivered, messageId: input.messageId,
        wakeKind: receipt.wakeKind, targetBotId: input.targetId, targetBotName: '', targetSessionId: '',
        threadId: '', messageCount: 0, remainingMessages: 0, conversationEnded: false };

    },
  };
}
