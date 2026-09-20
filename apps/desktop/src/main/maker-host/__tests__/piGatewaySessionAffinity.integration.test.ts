/** Real Pi RPC → production loopback proxy → fake upstream affinity regression. */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicCompatProxy } from '@cindy/anthropic-compat-proxy';
import { BUNDLED_CATALOG } from '@cindy/model-providers';
import { PiAgent } from '../../../../../../packages/maker-core/src/agents/pi/index.js';
import type { AgentDeps, AgentSessionHandle } from '../../../../../../packages/maker-core/src/agents/base-agent.js';
import type { Logger } from '../../../../../../packages/maker-core/src/interfaces/logger.js';

vi.mock('../model-discovery/xai.js', () => ({ discardXaiModelsDiskCache: vi.fn(async () => {}) }));
vi.mock('../grok-oauth-login.js', () => ({ hasGrokOAuthLogin: () => false }));
vi.mock('../anthropic-compat-proxy-host.js', () => ({ getClaudeEndpoint: () => undefined }));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ trace() {}, debug() {}, info() {}, warn() {}, error() {} }) }));
import { resolvePiCindyGatewayModelSpec } from '../pi-host.js';
import { setActiveCatalog, setXdGatewayModels } from '../active-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const binary = process.env.CINDY_TEST_PI_BINARY || path.join(root, 'apps/pi-bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'pi.exe' : 'pi');
const logger: Logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child: () => logger };
afterEach(() => { setActiveCatalog(BUNDLED_CATALOG); setXdGatewayModels([]); });

function sse(events: Array<{ event: string; data: unknown }>): string {
  return events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

/** 最小合法的 Anthropic Messages SSE 流:一段 text + usage。 */
function anthropicStreamBody(text: string, model: string): string {
  return sse([
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_test_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 42, output_tokens: 0 },
        },
      },
    },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    {
      event: 'message_delta',
      data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
}

function chatCompletionsStreamBody(text: string, model: string): string {
  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl_pi_native_1',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'chatcmpl_pi_native_1',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'chatcmpl_pi_native_1',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}


async function sendTurn(handle: AgentSessionHandle, content: string) {
  const events = (async () => {
    const seen = [];
    for await (const event of handle.events()) {
      seen.push(event);
      if (event.type === 'done') break;
    }
    return seen;
  })();
  await handle.send({ type: 'user', content });
  const seen = await events;
  expect(seen.filter(event => event.type === 'error')).toEqual([]);
  expect(seen.some(event => event.type === 'text')).toBe(true);
  expect(seen.at(-1)?.type).toBe('done');
}

describe.skipIf(!existsSync(binary))('Gateway session affinity (real Pi RPC and proxy)', () => {
  it.each([
    ['moonshot/kimi-k3', 'openai-completions'],
    ['claude-opus-5', 'anthropic-messages'],
  ] as const)('keeps %s affinity stable across turns/resume and isolates other tasks and BYOM', async (model, api) => {
    const temp = mkdtempSync(path.join(tmpdir(), 'cindy-pi-affinity-'));
    const workingDir = path.join(temp, 'workspace');
    mkdirSync(workingDir);
    const requests: Array<{ url: string; headers: IncomingHttpHeaders; body: string }> = [];
    const upstream = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests.push({ url: req.url ?? '', headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(api === 'openai-completions' ? chatCompletionsStreamBody('affinity-ok', model) : anthropicStreamBody('affinity-ok', model));
      });
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(upstream.address() as import('node:net').AddressInfo).port}`;
    let proxyRequests = 0;
    const proxy = await createAnthropicCompatProxy({
      upstream: endpoint,
      requestGuard: () => { proxyRequests += 1; return null; },
    });
    let handle: AgentSessionHandle | undefined;
    try {
      setActiveCatalog(BUNDLED_CATALOG);
      setXdGatewayModels([{ id: model, agents: ['pi'] }]);
      const deps: AgentDeps = {
        binaryPath: binary, logger,
        auth: {
          getState: async () => ({ authenticated: true, identity: 'fixture', authSource: 'api-key' as const }),
          triggerLogin: async () => ({ authenticated: true }), logout: async () => {},
          getAuthEnv: async () => ({ CINDY_PI_API_KEY: 'fixture-not-a-real-key', HOME: temp, USERPROFILE: temp }),
        },
        runtimeConfig: { endpoint: proxy.url },
        resolvePiAgentHome: () => path.join(temp, 'agent'),
        resolvePiGlobalContextHome: () => temp,
        resolvePiGatewayModelSpec: resolvePiCindyGatewayModelSpec,
        capabilityAdditions: { availableModels: [{ id: model, displayName: model, contextWindow: 200000, efforts: [], defaultEffort: null }] },
      };
      const agent = new PiAgent(deps);
      handle = await agent.startSession({ sessionId: 'task-a', providerId: 'xd', model, workingDir });
      const nativeId = handle.id;
      await sendTurn(handle, 'AFFINITY_FIRST_TURN');
      const affinityId = JSON.parse(readFileSync(nativeId, 'utf8').split('\n')[0]!).id as string;
      expect(affinityId).toMatch(/^[0-9a-f-]{36}$/);
      await sendTurn(handle, 'AFFINITY_SECOND_TURN');
      await handle.close(); handle = undefined;
      handle = await agent.startSession({ sessionId: 'task-a', providerId: 'xd', model, workingDir, resumeSessionId: nativeId });
      expect(handle.id).toBe(nativeId);
      await sendTurn(handle, 'AFFINITY_RESUMED_TURN');
      expect(requests).toHaveLength(3);
      expect(requests[2]!.body).toContain('AFFINITY_FIRST_TURN');
      expect(requests[2]!.body).toContain('AFFINITY_SECOND_TURN');
      for (const request of requests) {
        expect(request.url).toContain(api === 'openai-completions' ? '/chat/completions' : '/messages');
        expect(request.headers['x-session-affinity']).toBe(affinityId);
        if (api === 'openai-completions') {
          expect(request.headers.session_id).toBe(affinityId);
          expect(request.headers['x-client-request-id']).toBe(affinityId);
        }
      }
      await handle.close(); handle = undefined;
      handle = await agent.startSession({ sessionId: 'task-b', providerId: 'xd', model, workingDir });
      expect(handle.id).not.toBe(nativeId);
      await sendTurn(handle, 'AFFINITY_OTHER_TASK');
      expect(requests).toHaveLength(4);
      expect(requests[3]!.headers['x-session-affinity']).toBe(JSON.parse(readFileSync(handle.id, 'utf8').split('\n')[0]!).id);
      expect(requests[3]!.headers['x-session-affinity']).not.toBe(affinityId);
      expect(requests[3]!.body).not.toContain('AFFINITY_FIRST_TURN');
      await handle.close(); handle = undefined;

      // Direct BYOM uses its own native provider without Gateway policy injection.
      deps.resolvePiNativeProviders = async () => ({ providers: [{
        id: 'fixture-byom', name: 'Fixture BYOM', baseUrl: endpoint, api,
        apiKeyEnvVar: 'CINDY_FIXTURE_BYOM_KEY', models: [{ id: 'fixture-model', name: 'Fixture model' }],
      }], env: { CINDY_FIXTURE_BYOM_KEY: 'fixture-not-a-real-key' } });
      const directAgent = new PiAgent(deps);
      handle = await directAgent.startSession({ sessionId: 'task-byom', providerId: 'fixture-byom', model: 'fixture-model', workingDir });
      await sendTurn(handle, 'BYOM_UNCHANGED');
      expect(requests).toHaveLength(5);
      expect(proxyRequests).toBe(4);
      for (const header of ['x-session-affinity', 'session_id', 'x-client-request-id']) {
        expect(requests[4]!.headers[header]).toBeUndefined();
      }
    } finally {
      await handle?.close();
      await proxy.dispose();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(temp, { recursive: true, force: true });
    }
  }, 60000);
});
