import { clipboardHTML, fromClipboard, markdownText } from './model/clipboard';
import { cutNodeText, pasteTree, treeCopy, treeCut, TREE_MIME, useApp } from './store';
export function copyEvent(event: ClipboardEvent, cut = false, all = false, forceSubtree = false) {
  if (!event.clipboardData) return false;
  const payload = all ? { text: useApp.getState().doc.text, token: '' } : treeCopy(forceSubtree);
  if (!payload) return false;
  try {
    event.clipboardData.setData('text/plain', markdownText(payload.text).replace(/\r?\n/g, '\r\n'));
    event.clipboardData.setData('text/html', clipboardHTML(payload.text));
    if (payload.token) { try { event.clipboardData.setData(TREE_MIME, payload.token); } catch { /* text/html still available */ } }
    event.preventDefault();
    if (cut) (forceSubtree || useApp.getState().mode === 'subtree') ? treeCut() : cutNodeText();
    return true;
  } catch { useApp.setState({ status: 'Clipboard write failed; the outline was left intact.' }); return false; }
}
export function pasteEvent(event: ClipboardEvent, forceChild = false) {
  if (!event.clipboardData) return false;
  const text = fromClipboard(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'));
  if (!text.trim()) return false;
  event.preventDefault(); pasteTree(text, event.clipboardData.getData(TREE_MIME), forceChild); return true;
}
export function copyAll() {
  const handler = (e: ClipboardEvent) => { copyEvent(e, false, true); e.stopImmediatePropagation(); };
  document.addEventListener('copy', handler, true);
  const ok = document.execCommand('copy'); document.removeEventListener('copy', handler, true);
  useApp.setState({ status: ok ? 'Outline copied as Markdown text and HTML for OneNote.' : 'Select the outline and press Ctrl+C to copy.' });
}

export function invokeTreeCopy(cut = false, forceSubtree = false) {
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
  holder.textContent = (forceSubtree || useApp.getState().mode === 'subtree') ? (treeCopy(forceSubtree)?.text ?? '') : useApp.getState().doc.text;
  document.body.append(holder);
  const range = document.createRange(); range.selectNodeContents(holder);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const handler = (e: ClipboardEvent) => { copyEvent(e, cut, false, forceSubtree); };
  holder.addEventListener('copy', handler);
  const ok = document.execCommand('copy');
  holder.removeEventListener('copy', handler); selection.removeAllRanges(); holder.remove();
  if (!ok) useApp.setState({ status: 'Clipboard write failed; the outline was left intact.' });
  return ok;
}

export async function invokeTreePaste() {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      let plain = '', html = '', token = '';
      for (const item of items) {
        if (item.types.includes('text/plain')) plain = await (await item.getType('text/plain')).text();
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (item.types.includes(TREE_MIME)) token = await (await item.getType(TREE_MIME)).text();
      }
      const text = fromClipboard(plain, html);
      if (text.trim()) { pasteTree(text, token, true); return true; }
    }
  } catch { /* use the browser's native paste command below */ }
  const holder = document.createElement('div');
  holder.contentEditable = 'true'; holder.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0'; document.body.append(holder); holder.focus();
  let pasted = false;
  const handler = (e: ClipboardEvent) => { pasted = pasteEvent(e, true); };
  holder.addEventListener('paste', handler);
  const ok = document.execCommand('paste');
  holder.removeEventListener('paste', handler); holder.remove();
  return ok && pasted;
}
