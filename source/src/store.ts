import { create } from 'zustand';
import { append, bounds, document as makeDocument, extract, remove, rename, replaceTree, subtree, type Doc, type Item, type Point } from './model/document';
import { simulation, type Sizes } from './model/layout';
export const example = `TextwMindmap
	! Start here
		Enter: sibling · Shift+Enter: child
	Selection
		Click once: focus the outline
		Click twice: select the subtree
	$ Navigate
		Drag background to pan · wheel to zoom
	? Edit
		Type to edit the selected node
		Select a subtree first, then Ctrl+X / Ctrl+V to move it
	% Layout
		Drag a branch to lock its root
		Use ! % $ ? to define node colors`;
export type Mode = 'single-node' | 'subtree' | 'text-edit';
type Snapshot = { doc: Doc; mode: Mode };
type State = Snapshot & { undo: Snapshot[]; redo: Snapshot[]; sizes: Sizes; dragging: boolean; running: boolean; editId: string | null; selectionVersion: number; status: string; focus: 'map' | 'outline'; divider: number; viewport: { x: number; y: number; zoom: number } };
const SESSION_KEY = 'textwmindmap:last-session:v1';
function restored() {
  try {
    const raw = localStorage.getItem(SESSION_KEY); if (!raw) return { doc: makeDocument(example), viewport: { x: 0, y: 0, zoom: 1 } };
    const data = JSON.parse(raw); if (data?.version !== 1 || typeof data.text !== 'string' || !data.text.trim() || !Array.isArray(data.nodes) || !data.nodes.length) throw Error('empty session');
    const doc = makeDocument(data.text);
    for (const node of doc.items) {
      const saved = data.nodes.find((v: { line: number }) => v.line === node.line);
      if (saved?.position && Number.isFinite(saved.position.x) && Number.isFinite(saved.position.y)) doc.positions[node.id] = saved.position;
      if (saved) doc.locked[node.id] = !!saved.locked;
    }
    doc.selected = doc.items.find(n => n.line === data.selectedLine)?.id ?? doc.items[0]?.id ?? null;
    const viewport = data.viewport && Number.isFinite(data.viewport.zoom) ? data.viewport : { x: 0, y: 0, zoom: 1 };
    return { doc, viewport };
  } catch { return { doc: makeDocument(example), viewport: { x: 0, y: 0, zoom: 1 } }; }
}
const initial = restored();
export const useApp = create<State>(() => ({ doc: initial.doc, mode: 'text-edit', focus: 'outline', divider: 38, viewport: initial.viewport, undo: [], redo: [], sizes: {}, dragging: false, running: false, editId: null, selectionVersion: 0, status: 'Ready · restored the last map' }));
export const SESSION_STORAGE_KEY = SESSION_KEY;
let frame = 0, typingAt = 0;
let scope: Set<string> | undefined;
const snapshot = (): Snapshot => ({ doc: structuredClone(useApp.getState().doc), mode: useApp.getState().mode });
export const active = () => { const d = useApp.getState().doc; return d.items.find(n => n.id === d.selected); };
export function stopLayout() { cancelAnimationFrame(frame); useApp.setState({ running: false }); }
export function relax(allowed?: Set<string>) {
  stopLayout(); scope = allowed;
  const s = useApp.getState(); if (s.dragging || s.editId || !s.doc.items.length) return;
  const sim = simulation(s.doc, s.sizes, allowed);
  useApp.setState({ running: true });
  function tick() {
    let step = sim.tick(); for (let i = 0; i < 2 && !step.done; i++) step = sim.tick();
    useApp.setState(s => ({ doc: { ...s.doc, positions: step.positions } }));
    if (step.done) useApp.setState({ running: false }); else frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}
export function measured(id: string, width: number, height: number) {
  const s = useApp.getState(), old = s.sizes[id];
  if (old && Math.abs(old.width - width) < .5 && Math.abs(old.height - height) < .5) return;
  useApp.setState({ sizes: { ...s.sizes, [id]: { width, height } } });
}
export function commit(doc: Doc, mode: Mode = useApp.getState().mode, kind = 'command', layout = true) {
  stopLayout(); const s = useApp.getState(), now = Date.now();
  const coalesce = kind === 'typing' && now - typingAt < 650 && s.mode === 'text-edit';
  typingAt = kind === 'typing' ? now : 0;
  useApp.setState({ doc, mode, undo: coalesce ? s.undo : [...s.undo, snapshot()], redo: [], editId: null, selectionVersion: s.selectionVersion + (kind === 'typing' ? 0 : 1) });
  if (layout) relax();
}
export function history(redo = false) {
  stopLayout(); typingAt = 0; const s = useApp.getState();
  const stack = redo ? s.redo : s.undo, next = stack.at(-1); if (!next) return;
  useApp.setState({ ...structuredClone(next), undo: redo ? [...s.undo, snapshot()] : s.undo.slice(0, -1), redo: redo ? s.redo.slice(0, -1) : [...s.redo, snapshot()], editId: null, selectionVersion: s.selectionVersion + 1 });
}
export function select(id: string, toggle = true) {
  const s = useApp.getState(); typingAt = 0;
  const mode: Mode = toggle && s.doc.selected === id && s.mode === 'single-node' ? 'subtree' : 'single-node';
  useApp.setState({ doc: { ...s.doc, selected: id }, mode, focus: 'outline', editId: null, selectionVersion: s.selectionVersion + 1 });
}
export function caret(id: string | null) {
  const s = useApp.getState(); useApp.setState({ doc: { ...s.doc, selected: id }, mode: 'text-edit', focus: 'outline' });
}
export function createNode(sibling: boolean, fromMap = false) {
  const s = useApp.getState(), next = append(s.doc, active(), 'New node', sibling);
  commit(next, 'single-node');
  if (fromMap) useApp.setState({ focus: 'outline' });
}
export function startEdit(id: string) { stopLayout(); useApp.setState(s => ({ editId: id, doc: { ...s.doc, selected: id }, mode: 'text-edit' })); }
export function finishEdit(value: string, cancel = false) {
  const s = useApp.getState(), n = s.doc.items.find(n => n.id === s.editId);
  if (n && !cancel && value.trim() && value !== n.label) commit(rename(s.doc, n, value), 'single-node');
  useApp.setState({ editId: null });
}
export function replaceSelection(value: string) {
  const s = useApp.getState(), n = active(); if (!n) { commit(makeDocument(value), 'single-node'); return; }
  commit(s.mode === 'subtree' ? replaceTree(s.doc, n, value) : rename(s.doc, n, value), 'single-node');
}
export function deleteSelection() {
  const s = useApp.getState(), n = active(); if (!n) return;
  commit(remove(s.doc, n), 'single-node');
}
/** Cut only the selected node's visible label. Descendants remain in the document. */
export function cutNodeText() {
  const s = useApp.getState(), n = active();
  if (!n) return;
  commit(rename(s.doc, n, ''), 'single-node', 'cut-text');
}
export function release(all = false) {
  const s = useApp.getState(), n = active();
  const ids = new Set((all || !n ? s.doc.items : subtree(s.doc, n)).map(n => n.id));
  const doc = structuredClone(s.doc); ids.forEach(id => doc.locked[id] = false);
  commit(doc, s.mode, 'release', false); relax(all ? undefined : ids);
}
let drag: { before: Snapshot; start: Point; startScreen: Point; zoom: number; ids: string[]; moved: boolean } | null = null;
export function beginDrag(id: string, screen?: Point) {
  stopLayout(); typingAt = 0; const s = useApp.getState(), n = s.doc.items.find(n => n.id === id); if (!n) return;
  const before = snapshot();
  drag = { before, start: { ...before.doc.positions[id] }, startScreen: screen ?? { x: 0, y: 0 }, zoom: s.viewport.zoom, ids: subtree(before.doc, n).map(item => item.id), moved: false };
  useApp.setState({ dragging: true });
}
export function moveDrag(position: Point) {
  if (!drag) return;
  const dx = position.x - drag.start.x, dy = position.y - drag.start.y;
  drag.moved ||= Math.hypot(dx, dy) > .5;
  const positions = structuredClone(drag.before.doc.positions);
  drag.ids.forEach(id => { positions[id].x += dx; positions[id].y += dy; });
  useApp.setState(s => ({ doc: { ...s.doc, positions } }));
}
export function moveDragScreen(screen: Point) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < 4) return;
  moveDrag({ x: drag.start.x + (screen.x - drag.startScreen.x) / Math.max(.1, drag.zoom), y: drag.start.y + (screen.y - drag.startScreen.y) / Math.max(.1, drag.zoom) });
}
export function endDrag(cancel = false): { id: string; moved: boolean } | null {
  if (!drag) return null;
  const d = drag; drag = null; const s = useApp.getState();
  if (cancel) { useApp.setState({ ...d.before, dragging: false }); return { id: d.ids[0], moved: false }; }
  else if (d.moved) {
    useApp.setState({ doc: { ...s.doc, locked: { ...s.doc.locked, [d.ids[0]]: true } }, dragging: false, undo: [...s.undo, d.before], redo: [] });
  } else useApp.setState({ dragging: false });
  return { id: d.ids[0], moved: d.moved };
}
export const TREE_MIME = 'application/x-textwmindmap-tree';
let clipboard: { token: string; text: string; doc: Doc; root: Item; cut: boolean } | null = null;
export function treeCopy() {
  const s = useApp.getState(), n = active(); if (!n) return null;
  const text = s.mode === 'subtree' ? extract(s.doc, n) : n.label;
  if (s.mode !== 'subtree') return { text, token: '' };
  const token = `${Date.now()}-${Math.random()}`;
  clipboard = { token, text, doc: structuredClone(s.doc), root: n, cut: false };
  return { text, token };
}
export function treeCut() { if (clipboard) clipboard.cut = true; deleteSelection(); }
export function pasteTree(text: string, token: string, forceChild = false) {
  const s = useApp.getState();
  const local = clipboard && token === clipboard.token && normalizeClip(text) === normalizeClip(clipboard.text) ? clipboard : null;
  if (!local && !forceChild && !text.includes('\n')) { replaceSelection(text); return; }
  const next = append(s.doc, active(), text);
  if (local && next.selected) {
    const pasted = next.items.find(n => n.id === next.selected)!;
    const source = subtree(local.doc, local.root), dest = subtree(next, pasted), origin = next.positions[pasted.id];
    source.forEach((n, i) => {
      if (!dest[i]) return;
      const p = local.doc.positions[n.id], root = local.doc.positions[local.root.id];
      next.positions[dest[i].id] = { x: origin.x + p.x - root.x, y: origin.y + p.y - root.y };
      next.locked[dest[i].id] = local.doc.locked[n.id];
    });
  }
  commit(next, 'single-node');
}
const normalizeClip = (s: string) => s.replace(/\r\n?/g, '\n').trimEnd();
export function selectionRange() { const d = useApp.getState().doc, n = active(); return n ? bounds(d, n, useApp.getState().mode === 'subtree') : null; }
