import { sharedTaskHostPeer } from '@cindy/device-link';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { isSharedTaskPeer } from '@cindy/device-link';

const composer = readFileSync(resolve(__dirname, '../components/new-chat/ChatInput.tsx'), 'utf8');
const sessionView = readFileSync(
  resolve(__dirname, '../features/cc-agent/CCAgentSessionView.tsx'),
  'utf8',
);

describe('Cindy Make composer presentation', () => {
  it('opens preflight in place and only routes standalone diagnostics to their container', () => {
    expect(composer).toContain('<CindyMakePreflightDialog');
    expect(composer).toContain("makeResult.kind === 'preflight'");
    expect(composer).toContain('setMakePreflight({');
    expect(composer).toContain('else if (makeResult.sessionId !== sourceSessionId)');
  });

  it('keeps question, plan and permission prompts ahead of the first-execution input lock', () => {
    const promptHost = sessionView.indexOf('<InteractionPromptHost');
    const mask = sessionView.indexOf('<CindyMakeComposerMask');
    const input = sessionView.indexOf('<ChatInput', mask);
    expect(promptHost).toBeGreaterThan(-1);
    expect(mask).toBeGreaterThan(promptHost);
    expect(input).toBeGreaterThan(mask);
    const promptEnd = sessionView.indexOf('</InteractionPromptHost>');
    // Parse the real guard so grouping/formatting does not change the contract.
    const ast = ts.createSourceFile('session.tsx', sessionView, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let condition: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isConditionalExpression(node) && node.getStart(ast) > promptEnd && node.getStart(ast) < mask
          && node.whenTrue.kind === ts.SyntaxKind.NullKeyword
          && node.condition.getText(ast).includes('pendingGhostGrantConfirm')) {
        condition = node.condition;
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(condition).toBeDefined();
    const prompts = ['pendingPlanReview', 'pendingPermission', 'pendingAskUser', 'pendingPluginSetup',
      'pendingIssueConfirm', 'pendingRenameSessionsConfirm', 'pendingGhostGrantConfirm'];
    const hidesComposer = new Function('isSharedTaskPeer', 'remoteDeviceId', ...prompts,
      `return Boolean(${condition!.getText(ast)});`);
    for (const deviceId of [undefined, 'own-device', sharedTaskHostPeer('m', 'desktop')]) {
      expect(hidesComposer(isSharedTaskPeer, deviceId, ...prompts.map(() => false))).toBe(false);
      for (const active of prompts) {
        expect(hidesComposer(isSharedTaskPeer, deviceId, ...prompts.map((name) => name === active)),
          `${deviceId ?? 'local'}: ${active}`).toBe(deviceId !== sharedTaskHostPeer('m', 'desktop'));
      }
    }
    expect(sessionView).toContain('if (cindyMakeInputLocked) return false;');
    expect(sessionView).not.toContain('CindyMakeResumeCard');
  });

  it('keeps recovery actions inside the editable composer instead of replacing it', () => {
    const ast = ts.createSourceFile('session.tsx', sessionView, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let topSlot: ts.JsxAttribute | undefined;
    let inputLock: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
          && node.tagName.getText(ast) === 'ChatInput') {
        topSlot = node.attributes.properties.find((prop): prop is ts.JsxAttribute =>
          ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'topSlot');
      }
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'cindyMakeInputLocked') {
        inputLock = node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(topSlot).toBeDefined();
    expect(topSlot!.getText(ast)).toMatch(/cindyMakeRecoveryId\s*&&\s*session\s*\?/);
    expect(topSlot!.getText(ast)).toContain('<CindyMakeEditingActions');
    expect(topSlot!.getText(ast)).toContain('sessionId={session.id}');
    expect(topSlot!.getText(ast)).toContain('messageId={cindyMakeRecoveryId}');
    expect(inputLock).toBeDefined();
    expect(inputLock!.getText(ast)).toContain('cindyMakeComposerPhase || cindyMakePendingTest');
    expect(inputLock!.getText(ast)).not.toContain('cindyMakeRecoveryId');
  });
});
