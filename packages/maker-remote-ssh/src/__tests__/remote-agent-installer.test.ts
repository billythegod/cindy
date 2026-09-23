import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

import { BOOTSTRAP_SH } from '../bootstrap/bootstrap-script.js';
import {
  installRemoteAgent,
  PINNED_CLAUDE_CODE_VERSION,
  PINNED_CODEX_RELEASE_VERSION,
  PINNED_PI_VERSION,
  probeRemoteAgent,
  uninstallRemoteAgent,
} from '../bootstrap/installer.js';
import type { RemoteHost } from '../RemoteHost.js';

describe('remote agent installer', () => {
  it('passes the pinned Codex release to the remote bootstrap script', async () => {
    const calls: Array<{ command: string; input: string }> = [];
    const host = {
      exec: async (command: string, opts: { input?: string }) => {
        calls.push({ command, input: opts.input ?? '' });
        return {
          exitCode: 0,
          stdout: [
            'PROBE_START',
            'INSTALL_DIR /home/u/.xdt-server/v1',
            `READY ${PINNED_CODEX_RELEASE_VERSION}`,
          ].join('\n'),
          stderr: '',
        };
      },
    } as Pick<RemoteHost, 'exec'> as RemoteHost;

    const result = await installRemoteAgent(host, 'codex');

    expect(result.ready).toBe(true);
    expect(result.installedVersion).toBe(PINNED_CODEX_RELEASE_VERSION);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toContain(`'${PINNED_CODEX_RELEASE_VERSION}'`);
    expect(calls[0].input).toBe(BOOTSTRAP_SH);
  });

  it('runs install.sh with --release when a Codex release arg is present', () => {
    expect(BOOTSTRAP_SH).toContain('INSTALLER_URL="https://github.com/openai/codex/releases/download/rust-v$CODEX_RELEASE/install.sh"');
    expect(BOOTSTRAP_SH).toContain('sh "$INSTALLER_TMP" --release "$CODEX_RELEASE"');
  });

  it('pins Claude Code for probe and install, and rejects a stale sentinel version', async () => {
    const calls: Array<{ command: string; input: string }> = [];
    const host = {
      exec: async (command: string, opts: { input?: string }) => {
        calls.push({ command, input: opts.input ?? '' });
        return {
          exitCode: 0,
          stdout: [
            'INSTALL_DIR /home/u/.xdt-server/v1',
            'NOT_INSTALLED',
          ].join('\n'),
          stderr: '',
        };
      },
    } as Pick<RemoteHost, 'exec'> as RemoteHost;

    const probe = await probeRemoteAgent(host, 'claude-code');
    expect(probe.installed).toBe(false);
    expect(calls[0].command).toContain(`'${PINNED_CLAUDE_CODE_VERSION}'`);
    expect(calls[0].input).toContain(
      '[ "${V%% *}" = "$CLAUDE_RELEASE" ]',
    );

    await installRemoteAgent(host, 'claude-code');
    expect(calls[1].command).toContain(`'${PINNED_CLAUDE_CODE_VERSION}'`);
    expect(calls[1].input).toContain(
      'NPM_PKG="@anthropic-ai/claude-code@$CLAUDE_RELEASE"',
    );
    expect(calls[1].input).toContain(
      'Claude Code version ${V%% *} != managed pin $CLAUDE_RELEASE',
    );
  });

  it('probes pi binary presence + version match', async () => {
    const calls: Array<{ command: string; input: string }> = [];
    const host = {
      exec: async (command: string, opts: { input?: string }) => {
        calls.push({ command, input: opts.input ?? '' });
        return {
          exitCode: 0,
          stdout: [
            'INSTALL_DIR /home/u/.xdt-server/v1',
            `READY ${PINNED_PI_VERSION}`,
          ].join('\n'),
          stderr: '',
        };
      },
    } as Pick<RemoteHost, 'exec'> as RemoteHost;

    const probe = await probeRemoteAgent(host, 'pi');
    expect(probe.installed).toBe(true);
    expect(probe.installedVersion).toBe(PINNED_PI_VERSION);
    expect(probe.binaryPath).toBe('/home/u/.xdt-server/v1/pi/pi');
    expect(calls[0].command).toContain(`'${PINNED_PI_VERSION}'`);
  });

  it('pi install passes the 4 POSIX SHA256 args and binary layout', async () => {
    const calls: Array<{ command: string; input: string }> = [];
    const host = {
      exec: async (command: string, opts: { input?: string }) => {
        calls.push({ command, input: opts.input ?? '' });
        return {
          exitCode: 0,
          stdout: [
            'INSTALL_DIR /home/u/.xdt-server/v1',
            'INSTALL_START pi',
            'INSTALL_LOG sha256 ok',
            'INSTALL_DONE',
            `READY ${PINNED_PI_VERSION}`,
          ].join('\n'),
          stderr: '',
        };
      },
    } as Pick<RemoteHost, 'exec'> as RemoteHost;

    const result = await installRemoteAgent(host, 'pi');
    expect(result.ready).toBe(true);
    expect(result.installedVersion).toBe(PINNED_PI_VERSION);
    expect(result.binaryPath).toBe('/home/u/.xdt-server/v1/pi/pi');
    // 4 个 POSIX 平台 SHA256(darwin-arm64 / darwin-x64 / linux-arm64 / linux-x64)。
    expect(calls[0].command).toContain(`'${PINNED_PI_VERSION}'`);
    // 精确数量断言:4 个平台 SHA256 缺一个/多一个都该失败(R7 测试覆盖审计)。
    expect(calls[0].command.match(/'[0-9a-f]{64}'/g)?.length).toBe(4);
    // 安装脚本:tar.gz 下载 + sha256 校验 + 先解到临时目录再原子替换(解压失败不毁旧)。
    expect(calls[0].input).toContain('pi-${OS_TAG}-${ARCH_TAG}.tar.gz');
    expect(calls[0].input).toContain('shasum -a 256 -c -');
    expect(calls[0].input).toContain('tar xzf "$TMP/pi.tgz" -C "$TMP/extract"');
    expect(calls[0].input).toContain('mv "$TMP/extract/pi" "$INSTALL_DIR/pi"');
  });

  it('pi uninstall kills pi-manager daemon (pidfile) then removes dirs', async () => {
    const calls: Array<{ command: string; label?: string }> = [];
    const host = {
      exec: async (command: string, opts?: { label?: string }) => {
        calls.push({ command, label: opts?.label });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    } as Pick<RemoteHost, 'exec'> as RemoteHost;

    await uninstallRemoteAgent(host, 'pi');

    // Exactly 2 calls: killDaemons first, then rm -rf (轮 10 M-2 —— 多余 exec
    // 调用会破坏精确的 2 步契约)。
    expect(calls.length).toBe(2);

    // Call 1: killDaemons — pi-manager pidfile kill with identity verification
    const killCmd = calls[0].command;
    expect(killCmd).toContain('pi-manager/pi-manager.pid');
    expect(killCmd).toContain('kill -0 "$PID"');
    // 轮 42 P2:身份验证升级为进程名 + 本 install 的 --socket 双匹配(防 stale
    // pidfile 复用成别的 install root 的 daemon 时误杀)。
    expect(killCmd).toContain('grep -F -- "pi-manager.mjs"');
    expect(killCmd).toContain('grep -F -- "--socket');
    expect(killCmd).toContain('kill "$PID"');
    // error isolation: killDaemons failures must not block rm
    expect(killCmd).toContain('|| true');
    // 等待循环:kill 后最多 3s 等 daemon 退出, 防 rm 与 shutdown 竞态(轮 10 M-1)
    expect(killCmd).toContain('seq 1 15');
    // 轮 18-T4:循环用 break 而非 exit —— 原 `exit 0` 在 daemon 正常退出时
    // 直接退出整个 bash 脚本, rm -rf 被跳过, 卸载残留目录/凭证文件。
    expect(killCmd).toContain('kill -0 "$PID" 2>/dev/null || break');
    // 等待循环内不再有把整个脚本截断的 exit(轮 18-T4 —— 保持 2 步 exec 契约)。
    expect(killCmd).not.toContain('|| { echo KILLED; exit 0; }');
    // 轮 18-T4:SIGTERM 3s 未退出 → 补 SIGKILL 升级序列
    expect(killCmd).toContain('kill -9 "$PID"');
    expect(killCmd).toContain('WARN: pi-manager daemon (PID $PID) still alive after SIGKILL');
    // socket-only sweep 不得匹配 grep / 本 bash -c(否则误杀卸载脚本自己)。
    expect(killCmd).toContain('grep -v -F "grep"');
    expect(killCmd).toContain('[ "$ORPHAN" = "$$" ] && continue');
    // python daemon 已退役:不再有 pi-daemon.py kill 路径
    expect(killCmd).not.toContain('pi-daemon.py kill');

    // Call 2: rm — must remove pi/, pi-manager/, pi-daemon/ (旧 host 残留,
    // 退役审轮 8 LOW-2), pi-oneshot/, .installed-pi
    const rmCmd = calls[1].command;
    expect(rmCmd).toContain('rm -rf');
    expect(rmCmd).toContain('/pi ');
    expect(rmCmd).toContain('/pi-manager ');
    expect(rmCmd).toContain('/pi-daemon');
    expect(rmCmd).toContain('/pi-oneshot');
    expect(rmCmd).toContain('.installed-pi');
  });

  it('pi uninstall killDaemons runs BEFORE rm (kill depends on daemon process)', async () => {
    // Verify call ordering: killDaemons (label='uninstall-pi-kill-daemons')
    // comes before rm (label='uninstall-pi'). If rm ran first, the pidfile
    // would be deleted and the kill command would fail silently.
    const labels: string[] = [];
    const host = {
      exec: async (_command: string, opts?: { label?: string }) => {
        labels.push(opts?.label ?? '');
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    } as Pick<RemoteHost, 'exec'> as RemoteHost;

    await uninstallRemoteAgent(host, 'pi');

    const killIdx = labels.findIndex((l) => l === 'uninstall-pi-kill-daemons');
    const rmIdx = labels.findIndex((l) => l === 'uninstall-pi');
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    expect(killIdx).toBeLessThan(rmIdx); // kill before rm
  });

  it('pi uninstall kill patterns survive a $HOME containing spaces', async () => {
    // 回归:grep 模式串曾靠嵌双引号拼接(`grep -F -- "--socket "$HOME/..."`),
    // 引号在模式中间截断 → $HOME 裸奔。家目录含空格时模式被词切分,grep 把
    // 第二段当文件操作数,身份匹配静默失效(exit 2)→ daemon 杀不掉但 rm -rf
    // 照跑,卸载后残留带凭证的活 daemon(对比 cc-manager-installer 对空格
    // $HOME 的同类防御)。修复后路径一律先 VAR="..." 赋值再在双引号内 $VAR
    // 展开,任何 $HOME 都是一个 word。
    const calls: Array<{ command: string; label?: string }> = [];
    const host = {
      exec: async (command: string, opts?: { label?: string }) => {
        calls.push({ command, label: opts?.label });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    } as Pick<RemoteHost, 'exec'> as RemoteHost;

    await uninstallRemoteAgent(host, 'pi');
    const killCmd = calls[0].command;

    // 模式串通过 shell 变量在双引号内展开,不依赖嵌引号拼接
    expect(killCmd).toContain('MGR_SOCK="$INST_DIR/pi-manager/pi-manager.sock"');
    expect(killCmd).toContain('grep -F -- "--socket $MGR_SOCK"');
    expect(killCmd).toContain('grep -aq -- "--socket $MGR_SOCK"');
    expect(killCmd).toContain('grep -F -- "pi-manager.mjs daemon --socket $MGR_SOCK"');
    // 旧的破损形态:引号在模式中间截断(模式串里出现 `"--socket "` 后紧跟裸 $HOME)
    expect(killCmd).not.toContain('--socket "$HOME');
    expect(killCmd).not.toContain('socket "$INST_DIR');

    // 行为验证:① 空格 $HOME 下整段 kill 脚本可执行(pidfile/socket 均不存在 →
    // 两个分支都是 no-op);② 双引号内 $VAR 展开的 grep 模式保持单 word。
    const payload = killCmd.replace(/^bash -c /, '');
    execFileSync('bash', ['-c', `eval ${payload}`], {
      env: { ...process.env, HOME: '/tmp/cindy home test' },
      stdio: 'ignore',
    });
    const probe = execFileSync('bash', [
      '-c',
      'MGR_SOCK="$HOME/.xdt-server/v1/pi-manager/pi-manager.sock"; '
        + 'set -- "--socket $MGR_SOCK"; printf \'%s\\n\' "$#" "$1"',
    ], {
      env: { ...process.env, HOME: '/tmp/cindy home test' },
      encoding: 'utf8',
    }).trim();
    // set -- 之后 argv = ["--socket", "/tmp/cindy home test/.../pi-manager.sock"]
    // → $# 必须是 1 且 $1 含完整带空格路径;词切分会让 $# > 1。
    const [argc, ...rest] = probe.split('\n');
    expect(argc).toBe('1');
    expect(rest.join('\n')).toBe('--socket /tmp/cindy home test/.xdt-server/v1/pi-manager/pi-manager.sock');
  });
});
