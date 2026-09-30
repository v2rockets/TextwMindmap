import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { OutlineEditor } from './OutlineEditor';
import { Canvas } from './Canvas';
import { active, commit, example, history, release, stopLayout, useApp, SESSION_STORAGE_KEY } from './store';
import { document as makeDocument } from './model/document';
import { copyAll } from './clipboard-events';
import { downloadMindmapImage } from './export-image';
import './styles.css';

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const s = useApp(), file = useRef<HTMLInputElement>(null), workspace = useRef<HTMLElement>(null), selected = active();
  useEffect(() => {
    try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, text: s.doc.text, nodes: s.doc.items.map(n => ({ line: n.line, position: s.doc.positions[n.id], locked: s.doc.locked[n.id] })), selectedLine: selected?.line ?? 0, viewport: s.viewport })); } catch { /* private browsing or blocked storage */ }
  }, [s.doc, s.viewport, selected?.line]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest('textarea,input,.cm-editor,.map-focus')) return;
      if ((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())) { e.preventDefault(); history(e.shiftKey || e.key.toLowerCase() === 'y'); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); release(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <div className="app">
    <header><div className="brand"><strong>TextwMindmap</strong><span>outline ↔ mindmap · offline</span></div><div className="toolbar">
      <button onClick={() => history()} disabled={!s.undo.length}>Undo</button><button onClick={() => history(true)} disabled={!s.redo.length}>Redo</button>
      <button onClick={() => release()}>Release subtree</button>
      <button onClick={copyAll}>Copy outline</button><button onClick={() => void downloadMindmapImage(s.doc, s.sizes)}>Save picture</button><button onClick={() => file.current?.click()}>Open map</button>
      <button onClick={() => download(JSON.stringify({ version: 1, text: s.doc.text, nodes: s.doc.items.map(n => ({ line: n.line, position: s.doc.positions[n.id], locked: s.doc.locked[n.id] })) }), 'mindmap.json', 'application/json')}>Save map</button>
    </div></header>
    <input ref={file} type="file" accept=".txt,.md,.json" hidden onChange={async e => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const text = await f.text();
        if (f.name.endsWith('.json')) {
          const data = JSON.parse(text); if (data.version !== 1 || typeof data.text !== 'string' || !Array.isArray(data.nodes)) throw Error('Unrecognized map file');
          const doc = makeDocument(data.text);
          for (const n of doc.items) { const saved = data.nodes.find((v: { line: number }) => v.line === n.line); if (saved && Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)) { doc.positions[n.id] = saved.position; doc.locked[n.id] = !!saved.locked; } }
          commit(doc, 'text-edit', 'open', false);
        } else commit(makeDocument(text), 'text-edit');
        useApp.setState({ status: `Opened ${f.name}. Undo restores the previous map.` });
      } catch (err) { useApp.setState({ status: `Could not open file: ${String(err)}` }); }
      e.target.value = '';
    }} />
    <main ref={workspace} className="workspace" style={{ gridTemplateColumns: `minmax(230px, ${s.divider}%) 7px minmax(260px, 1fr)` }}>
      <section className="outline-pane"><div className="pane-title">Outline <small>{s.mode === 'subtree' ? 'Subtree selected' : s.mode === 'single-node' ? 'Node selected' : 'Text editing'} · click a bullet again to switch scope</small></div><OutlineEditor /></section>
      <div className="splitter" role="separator" aria-label="Resize panes" aria-orientation="vertical" aria-valuemin={22} aria-valuemax={72} aria-valuenow={s.divider} tabIndex={0}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.dragging = 'true'; }}
        onPointerMove={e => { if (e.currentTarget.dataset.dragging !== 'true') return; const r = workspace.current!.getBoundingClientRect(); useApp.setState({ divider: Math.max(22, Math.min(72, (e.clientX - r.left) / r.width * 100)) }); }}
        onPointerUp={e => { delete e.currentTarget.dataset.dragging; e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={e => { delete e.currentTarget.dataset.dragging; }}
        onKeyDown={e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); useApp.setState({ divider: Math.max(22, Math.min(72, s.divider + (e.key === 'ArrowRight' ? 2 : -2))) }); } }} />
      <section className="map-pane"><div className="pane-title">Mindmap <small>Enter: sibling · Shift+Enter: child · drag a branch to move it</small></div><div className="canvas-wrap"><ReactFlowProvider><Canvas /></ReactFlowProvider></div></section>
    </main>
    <footer><span>{s.running ? 'Arranging…' : s.dragging ? 'Moving subtree' : s.mode === 'subtree' ? 'Subtree selected' : 'Ready'} · {s.doc.items.length} nodes · {Math.round(s.viewport.zoom * 100)}%</span><span className="status">{s.status}</span></footer>
    <details className="help"><summary>Controls & clipboard</summary><p>Click a node once to select its content and focus the matching outline line; click again for its subtree. Type in the outline to edit the selected node. Enter creates a sibling and Shift+Enter a child when selected. With a text caret, Enter splits the line. Ctrl+X/C/V acts on the selection: in single-node mode Ctrl+X cuts only that node's visible text, while subtree mode cuts the whole subtree. A copied subtree pastes as children of a selected destination. Ctrl+Shift+L releases the selected branch. ◆ means locked relative to the parent. Undo/redo works across both views.</p><p>Copy outline includes real tabs and HTML for OneNote. Open map imports plain text or a saved map; Save map keeps positions and locks. This page works offline; save your work before closing.</p></details>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
