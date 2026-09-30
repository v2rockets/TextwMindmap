import { useEffect, useMemo, useRef } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, Handle, Position, BaseEdge, useReactFlow, type Node, type NodeProps, type Edge, type EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { active, beginDrag, endDrag, measured, select, useApp, moveDragScreen, relax, createNode, deleteSelection, history, release } from './store';
import { subtree, type Item } from './model/document';
import { copyEvent, pasteEvent } from './clipboard-events';
import { focusOutline } from './OutlineEditor';

type Data = { item: Item; level: number; active: boolean; mode: string; locked: boolean };
function MindNode({ id, data }: NodeProps<Node<Data>>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => measured(id, el.offsetWidth, el.offsetHeight));
    observer.observe(el); return () => observer.disconnect();
  }, [id]);
  const depthSize = Math.max(14, 27 - data.level * 2.5);
  return <div ref={ref} data-node-id={id} data-label={data.item.label} data-level={data.level} style={{ fontSize: `${depthSize}px` }} className={`mind-node nopan nodrag tone-${data.item.tone} ${data.item.parent ? '' : 'root-node'} ${data.active ? `active-${data.mode}` : ''} ${data.locked ? 'locked' : ''}`}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      // React Flow's pan gesture is attached to the canvas wrapper. Mark the
      // wrapper too, so a branch drag can never begin a simultaneous pan.
      e.currentTarget.parentElement?.classList.add('nopan');
      e.currentTarget.setPointerCapture(e.pointerId);
      beginDrag(id, { x: e.clientX, y: e.clientY });
    }}
    onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <span className="node-label">{data.item.label}</span>
    {data.locked && <span className="lock-mark" title="Position locked relative to parent" aria-label="locked">◆</span>}
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
}
function FloatingEdge({ source, target, id }: EdgeProps) {
  const { doc, sizes } = useApp();
  const a = doc.positions[source], b = doc.positions[target]; if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const intersection = (node: string, direction: number) => {
    const p = doc.positions[node], s = sizes[node] ?? { width: 140, height: 48 };
    const t = Math.min((s.width / 2) / (Math.abs(dx) || 1e-9), (s.height / 2) / (Math.abs(dy) || 1e-9));
    return { x: p.x + direction * dx * Math.min(.5, t), y: p.y + direction * dy * Math.min(.5, t) };
  };
  const from = intersection(source, 1), to = intersection(target, -1);
  return <BaseEdge id={id} path={`M${from.x},${from.y} L${to.x},${to.y}`} style={{ stroke: '#acb9c5', strokeWidth: 1.6 }} interactionWidth={0} />;
}
const nodeTypes = { mind: MindNode }, edgeTypes = { floating: FloatingEdge };
export function Canvas() {
  const { doc, mode, dragging, viewport } = useApp(), rf = useReactFlow();
  const holder = useRef<HTMLDivElement>(null), initialFit = useRef(false);
  const root = active();
  const selectedIds = useMemo(() => mode === 'subtree' && root ? new Set(subtree(doc, root).map(n => n.id)) : new Set(doc.selected ? [doc.selected] : []), [doc.items, doc.selected, mode]);
  const levels = new Map<string, number>();
  const nodes: Node<Data>[] = doc.items.map(item => {
    const level = item.parent ? (levels.get(item.parent) ?? 0) + 1 : 0;
    levels.set(item.id, level);
    return { id: item.id, type: 'mind', position: doc.positions[item.id], origin: [.5, .5], style: { pointerEvents: 'all' },
      data: { item, level, active: selectedIds.has(item.id), mode, locked: !!doc.locked[item.id] }, draggable: false, selectable: false, focusable: false };
  });
  const edges: Edge[] = doc.items.filter(n => n.parent).map(n => ({ id: `edge-${n.id}`, source: n.parent!, target: n.id, type: 'floating', selectable: false }));
  useEffect(() => {
    if (initialFit.current) return;
    initialFit.current = true;
    const isGuide = doc.text.startsWith('TextwMindmap\n');
    const timer = setTimeout(() => { if (!isGuide) relax(); void rf.fitView({ padding: .3, maxZoom: 1, duration: 0 }); }, 150);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const cancel = () => endDrag(true); window.addEventListener('pointercancel', cancel);
    const move = (e: PointerEvent) => { if (useApp.getState().dragging) moveDragScreen({ x: e.clientX, y: e.clientY }); };
    const up = () => { document.querySelectorAll('.react-flow__node.nopan').forEach(el => el.classList.remove('nopan')); if (useApp.getState().dragging) { const result = endDrag(); if (result && !result.moved) { select(result.id); focusOutline(); } } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointercancel', cancel); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  return <div ref={holder} className="map-focus" tabIndex={0} role="region" aria-label="Mindmap canvas"
    onKeyDown={e => {
      if ((e.target as HTMLElement).closest('textarea,input')) return;
      const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (e.nativeEvent.isComposing) return;
      if (mod && ['z','y'].includes(key)) { e.preventDefault(); history(key === 'y' || e.shiftKey); }
      else if (mod && e.shiftKey && key === 'l') { e.preventDefault(); release(); }
      else if (e.key === 'Escape') { endDrag(true); }
      else if (e.key === 'Enter') { e.preventDefault(); createNode(!e.shiftKey, true); focusOutline(); }
      else if (['Delete','Backspace'].includes(e.key)) { e.preventDefault(); deleteSelection(); }
    }}
    onCopy={e => { if (!(e.target as HTMLElement).closest('textarea,input')) copyEvent(e.nativeEvent); }}
    onCut={e => { if (!(e.target as HTMLElement).closest('textarea,input')) copyEvent(e.nativeEvent, true); }}
    onPaste={e => { if (!(e.target as HTMLElement).closest('textarea,input')) pasteEvent(e.nativeEvent); }}>
    <ReactFlow proOptions={{ hideAttribution: true }} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodeOrigin={[.5,.5]}
      onPaneClick={() => { holder.current?.focus(); useApp.setState({ mode: 'text-edit', focus: 'map' }); }}
      panOnDrag={dragging ? false : [0,1]} selectionOnDrag={false} zoomOnScroll={!dragging} zoomOnPinch={!dragging} zoomOnDoubleClick={false}
      autoPanOnNodeDrag={false} autoPanOnNodeFocus={false} nodeDragThreshold={4} deleteKeyCode={null} disableKeyboardA11y
      minZoom={.1} maxZoom={3} onMove={(_, viewport) => useApp.setState({ viewport })} fitView={false}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} color="#c5d4df" /><Controls showInteractive={false} />
      <div className="canvas-tools"><button className="nodrag nopan" onClick={() => { const el = holder.current?.closest('.canvas-wrap') as HTMLElement | null; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen(); }}>Full screen</button><button className="nodrag nopan" onClick={() => { const n = active(); const p = n && doc.positions[n.id]; if (p) void rf.setCenter(p.x, p.y, { zoom: rf.getZoom(), duration: 250 }); }} disabled={!root}>Locate selected</button><button className="nodrag nopan" title="Reset zoom to 100%" onClick={() => void rf.zoomTo(1)}>{Math.round(viewport.zoom * 100)}%</button></div>
    </ReactFlow>
  </div>;
}
