import type { BotDirectMessageService } from './botDirectMessageService.js';

/** Late-bound adapter keeps the resource provider independent of Maker initialization order. */
let service: Pick<BotDirectMessageService, 'receiveRemote' | 'verifyRemoteMessage'> | null = null;
export function setBotRemoteMessageService(next: Pick<BotDirectMessageService, 'receiveRemote' | 'verifyRemoteMessage'>): void { service = next; }
export function getBotRemoteMessageService(): Pick<BotDirectMessageService, 'receiveRemote' | 'verifyRemoteMessage'> | null { return service; }
