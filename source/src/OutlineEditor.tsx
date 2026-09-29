import { useEffect, useRef } from 'react';
import { EditorState, Prec, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { bounds, columns, document as makeDocument, indent, type Doc } from './model/document';
import { fromClipboard, clipboardHTML, markdownText } from './model/clipboard';
import { copyEvent, pasteEvent } from './clipboard-events';
import { registerEditor } from './editor-bridge';

import { active, caret, commit, createNode, deleteSelection, history, pasteTree, release, select, useApp, TREE_MIME } from './store';
export const refresh = StateEffect.define<null>();
let editor: EditorView | null = null;
let syncing = false;
export function focusOutline() { editor?.focus(); }
class Bullet extends WidgetType {
  constructor(readonly id: string) { super(); }
  eq(other: Bullet) { return this.id === other.id; }
  toDOM() {
    const button = document.createElement('button'); button.className = 'outline-bullet'; button.textContent = '•'; button.tabIndex = -1;
    button.setAttribute('aria-label', 'Select node or subtree'); button.dataset.node = this.id;
    button.onmousedown = e => e.preventDefault();
    button.onclick = e => { e.preventDefault(); select(this.id); editor?.focus(); };
    return button;
  }
  ignoreEvent() { return true; }
}
function decorations(view: EditorView): DecorationSet {
  const s = useApp.getState(), selected = active(), ranges: ReturnType<Decoration['range']>[] = [];
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number), item = s.doc.items.find(n => n.line === number - 1), col = columns(line.text);
    const single = s.mode === 'single-node' && item?.id === selected?.id;
    const branch = s.mode === 'subtree' && selected && number - 1 >= selected.line && number - 1 < selected.end;
    ranges.push(Decoration.line({ attributes: { class: `${item ? 'outline-node' : 'annotation'} ${branch ? 'subtree-line' : single ? 'single-line' : ''}`, style: `padding-left:calc(${col + 2}ch + 12px);text-indent:-${col + 2}ch` } }).range(line.from));
    // One fixed-width widget per real logical node; no document bullet character.
    if (item) ranges.push(Decoration.widget({ widget: new Bullet(item.id), side: 1 }).range(line.from + indent(line.text).length));
  }
  return Decoration.set(ranges, true);
}
const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorations(view); }
  update(v: ViewUpdate) { this.decorations = decorations(v.view); }
}, { decorations: v => v.decorations });
function split(view: EditorView) {
  const s = useApp.getState();
  if (s.mode !== 'text-edit' && active()) { createNode(false); return true; }
  const sel = view.state.selection.main, line = view.state.doc.lineAt(sel.from);
  const prefix = indent(line.text);
  const addition = '\n' + prefix + (line.text.trimStart().startsWith('=>') ? '=>' : '');
  view.dispatch(view.state.replaceSelection(addition)); return true;
}
function tab(view: EditorView, out = false) {
  const range = view.state.selection.main, start = view.state.doc.lineAt(range.from).number;
  const end = view.state.doc.lineAt(Math.max(range.from, range.to - (range.empty ? 0 : 1))).number;
  const changes = [];
  for (let i = start; i <= end; i++) {
    const l = view.state.doc.line(i), prefix = indent(l.text);
    changes.push(out ? { from: l.from, to: l.from + (prefix.startsWith('\t') ? 1 : Math.min(4, prefix.length)), insert: '' } : { from: l.from, insert: '\t' });
  }
  view.dispatch({ changes }); return true;
}
export function OutlineEditor() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let localSync = false;
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: useApp.getState().doc.text, extensions: [
      EditorState.tabSize.of(4), EditorView.lineWrapping, plugin,
      EditorView.contentAttributes.of({ 'aria-label': 'Text outline', spellcheck: 'false' }),
      Prec.highest(keymap.of([
        { key: 'Mod-z', run: () => { history(); return true; } }, { key: 'Mod-Shift-z', run: () => { history(true); return true; } },
        { key: 'Mod-y', run: () => { history(true); return true; } }, { key: 'Mod-Shift-l', run: () => { release(); return true; } },
        { key: 'Enter', run: v => { if (v.composing) return false; if (useApp.getState().mode !== 'text-edit' && active()) { createNode(true); return true; } return split(v); } },
        { key: 'Shift-Enter', run: v => { if (v.composing) return false; if (useApp.getState().mode !== 'text-edit' && active()) { createNode(false); return true; } return split(v); } },
        { key: 'Tab', run: v => tab(v) }, { key: 'Shift-Tab', run: v => tab(v, true) },
        ...['Delete', 'Backspace'].map(key => ({ key, run: () => { if (useApp.getState().mode === 'text-edit') return false; deleteSelection(); return true; } }))
      ])), keymap.of(defaultKeymap),
      EditorView.domEventHandlers({
        mousedown(e, v) { if (!(e.target as Element).closest('.outline-bullet')) { const p = v.posAtCoords({ x: e.clientX, y: e.clientY }); if (p != null) { const line = v.state.doc.lineAt(p).number - 1; caret(useApp.getState().doc.items.find(n => n.line === line)?.id ?? null); } } return false; },
        keydown(e) { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) caret(useApp.getState().doc.selected); return false; },
        copy(e, v) { if (useApp.getState().mode !== 'text-edit') return copyEvent(e); const sel = v.state.selection.main; if (sel.empty || !e.clipboardData) return false; const text = v.state.sliceDoc(sel.from, sel.to); e.clipboardData.setData('text/plain', markdownText(text).replace(/\n/g, '\r\n')); e.clipboardData.setData('text/html', clipboardHTML(text)); e.preventDefault(); return true; },
        cut(e, v) {
          const s = useApp.getState(), n = active();
          if (s.mode === 'single-node' && n) {
            // Use a text transaction so the caret stays at the emptied label,
            // ready for typing or pasting back. Only delete after copying succeeds.
            if (!copyEvent(e)) return false;
            const r = bounds(s.doc, n, false);
            const from = r.from + indent(s.doc.text.split('\n')[n.line]).length;
            v.dispatch({ changes: { from, to: r.to, insert: '' }, selection: { anchor: from }, userEvent: 'delete.cut' });
            return true;
          }
          if (s.mode === 'subtree') return copyEvent(e, true);
          return false;
        },
        paste(e, v) {
          if (useApp.getState().mode !== 'text-edit') return pasteEvent(e);
          if (!e.clipboardData) return false;
          const text = fromClipboard(e.clipboardData.getData('text/plain'), e.clipboardData.getData('text/html'));
          e.preventDefault(); v.dispatch(v.state.replaceSelection(text)); return true;
        },
        beforeinput(e, v) {
          // Structural selection replacement must preserve the root's indentation.
          const s = useApp.getState();
          if (s.mode === 'subtree' && e.inputType === 'insertText' && e.data && !e.isComposing) {
            e.preventDefault(); const n = active()!; const r = bounds(s.doc, n), prefix = indent(s.doc.text.split('\n')[n.line]);
            v.dispatch({ changes: { from: r.from, to: r.to, insert: prefix + e.data + (r.to < s.doc.text.length ? '\n' : '') }, selection: { anchor: r.from + prefix.length + e.data.length } }); return true;
          }
          return false;
        }
      }),
      EditorView.updateListener.of(update => {
        if (localSync || syncing) return;
        if (update.docChanged) {
          const old = useApp.getState().doc, ids = new Map<number, string>();
          old.items.forEach(n => {
            const l = update.startState.doc.line(n.line + 1);
            let deleted = false;
            update.changes.iterChangedRanges((a, b, c, d) => { if (a <= l.from && b > l.to && c === d) deleted = true; });
            if (!deleted) { const mapped = update.changes.mapPos(l.from, 1); const line = update.state.doc.lineAt(mapped).number - 1; if (!ids.has(line)) ids.set(line, n.id); }
          });
          const next = makeDocument(update.state.doc.toString(), old, ids);
          const line = update.state.doc.lineAt(update.state.selection.main.head).number - 1;
          next.selected = next.items.find(n => n.line === line)?.id ?? null;
          const cut = update.transactions.some(t => t.isUserEvent('delete.cut'));
          localSync = true; commit(next, 'text-edit', cut ? 'cut-text' : 'typing'); localSync = false;
        } else if (update.selectionSet) {
          const line = update.state.doc.lineAt(update.state.selection.main.head).number - 1;
          localSync = true; caret(useApp.getState().doc.items.find(n => n.line === line)?.id ?? null); localSync = false;
        }
      })
    ] }) });
    editor = view;
    registerEditor(view);
    const unsubscribe = useApp.subscribe((s, old) => {
      if (localSync) return;
      const changed = s.doc.text !== view.state.doc.toString();
      if (!changed && s.selectionVersion === old.selectionVersion && s.mode === old.mode && s.doc.selected === old.doc.selected) return;
      syncing = true;
      if (changed) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s.doc.text } });
      const n = active();
      if (n && s.mode !== 'text-edit') {
        const r = bounds(s.doc, n, s.mode === 'subtree');
        const prefix = indent(s.doc.text.split('\n')[n.line]).length;
        view.dispatch({ selection: { anchor: r.from + (s.mode === 'single-node' ? prefix : 0), head: r.to }, effects: [refresh.of(null), EditorView.scrollIntoView(r.from, { y: 'nearest' })] });
      } else view.dispatch({ effects: refresh.of(null) });
      syncing = false;
    });
    return () => { unsubscribe(); registerEditor(null); editor = null; view.destroy(); };
  }, []);
  return <div ref={host} className="outline-editor" />;
}
