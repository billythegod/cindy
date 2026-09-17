// @vitest-environment jsdom
import { Editor, Mark } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import History from '@tiptap/extension-history';
import { undoDepth, redoDepth } from '@tiptap/pm/history';
import { AllSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEmptyComposerDocument } from '../components/new-chat/resetEmptyComposerDocument';

const TestMark = Mark.create({ name: 'testMark', renderHTML: () => ['strong', 0] });
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function create(content = '<p></p>') {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, History, TestMark], content, parseOptions: { preserveWhitespace: 'full' } });
  editors.push(editor);
  return editor;
}
describe('empty composer task switch', () => {
  it('does not emit a replacement transaction for an untouched empty editor', () => {
    const editor = create();
    const transaction = vi.fn(); editor.on('transaction', transaction);
    resetEmptyComposerDocument(editor);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['<p>text</p>', '<p> </p>', '<p></p><p></p>'])('resets noncanonical content %s', (content) => {
    const editor = create(content);
    const transaction = vi.fn(); editor.on('transaction', transaction);
    resetEmptyComposerDocument(editor);
    expect(transaction).toHaveBeenCalled();
    expect(editor.state.doc.eq(editor.schema.topNodeType.createAndFill()!)).toBe(true);
  });
  it.each(['undo', 'redo'] as const)('retains the reset when %s history exists', (kind) => {
    const editor = create();
    editor.commands.insertContent('text');
    if (kind === 'redo') editor.commands.undo();
    else editor.commands.clearContent();
    expect((kind === 'undo' ? undoDepth : redoDepth)(editor.state)).toBeGreaterThan(0);
    expect(editor.state.doc.textContent).toBe('');
    const transaction = vi.fn(); editor.on('transaction', transaction);
    resetEmptyComposerDocument(editor);
    expect(transaction).toHaveBeenCalled();
  });
  it.each(['selection', 'marks', 'composing'])('retains the reset for %s state', (kind) => {
    const editor = create();
    if (kind === 'selection') editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    if (kind === 'marks') editor.view.dispatch(editor.state.tr.addStoredMark(editor.schema.marks.testMark.create()));
    if (kind === 'composing') vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true);
    const transaction = vi.fn(); editor.on('transaction', transaction);
    resetEmptyComposerDocument(editor);
    expect(transaction).toHaveBeenCalled();
  });
  it('retains the reset for voice and other explicit transition state', () => {
    const editor = create();
    const transaction = vi.fn(); editor.on('transaction', transaction);
    resetEmptyComposerDocument(editor, true);
    expect(transaction).toHaveBeenCalled();
  });
});
