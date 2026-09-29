import type { Doc } from './model/document';
import type { Sizes } from './model/layout';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const wrap = (text: string, limit: number) => {
  const words = text.match(/.{1,24}/gu) ?? [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) { if (line && line.length + word.length > limit) { lines.push(line); line = ''; } line += word; }
  if (line || !lines.length) lines.push(line);
  return lines;
};

/** Export the current world-space map as a self-contained PNG. */
export async function downloadMindmapImage(doc: Doc, sizes: Sizes) {
  const margin = 70, boxes = doc.items.map(n => {
    const size = sizes[n.id] ?? { width: Math.min(320, Math.max(120, n.label.length * 9 + 36)), height: 52 };
    const width = Math.min(360, Math.max(100, size.width)), height = Math.max(44, size.height);
    return { n, x: doc.positions[n.id].x, y: doc.positions[n.id].y, width, height };
  });
  const minX = Math.min(...boxes.map(b => b.x - b.width / 2)) - margin, maxX = Math.max(...boxes.map(b => b.x + b.width / 2)) + margin;
  const minY = Math.min(...boxes.map(b => b.y - b.height / 2)) - margin, maxY = Math.max(...boxes.map(b => b.y + b.height / 2)) + margin;
  const width = Math.max(480, Math.ceil(maxX - minX)), height = Math.max(320, Math.ceil(maxY - minY));
  const at = new Map(boxes.map(b => [b.n.id, b]));
  const edges = doc.items.filter(n => n.parent).map(n => { const a = at.get(n.parent!)!, b = at.get(n.id)!; return `<path d="M ${a.x - minX} ${a.y - minY} L ${b.x - minX} ${b.y - minY}" stroke="#acb9c5" stroke-width="2" fill="none"/>`; }).join('');
  const nodes = boxes.map(({ n, x, y, width: w, height: h }) => {
    const level = n.depth / 4, font = Math.max(14, 27 - level * 2.5), root = !n.parent;
    const lines = wrap(n.label, Math.max(10, Math.floor(w / (font * .58))));
    const text = lines.map((line, i) => `<tspan x="${x - minX}" dy="${i ? font * 1.3 : 0}">${esc(line)}</tspan>`).join('');
    const fill = root ? '#5b55b7' : '#327db1', stroke = root ? '#3c2778' : '#27587a';
    return `<g><rect x="${x - minX - w / 2}" y="${y - minY - h / 2}" width="${w}" height="${h}" rx="${root ? 22 : 13}" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${x - minX}" y="${y - minY - (lines.length - 1) * font * .65}" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="Inter,Arial,sans-serif" font-size="${font}" font-weight="${root ? 750 : 500}">${text}</text></g>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f7fbfe"/>${edges}${nodes}</svg>`;
  const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render map image')); });
  const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2; const ctx = canvas.getContext('2d')!; ctx.scale(2, 2); ctx.drawImage(image, 0, 0, width, height);
  const link = document.createElement('a'); link.download = 'textwmindmap.png'; link.href = canvas.toDataURL('image/png'); link.click();
}
