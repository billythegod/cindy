import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { shouldArmComposerVoiceHold } from '@/session/composerVoiceHold';
import type { MobileVoiceState } from '@/session/mobileVoiceInput';

// Execute the production page callbacks, as in composerAudioCleanup.test.ts,
// without mounting the pages' unrelated remote services and native controls.
function readCallbacks(page: string) {
  const source = ts.createSourceFile(page,
    readFileSync(resolve(process.cwd(), 'app/sessions', page), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer
      && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(source) === 'useCallback') {
      callbacks.set(node.name.getText(source), node.initializer.arguments[0].getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return (bindings: Record<string, unknown>) => {
    const names = ['handleVoiceButtonPressIn', 'setVoiceState'];
    const compiled = ts.transpileModule(
      `return { ${names.map((name) => {
        if (!callbacks.has(name)) throw new Error(`Missing ${page} callback: ${name}`);
        return `${name}: ${callbacks.get(name)}`;
      }).join(',')} };`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as {
      handleVoiceButtonPressIn(): void;
      setVoiceState(state: MobileVoiceState): void;
    };
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function settleCallbacks() {
  // startVoiceRecording -> catch -> finally, without introducing a timer.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe.each(['new.tsx', '[sessionId].tsx'])('%s voice startup feedback', (page) => {
  const callbacks = readCallbacks(page);
  function setup() {
    let pending = false;
    let state: MobileVoiceState = 'idle';
    let startup = deferred();
    const recording = { current: false };
    const pendingSeq = { current: 0 };
    const run = callbacks({
      creating: false, voiceIsProcessing: false, voiceState: 'idle',
      selectedDeviceId: 'host', deviceId: 'host',
      isMobileRealtimeAudioAvailable: () => true,
      prewarmMobileRealtimeAudio: vi.fn(), prewarmMobileVoiceStart: vi.fn(),
      auth: { apiFetch: vi.fn() },
      voiceStartedOnPressInRef: { current: false },
      voiceRecordingActiveRef: recording,
      voiceStartupInFlightRef: { current: false }, voiceStopInFlightRef: { current: false },
      voiceStartPendingSeqRef: pendingSeq,
      setVoiceStartPending: (value: boolean) => { pending = value; },
      startVoiceRecording: () => startup.promise,
      voiceStateTransitionRef: { current: 'idle' },
      shouldArmComposerVoiceHold, setComposerVoiceHoldArmed: vi.fn(),
      setVoiceStateInternal: (value: MobileVoiceState) => { state = value; },
    });
    return {
      press: run.handleVoiceButtonPressIn, state: run.setVoiceState, recording,
      startup: () => startup,
      nextStartup: () => { startup = deferred(); },
      view: () => ({ expanded: pending || state === 'listening', counting: state === 'listening', pending }),
    };
  }

  it.each([false, true])('stays expanded across startup and first PCM (PCM first=%s)', async (pcmFirst) => {
    const run = setup();
    run.press();
    expect(run.view()).toEqual({ expanded: true, counting: false, pending: true });
    run.recording.current = true;
    if (pcmFirst) run.state('listening');
    run.startup().resolve();
    await settleCallbacks();
    expect(run.view().expanded).toBe(true);
    expect(run.view().counting).toBe(pcmFirst);
    run.state('listening');
    expect(run.view()).toEqual({ expanded: true, counting: true, pending: false });
  });

  it.each(['idle', 'error', 'submitting', 'done'] as const)(
    'clears startup feedback on %s before the first PCM', async (state) => {
      const run = setup();
      run.press();
      run.recording.current = true;
      run.startup().resolve();
      await settleCallbacks();
      run.state(state);
      expect(run.view()).toEqual({ expanded: false, counting: false, pending: false });
    },
  );

  it.each([false, true])('clears feedback if startup creates no recording (reject=%s)', async (reject) => {
    const run = setup();
    run.press();
    if (reject) run.startup().reject(new Error('permission/startup failed'));
    else run.startup().resolve(); // permission cancelled or unavailable
    await settleCallbacks();
    expect(run.view()).toEqual({ expanded: false, counting: false, pending: false });
  });

  it('does not let an old startup completion collapse a new pending press', async () => {
    const run = setup();
    run.press();
    const oldStartup = run.startup();
    run.state('idle');
    run.nextStartup();
    run.press();
    oldStartup.resolve();
    await settleCallbacks();
    expect(run.view()).toEqual({ expanded: true, counting: false, pending: true });
    run.startup().resolve();
    await settleCallbacks();
    expect(run.view().expanded).toBe(false);
  });
});
