import { clipboardHTML, fromClipboard, markdownText } from './model/clipboard';
import { cutNodeText, pasteTree, treeCopy, treeCut, TREE_MIME, useApp } from './store';
export function copyEvent(event: ClipboardEvent, cut = false, all = false) {
  if (!event.clipboardData) return false;
  const payload = all ? { text: useApp.getState().doc.text, token: '' } : treeCopy();
  if (!payload) return false;
  try {
    event.clipboardData.setData('text/plain', markdownText(payload.text).replace(/\r?\n/g, '\r\n'));
    event.clipboardData.setData('text/html', clipboardHTML(payload.text));
    if (payload.token) { try { event.clipboardData.setData(TREE_MIME, payload.token); } catch { /* text/html still available */ } }
    event.preventDefault();
    if (cut) useApp.getState().mode === 'single-node' ? cutNodeText() : treeCut();
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

export function invokeTreeCopy(cut = false) {
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
  holder.textContent = useApp.getState().mode === 'subtree' ? (treeCopy()?.text ?? '') : (useApp.getState().doc.text);
  document.body.append(holder);
  const range = document.createRange(); range.selectNodeContents(holder);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const handler = (e: ClipboardEvent) => { copyEvent(e, cut); };
  holder.addEventListener('copy', handler);
  const ok = document.execCommand('copy');
  holder.removeEventListener('copy', handler); selection.removeAllRanges(); holder.remove();
  if (!ok) useApp.setState({ status: 'Clipboard write failed; the outline was left intact.' });
  return ok;
}
