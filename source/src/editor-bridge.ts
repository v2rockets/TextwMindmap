import { EditorView } from '@codemirror/view';
import { bounds, type Item } from './model/document';
import { useApp } from './store';
let view: EditorView | null = null;
export const registerEditor = (next: EditorView | null) => { view = next; };
export function selectEditor(id: string) {
  const s = useApp.getState(), item = s.doc.items.find(n => n.id === id); if (!view || !item) return;
  const r = bounds(s.doc, item, s.mode === 'subtree'); view.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { y: 'nearest' }) });
}
export function editorView() { return view; }
