/**
 * apps/desktop/src/main/maker-ipc/binary-version.ts
 *
 * maker:agent:binary-version IPC handler —— spawn 当前应用使用的 agent 二进制 `--version`,
 * 把首行输出回给 renderer 的 About 面板。
 *
 * 设计:
 *   - Claude/Codex 在 prepare 成功后优先读 getReadyBinaryPath(),必要时可读受管缓存；
 *     Pi 是可选资产，只允许使用本次 prepare 成功的路径，失败时不能复用旧缓存。
 *   - 进程内按 binaryPath 缓存结果, 同一 binary 只 spawn 一次。
 *   - 5s 超时, 失败时返回 { error }。
 */

import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';

import { createLogger } from '../logger.js';
import {
  getReadyBinaryPath,
  getCachedBinaryStatus,
  isVettedAgentBinaryPath,
  type AgentBinaryKind,
} from '../agent-binaries/index.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import { fetchManifest, type Manifest } from '../manifestService.js';

import { MAKER_INVOKE } from './channels.js';

const log = createLogger('maker-ipc:binary-version');

export interface AgentBinaryVersionResult {
  kind: AgentBinaryKind;
  binaryPath: string | null;
  version: string | null;
  /** Latest version published on the active update channel, when reachable. */
  latestVersion: string | null;
  error?: string;
}

const versionCache = new Map<string, string>();

// About renders one request per managed agent. Share only the in-flight manifest
// lookup so opening the page does not issue three identical requests, while a
// later About visit (or a channel switch) always gets a fresh online comparison.
let latestManifestPromise: Promise<Manifest | null> | null = null;

function getLatestManifest(): Promise<Manifest | null> {
  if (latestManifestPromise) return latestManifestPromise;
  const request = fetchManifest(8_000).catch(() => null);
  latestManifestPromise = request;
  void request.then(
    () => {
      if (latestManifestPromise === request) latestManifestPromise = null;
    },
    () => {
      if (latestManifestPromise === request) latestManifestPromise = null;
    },
  );
  return latestManifestPromise;
}

function latestVersionFor(kind: AgentBinaryKind, manifest: Manifest | null): string | null {
  if (!manifest) return null;
  if (kind === 'claude-code') return manifest.claudeCode?.version ?? null;
  if (kind === 'codex') return manifest.codexPackage?.version ?? manifest.codex?.version ?? null;
  return manifest.pi?.version ?? null;
}

function isAgentBinaryKind(value: unknown): value is AgentBinaryKind {
  return value === 'claude-code' || value === 'codex' || value === 'pi';
}

function resolveBinaryPath(kind: AgentBinaryKind): string | null {
  const ready = getReadyBinaryPath(kind);
  if (ready) return ready;
  if (kind === 'pi') return null;
  const cached = getCachedBinaryStatus(kind);
  return cached.binaryReady && cached.binaryPath ? cached.binaryPath : null;
}

function spawnVersion(binaryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      ['--version'],
      { timeout: 5000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        const out = (stdout || stderr || '').toString().trim();
        const firstLine = out.split(/\r?\n/)[0]?.trim() ?? '';
        if (!firstLine) {
          reject(new Error('empty --version output'));
          return;
        }
        resolve(firstLine);
      },
    );
  });
}

export function registerMakerBinaryVersionIpc(): void {
  log.info('registering maker:agent:binary-version IPC handler');

  ipcMain.handle(
    MAKER_INVOKE.AGENT_BINARY_VERSION,
    async (_e, agentKind: unknown): Promise<AgentBinaryVersionResult> => {
      if (!isAgentBinaryKind(agentKind)) {
        throwIpcError('INVALID_PARAMS', 'agentKind required (claude-code | codex | pi)');
      }

      // Start this before probing the local binary so the three About rows all
      // join the same in-flight online lookup even when their `--version`
      // commands finish at different times.
      const onlineManifest = getLatestManifest();
      const binaryPath = resolveBinaryPath(agentKind);
      // 执行前复核路径确为受管二进制(CodeQL js/command-line-injection 防御纵深)
      if (!binaryPath || !isVettedAgentBinaryPath(agentKind, binaryPath)) {
        const latestVersion = latestVersionFor(agentKind, await onlineManifest);
        return { kind: agentKind, binaryPath: null, version: null, latestVersion, error: 'binary_not_ready' };
      }

      const cached = versionCache.get(binaryPath);
      if (cached) {
        const latestVersion = latestVersionFor(agentKind, await onlineManifest);
        return { kind: agentKind, binaryPath, version: cached, latestVersion };
      }

      try {
        const version = await spawnVersion(binaryPath);
        versionCache.set(binaryPath, version);
        const latestVersion = latestVersionFor(agentKind, await onlineManifest);
        return { kind: agentKind, binaryPath, version, latestVersion };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`${agentKind} --version failed: ${message}`);
        const latestVersion = latestVersionFor(agentKind, await onlineManifest);
        return { kind: agentKind, binaryPath, version: null, latestVersion, error: message };
      }
    },
  );

  log.info('maker:agent:binary-version registered');
}
