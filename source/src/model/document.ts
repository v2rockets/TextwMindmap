export type Point = { x: number; y: number };
export type Tone = 'default' | 'orange' | 'green' | 'purple' | 'red';
export type Item = { id: string; label: string; line: number; end: number; depth: number; parent: string | null; annotation: string; tone: Tone };
export type Doc = { text: string; items: Item[]; positions: Record<string, Point>; locked: Record<string, boolean>; selected: string | null };
let serial = 0;
const uid = () => `n-${Date.now().toString(36)}-${++serial}`;
export const normalize = (s: string) => {
  const lines = s.replace(/\r\n?/g, '\n').split('\n');
  // Markdown and Office text often prefix every item with a bullet. Remove
  // only the marker, preserving the whitespace that defines the hierarchy.
  const hasListMarker = lines.some(line => /^[ \t]*(?:[-*+]\s+|\d+[.)]\s+|[•·●]\s+)/.test(line));
  return (hasListMarker
    ? lines.map(line => line.replace(/^([ \t]*)(?:[-*+]|\d+[.)]|[•·●])\s+/, '$1'))
    : lines).join('\n');
};
export const indent = (s: string) => s.match(/^[ \t]*/)?.[0] ?? '';
export function columns(s: string) { let n = 0; for (const c of indent(s)) n += c === '\t' ? 4 - n % 4 : 1; return n; }
export const padding = (n: number) => '\t'.repeat(Math.floor(n / 4)) + ' '.repeat(n % 4);
export function parse(text: string, ids: Map<number, string> = new Map()): Item[] {
  const lines = text.split('\n'), items: Item[] = [], stack: Item[] = [];
  lines.forEach((raw, line) => {
    const [label, ...notes] = raw.trim().split('=>');
    if (!label.trim()) return;
    const depth = columns(raw);
    while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
    const visible = label.trim();
    const tone = visible.startsWith('!') ? 'orange' : visible.startsWith('%') ? 'green' : visible.startsWith('$') ? 'purple' : visible.startsWith('?') ? 'red' : 'default';
    const display = tone === 'default' ? visible : visible.slice(1).trimStart();
    const n: Item = { id: ids.get(line) ?? uid(), label: display, line, end: lines.length, depth, parent: stack.at(-1)?.id ?? null, annotation: notes.join('=>').trim(), tone };
    items.push(n); stack.push(n);
  });
  items.forEach((n, i) => { n.end = items.slice(i + 1).find(p => p.depth <= n.depth)?.line ?? lines.length; });
  lines.forEach((raw, line) => {
    if (!raw.trim().startsWith('=>')) return;
    const owner = [...items].reverse().find(n => n.line < line && n.depth <= columns(raw));
    if (owner) owner.annotation += (owner.annotation ? '\n' : '') + raw.trim().slice(2).trim();
  });
  return items;
}
export function document(text: string, old?: Doc, ids?: Map<number, string>): Doc {
  text = normalize(text);
  // Callers performing edits supply mapped line identities. Initial import gets fresh IDs.
  const items = parse(text, ids);
  const positions: Doc['positions'] = {}, locked: Doc['locked'] = {};
  items.forEach((n, i) => {
    const parent = n.parent ? positions[n.parent] : undefined;
    const angle = i * 2.399963;
    positions[n.id] = old?.positions[n.id] ? { ...old.positions[n.id] } : { x: (parent?.x ?? 0) + (i ? Math.cos(angle) * 220 : 0), y: (parent?.y ?? 0) + (i ? Math.sin(angle) * 220 : 0) };
    locked[n.id] = old?.locked[n.id] ?? false;
  });
  // The bundled guide is intentionally composed as a readable poster.  Keep
  // its first view stable instead of sending it through the force simulation.
  // Users can still release a branch whenever they want a free layout.
  if (!old && text.startsWith('TextwMindmap\n')) {
    const guide: Record<string, Point> = {
      'TextwMindmap': { x: 0, y: 0 },
      'Start here': { x: -300, y: -260 },
      'Enter: sibling · Shift+Enter: child': { x: -650, y: -260 },
      'Selection': { x: -300, y: -20 },
      'Click once: focus the outline': { x: -660, y: -80 },
      'Click twice: select the subtree': { x: -660, y: 80 },
      'Navigate': { x: 300, y: -260 },
      'Drag background to pan · wheel to zoom': { x: 690, y: -250 },
      'Edit': { x: 300, y: -20 },
      'Type to edit the selected node': { x: 680, y: -20 },
      'Select a subtree first, then Ctrl+X / Ctrl+V to move it': { x: 720, y: 140 },
      'Layout': { x: 300, y: 260 },
      'Drag a branch to lock its root': { x: 680, y: 240 },
      'Use ! % $ ? to define node colors': { x: 700, y: 380 },
    };
    items.forEach(n => { const p = guide[n.label]; if (p) positions[n.id] = { ...p }; });
  }
  return { text, items, positions, locked, selected: items.some(n => n.id === old?.selected) ? old!.selected : items[0]?.id ?? null };
}
export function spliceLines(doc: Doc, at: number, count: number, added: string[], keepFirst = false) {
  const lines = doc.text.split('\n'), ids = new Map<number, string>();
  doc.items.forEach(n => {
    if (n.line < at) ids.set(n.line, n.id);
    else if (n.line >= at + count) ids.set(n.line + added.length - count, n.id);
    else if (keepFirst && n.line === at && added.length) ids.set(at, n.id);
  });
  lines.splice(at, count, ...added);
  return document(lines.join('\n'), doc, ids);
}
export const subtree = (doc: Doc, node: Item) => doc.items.filter(n => n.line >= node.line && n.line < node.end);
export function bounds(doc: Doc, n: Item, whole = true) {
  const lines = doc.text.split('\n');
  const from = lines.slice(0, n.line).reduce((a, b) => a + b.length + 1, 0);
  const visibleEnd = lines[n.line].indexOf('=>');
  let labelEnd = visibleEnd >= 0 ? visibleEnd : lines[n.line].length;
  if (!whole && visibleEnd >= 0) while (labelEnd > 0 && /\s/.test(lines[n.line][labelEnd - 1])) labelEnd--;
  const to = whole ? Math.min(doc.text.length, lines.slice(0, n.end).reduce((a, b) => a + b.length + 1, 0)) : from + labelEnd;
  return { from, to };
}
export function extract(doc: Doc, n: Item) {
  return doc.text.split('\n').slice(n.line, n.end).map(l => padding(Math.max(0, columns(l) - n.depth)) + l.trimStart()).join('\n').replace(/\n+$/, '');
}
export function remove(doc: Doc, n: Item) {
  const next = spliceLines(doc, n.line, n.end - n.line, []);
  next.selected = n.parent ?? next.items[Math.min(n.line, next.items.length - 1)]?.id ?? null;
  return next;
}
export function append(doc: Doc, target: Item | undefined, content: string, sibling = false) {
  if (!content.trim()) return doc;
  const lines = doc.text.split('\n');
  const raw = normalize(content).replace(/\n+$/, '').split('\n');
  const baseline = Math.min(...raw.filter(l => l.trim()).map(columns));
  const prefix = target ? indent(lines[target.line]) + (sibling ? '' : '\t') : '';
  const added = raw.map(l => prefix + padding(Math.max(0, columns(l) - baseline)) + l.trimStart());
  const at = target?.end ?? (doc.text ? lines.length : 0);
  const next = spliceLines(doc, at, doc.text ? 0 : 1, added);
  next.selected = next.items.find(n => n.line === at)?.id ?? null; return next;
}
export function rename(doc: Doc, n: Item, value: string) {
  const raw = doc.text.split('\n')[n.line], at = raw.indexOf('=>');
  return spliceLines(doc, n.line, 1, [indent(raw) + value.replace(/\r?\n/g, ' ').trim() + (at >= 0 ? ' ' + raw.slice(at) : '')], true);
}
export function replaceTree(doc: Doc, n: Item, content: string) {
  const raw = normalize(content).split('\n'), baseline = Math.min(...raw.filter(l => l.trim()).map(columns), 0);
  const prefix = indent(doc.text.split('\n')[n.line]);
  const lines = raw.map(l => prefix + padding(Math.max(0, columns(l) - baseline)) + l.trimStart());
  const next = spliceLines(doc, n.line, n.end - n.line, lines, true);
  next.selected = next.items.find(i => i.line === n.line)?.id ?? null; return next;
}
