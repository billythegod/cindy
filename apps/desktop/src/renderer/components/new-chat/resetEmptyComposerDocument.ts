import type { Editor } from '@tiptap/core';
import { undoDepth, redoDepth } from '@tiptap/pm/history';
import { Selection } from '@tiptap/pm/state';

/** Preserve the normal reset unless it would replace an untouched default doc. */
export function resetEmptyComposerDocument(editor: Editor, preserveReset = false): void {
  const { state } = editor;
  const empty = state.schema.topNodeType.createAndFill();
  if (!preserveReset && !editor.view.composing && empty && state.doc.eq(empty) &&
    state.selection.eq(Selection.atStart(state.doc)) && !state.storedMarks?.length &&
    undoDepth(state) === 0 && redoDepth(state) === 0) return;
  editor.commands.clearContent();
}
