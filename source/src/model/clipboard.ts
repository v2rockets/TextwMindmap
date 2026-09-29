import { columns, normalize } from './document';
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Plain-text clipboard form that remains renderable by Markdown consumers. */
export function markdownText(text: string) {
  return normalize(text).split('\n').map(line => {
    if (!line.trim()) return '';
    const leading = line.match(/^[ \t]*/)?.[0] ?? '';
    return `${leading}- ${line.slice(leading.length).trimStart()}`;
  }).join('\n');
}
export function clipboardHTML(text: string) {
  // Both nested lists and explicit paragraph offsets: Office consumes HTML, while
  // plain-text consumers receive real tab characters from the other MIME type.
  const roots: { label: string; depth: number; children: any[] }[] = [];
  const stack: typeof roots = [];
  for (const line of normalize(text).split('\n')) {
    if (!line.trim()) continue;
    const node = { label: line.trimStart(), depth: columns(line), children: [] };
    while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
    (stack.at(-1)?.children ?? roots).push(node); stack.push(node);
  }
  const render = (nodes: typeof roots): string => '<ul>' + nodes.map(n => `<li><p style="margin:0">${escape(n.label)}</p>${n.children.length ? render(n.children) : ''}</li>`).join('') + '</ul>';
  return `<html><body><!--StartFragment-->${render(roots)}<!--EndFragment--></body></html>`;
}
export function fromClipboard(plain: string, html: string): string {
  if (!html) return normalize(plain);
  const dom = new DOMParser().parseFromString(html, 'text/html');
  dom.querySelectorAll('script,style,meta').forEach(e => e.remove());
  const rows: { text: string; depth: number }[] = [];
  function walk(el: Element, listDepth: number) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') { Array.from(el.children).forEach(c => walk(c, listDepth + 1)); return; }
    if (tag === 'li') {
      const clone = el.cloneNode(true) as Element; clone.querySelectorAll('ul,ol').forEach(e => e.remove());
      const text = clone.textContent?.trim() ?? '';
      if (text) rows.push({ text, depth: Math.max(0, listDepth - 1) });
      Array.from(el.children).filter(c => /^(UL|OL)$/.test(c.tagName)).forEach(c => walk(c, listDepth)); return;
    }
    if (tag === 'p' || tag === 'div' && !el.querySelector('p,div,ul,ol')) {
      const style = el.getAttribute('style') ?? '';
      const level = style.match(/mso-list:[^;]*level(\d+)/i);
      const margin = style.match(/(?:margin-left|padding-left)\s*:\s*([\d.]+)(pt|px|in|cm|em)?/i);
      const px = margin ? Number(margin[1]) * ({ pt: 4 / 3, in: 96, cm: 96 / 2.54, em: 16 }[margin[2]] ?? 1) : 0;
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]').forEach(e => e.remove());
      clone.querySelectorAll('br').forEach(e => e.replaceWith('\n'));
      const text = normalize(clone.textContent ?? '').replace(/^\s*[•·●]\s*/, '');
      if (text.trim()) rows.push({ text: text.trimStart(), depth: level ? Number(level[1]) - 1 : Math.max(Math.round(px / 24), Math.floor(columns(text) / 4)) });
      return;
    }
    Array.from(el.children).forEach(c => walk(c, listDepth));
  }
  walk(dom.body, 0);
  if (!rows.length) return normalize(plain || dom.body.textContent || '');
  // Prefer native tabs if HTML is flat; never discard hierarchy that plain text has.
  if (!rows.some(r => r.depth) && /\n[ \t]+\S/.test(normalize(plain))) return normalize(plain);
  const min = Math.min(...rows.map(r => r.depth));
  return rows.map(r => '\t'.repeat(r.depth - min) + r.text.replace(/\n/g, ' ')).join('\n');
}
