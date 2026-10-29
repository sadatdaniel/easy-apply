import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { blockToMarkdown, parseBlocks, replaceBlock, serializeBlocks, setTypes, toggleMark, type Block, type LineType } from '@shared/blocks';
import { renderDoc } from '@shared/render';
import { wordDiff } from '@shared/diff';
import type { DocMeta, DocStyle } from '@shared/types';
import { CONTENT, MARGIN, PAGE_H, paginate } from './paginate';
import { blockEl, blocksToHtml, blocksToText, cut, htmlToBlocks, indexOf, lengthOf, MD_TYPE, offsetIn, placeCaret, prepare, resolve, textToBlocks, type Caret } from './pageEdit';

const GAP = 28; // between pages on screen
const PITCH = PAGE_H + GAP;

interface Review {
  i: number; top: number; left: number; width: number;
  original: string; state: 'loading' | 'ready' | 'error';
  text: string; why: string; unverified: string[]; error: string; instruction: string; tries: string[];
}
export type Tailor = (body: string, block: number, instruction: string, avoid: string[]) => Promise<{ text: string; why: string; unverified: string[] }>;

interface Snap { blocks: Block[]; caret: Caret | null }
type Span = { a: ReturnType<typeof resolve> & {}; b: ReturnType<typeof resolve> & {}; i: number; j: number };

/**
  The themed page itself is the editor, like a word processor: click anywhere and type, select across lines,
  Ctrl+Z / Ctrl+Shift+Z, copy and paste between documents. The browser never edits the page directly; each
  change is applied to the document's blocks and the page is drawn again (see pageEdit.ts).
*/
export function DocEditor({ body, meta, onChange, onMeta, readOnly = false, tailor, tailorMode = false }: {
  body: string; meta: DocMeta; onChange?: (body: string, opts?: { version?: boolean }) => void; readOnly?: boolean;
  /** saves document settings (the formatting bar's text size, spacing …) */
  onMeta?: (patch: Partial<DocMeta>) => void;
  /** asks the AI for a rewrite of one block; enables the ✨ tools */
  tailor?: Tailor;
  /** clicking a line asks for a rewrite instead of placing the caret */
  tailorMode?: boolean;
}) {
  // the editor keeps its own blocks: an empty line you just made has no Markdown of its own yet
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(body));
  const emitted = useRef(body);
  const html = useMemo(() => renderDoc(blocks, meta.theme, meta.kind, meta.lang, meta.style), [blocks, meta.theme, meta.kind, meta.lang, meta.style]);
  const paper = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const caret = useRef<Caret | null>(null);
  const hist = useRef<{ past: Snap[]; future: Snap[]; last: { kind: string; b: number; at: number } | null }>({ past: [], future: [], last: null });
  const composing = useRef(false);
  const [pages, setPages] = useState(1);
  const [review, setReview] = useState<Review | null>(null);
  const [target, setTarget] = useState<{ from: number; to: number } | null>(null);
  const [hr, setHr] = useState<{ i: number; top: number } | null>(null);
  const reqId = useRef(0);
  const editable = !readOnly && !tailorMode;

  // a new text from outside (another version restored, the file reloaded): take it, and keep undo possible
  useEffect(() => {
    if (body === emitted.current) return;
    emitted.current = body;
    hist.current.past.push({ blocks, caret: null });
    hist.current.future = [];
    hist.current.last = null;
    setBlocks(parseBlocks(body));
  }, [body]);

  // tailoring counts blocks the way the saved file has them, so drop empty lines first
  useEffect(() => {
    if (tailorMode && blocks.some(b => b.type !== 'hr' && !b.text.trim())) setBlocks(parseBlocks(serializeBlocks(blocks)));
  }, [tailorMode]);

  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    if (editable) prepare(root);
    root.querySelectorAll('.reviewing, .picked').forEach(e => e.classList.remove('reviewing', 'picked'));
    if (review) root.querySelectorAll(`[data-b="${review.i}"]`).forEach(e => e.classList.add('reviewing'));
    if (hr) blockEl(root, hr.i)?.classList.add('picked');
    if (caret.current && editable) { root.focus({ preventScroll: true }); placeCaret(root, caret.current); caret.current = null; }
  });

  // pages: laid out exactly as the PDF will break them (see paginate.ts); again once the fonts have loaded
  const layoutPages = () => {
    const sheet = host.current?.querySelector<HTMLElement>('.sheet');
    if (!sheet) return;
    sheet.classList.add('paged');
    setPages(paginate(sheet, PITCH).pages);
  };
  useLayoutEffect(layoutPages, [html]);
  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => { if (live) layoutPages(); });
    const again = () => layoutPages();
    document.fonts.addEventListener('loadingdone', again);
    return () => { live = false; document.fonts.removeEventListener('loadingdone', again); };
  }, []);

  /* ---------- applying a change ---------- */
  function emit(next: Block[], opts?: { version?: boolean }) {
    const md = serializeBlocks(next.filter(b => b.type === 'hr' || b.text.trim()));
    if (md === emitted.current && !opts?.version) return;
    emitted.current = md;
    onChange?.(md, opts);
  }
  function commit(next: Block[], c: Caret | null, kind = 'edit', opts?: { version?: boolean }) {
    const h = hist.current, now = Date.now();
    // typing in one line within a moment is one undo step
    const same = kind === 'type' && h.last?.kind === 'type' && h.last.b === c?.b && now - h.last.at < 1500;
    if (!same) { h.past.push({ blocks, caret: currentCaret() }); if (h.past.length > 200) h.past.shift(); }
    h.future = [];
    h.last = { kind, b: c?.b ?? -1, at: now };
    setHr(null);
    setBlocks(next);
    caret.current = c;
    emit(next, opts);
  }
  function undo() {
    const h = hist.current, prev = h.past.pop();
    if (!prev) return;
    h.future.push({ blocks, caret: currentCaret() });
    h.last = null;
    setBlocks(prev.blocks); caret.current = prev.caret; emit(prev.blocks);
  }
  function redo() {
    const h = hist.current, next = h.future.pop();
    if (!next) return;
    h.past.push({ blocks, caret: currentCaret() });
    h.last = null;
    setBlocks(next.blocks); caret.current = next.caret; emit(next.blocks);
  }

  /* ---------- where the selection is ---------- */
  function span(r?: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number } | null): Span | null {
    const root = host.current;
    const sel = getSelection();
    const range = r ?? (sel && sel.rangeCount ? sel.getRangeAt(0) : null);
    if (!root || !range || !root.contains(range.startContainer)) return null;
    const a = resolve(root, { node: range.startContainer, offset: range.startOffset }, 'start');
    const b = resolve(root, { node: range.endContainer, offset: range.endOffset }, 'end');
    if (!a || !b) return null;
    const i = indexOf(a.el), j = indexOf(b.el);
    return i <= j ? { a, b, i, j } : null; // the sidebar layout can put a later block above an earlier one
  }
  function currentCaret(): { b: number; off: number; to: { b: number; off: number } } | null {
    const s = span();
    if (!s) return null;
    const off = (x: Span['a']) => x.el.tagName === 'HR' ? 0 : offsetIn(x.el, x.point);
    return { b: s.i, off: off(s.a), to: { b: s.j, off: off(s.b) } };
  }
  /** the block's Markdown before a, between a and b, after b */
  function pieces(s: Span) {
    const hrA = s.a.el.tagName === 'HR', hrB = s.b.el.tagName === 'HR';
    const fromEnd = hrB ? 0 : lengthOf(s.b.el) - offsetIn(s.b.el, s.b.point);
    if (s.i === s.j) {
      if (hrA) return { before: '', mid: '', after: '', fromEnd };
      const [before, mid, after] = cut(s.a.el, s.a.point, s.b.point);
      return { before, mid, after, fromEnd };
    }
    return { before: hrA ? '' : cut(s.a.el, s.a.point)[0], mid: '', after: hrB ? '' : cut(s.b.el, s.b.point)[1], fromEnd };
  }
  const typeAt = (i: number): Block['type'] => (blocks[i].type === 'hr' ? 'p' : blocks[i].type);

  /** replace the selection (or a given range) with text or pasted blocks */
  function replace(ins: string | Block[], r?: Parameters<typeof span>[0], kind = 'edit', later = false) {
    const s = span(r);
    if (!s) return;
    const { before, after, fromEnd } = pieces(s);
    const t = typeAt(s.i);
    let nb: Block[], c: Caret;
    if (typeof ins === 'string') {
      // Markdown shortcuts: "- " starts a bullet, "## " a section
      const short = t === 'p' && before.length <= 3 ? (before + ins).match(/^([-*•]|#{2,3}) /)?.[1] : undefined;
      if (short) {
        nb = [{ type: short.startsWith('#') ? (short.length === 2 ? 'h2' : 'h3') : 'li', text: (before + ins).slice(short.length + 1) + after }];
        c = { b: s.i, end: fromEnd };
      }
      else { nb = [{ type: t, text: before + ins + after }]; c = { b: s.i, end: fromEnd, later }; }
    } else {
      const list = [...ins];
      nb = [];
      // pasted lines at the end of a line go below it, at its start above it; in the middle they split it
      const atEnd = before.trim() && !after.trim(), atStart = !before.trim() && after.trim();
      if (atEnd) nb.push({ type: t, text: before });
      else if (before.trim()) nb.push(list[0]?.type !== 'hr' ? { type: t, text: before + list.shift()!.text } : { type: t, text: before });
      if (atStart) { nb.push(...list, { type: t, text: after }); commit([...blocks.slice(0, s.i), ...nb, ...blocks.slice(s.j + 1)], { b: s.i + nb.length - 1, off: 0 }, kind); return; }
      nb.push(...list);
      const last = nb[nb.length - 1];
      if (after) { if (!last || last.type === 'hr') nb.push({ type: 'p', text: after }); else nb[nb.length - 1] = { ...last, text: last.text + after }; }
      if (!nb.length) nb = [{ type: t, text: '' }];
      c = { b: s.i + nb.length - 1, end: fromEnd };
    }
    commit([...blocks.slice(0, s.i), ...nb, ...blocks.slice(s.j + 1)], c, kind);
  }

  /** Enter: split the line; Enter on an empty bullet ends the list */
  function split() {
    const s = span();
    if (!s) return;
    const { before, after } = pieces(s);
    const t = typeAt(s.i);
    const nextType: Block['type'] = t === 'li' ? 'li' : 'p';
    let nb: Block[];
    if (t === 'li' && !before.trim() && !after.trim()) { nb = [{ type: 'p', text: '' }]; commit([...blocks.slice(0, s.i), ...nb, ...blocks.slice(s.j + 1)], { b: s.i, off: 0 }); return; }
    if (!before.trim() && after) nb = [{ type: nextType, text: '' }, { type: t, text: after }];
    else nb = [{ type: t, text: before }, { type: nextType, text: after }];
    commit([...blocks.slice(0, s.i), ...nb, ...blocks.slice(s.j + 1)], { b: s.i + 1, off: 0 });
  }

  function remove(inputType: string, targets: StaticRange[]) {
    const sel = getSelection();
    const s = span();
    if (!sel || !s) return;
    if (!sel.isCollapsed) return replace('');
    const back = inputType.includes('Backward');
    const el = s.a.el, i = s.i;
    if (el.tagName === 'HR') return commit([...blocks.slice(0, i), ...blocks.slice(i + 1)], { b: Math.max(0, i - 1), end: 0 });
    const off = offsetIn(el, s.a.point), len = lengthOf(el);
    if (back && off === 0) {
      if (blocks[i].type === 'li') return commit(blocks.map((b, k) => (k === i ? { type: 'p', text: b.text } : b)), { b: i, off: 0 });
      const p = i - 1;
      if (p < 0) return;
      if (blocks[p].type === 'hr') return commit([...blocks.slice(0, p), ...blocks.slice(i)], { b: p, off: 0 });
      const type = blocks[p].text.trim() ? blocks[p].type : blocks[i].type;
      return commit([...blocks.slice(0, p), { type, text: blocks[p].text + blocks[i].text }, ...blocks.slice(i + 1)], { b: p, end: len });
    }
    if (!back && off === len) {
      const n = i + 1;
      if (n >= blocks.length) return;
      if (blocks[n].type === 'hr') return commit([...blocks.slice(0, n), ...blocks.slice(n + 1)], { b: i, off });
      return commit([...blocks.slice(0, i), { type: blocks[i].type, text: blocks[i].text + blocks[n].text }, ...blocks.slice(n + 1)], { b: i, off });
    }
    // inside a line: the browser knows what a character or a word is
    const t = targets[0];
    if (t && !t.collapsed && blockOfSame(t, el)) return replace('', t, 'type');
    sel.modify('extend', back ? 'backward' : 'forward', /Word/.test(inputType) ? 'word' : /Line/.test(inputType) ? 'lineboundary' : 'character');
    replace('', null, 'type');
  }
  const blockOfSame = (r: StaticRange, el: HTMLElement) => el.contains(r.startContainer) && el.contains(r.endContainer);

  /* ---------- formatting ---------- */
  function mark(m: '**' | '*') {
    const s = span();
    if (!s) return;
    const keep = currentCaret();
    if (s.i !== s.j) return commit(toggleMark(blocks, s.i, s.j, m), keep);
    if (s.a.el.tagName === 'HR') return;
    let { before, mid, after } = pieces(s);
    if (!mid) { // no selection: the word at the caret
      const w1 = before.match(/[\p{L}\p{N}_-]*$/u)![0], w2 = after.match(/^[\p{L}\p{N}_-]*/u)![0];
      if (!w1 && !w2) return;
      before = before.slice(0, before.length - w1.length); after = after.slice(w2.length); mid = w1 + w2;
    }
    const opened = (s: string) => s.endsWith(m) && (m === '**' || !s.endsWith('**'));
    const closed = (s: string) => s.startsWith(m) && (m === '**' || !s.startsWith('**'));
    let text: string;
    if (opened(before) && closed(after)) text = before.slice(0, -m.length) + mid + after.slice(m.length);
    else {
      const inner = m === '**' ? mid.replace(/\*\*/g, '') : mid.replace(/(?<!\*)\*(?!\*)/g, '');
      const lead = inner.match(/^\s*/)![0], trail = inner.match(/\s*$/)![0];
      text = before + lead + m + inner.trim() + m + trail + after;
    }
    commit(blocks.map((b, k) => (k === s.i ? { ...b, text } : b)), keep);
  }
  function link() {
    const s = span();
    if (!s || s.i !== s.j || s.a.el.tagName === 'HR') return;
    const { before, mid, after } = pieces(s);
    const url = prompt('Link address', 'https://');
    if (!url || !/^(https?:\/\/|mailto:)\S+$/.test(url.trim())) return;
    const text = before + `[${mid.trim() || url.replace(/^(https?:\/\/|mailto:)/, '')}](${url.trim()})` + after;
    commit(blocks.map((b, k) => (k === s.i ? { ...b, text } : b)), { b: s.i, end: lengthOf(s.b.el) - offsetIn(s.b.el, s.b.point) });
  }
  function setType(type: LineType) {
    const s = span();
    const from = s?.i ?? target?.from, to = s?.j ?? target?.to;
    if (from === undefined || to === undefined) return;
    const keep = currentCaret();
    const r = setTypes(blocks, from, to, type);
    commit(r.blocks, keep && { ...keep, to: { ...keep.to, b: Math.min(keep.to.b, r.to) } });
  }
  function divider() {
    const at = span()?.j ?? hr?.i ?? target?.to;
    if (at === undefined) return;
    const tail: Block[] = at === blocks.length - 1 ? [{ type: 'p', text: '' }] : [];
    commit([...blocks.slice(0, at + 1), { type: 'hr', text: '' }, ...tail, ...blocks.slice(at + 1)], { b: at + 2, off: 0 });
  }
  function removeHr() { if (hr) { commit([...blocks.slice(0, hr.i), ...blocks.slice(hr.i + 1)], hr.i > 0 ? { b: hr.i - 1, end: 0 } : null); } }

  /* ---------- browser events ---------- */
  useEffect(() => {
    const root = host.current;
    if (!root || !editable) return;
    const before = (e: InputEvent) => {
      const t = e.inputType;
      if (composing.current || t === 'insertCompositionText') return;
      e.preventDefault();
      const targets = e.getTargetRanges?.() ?? [];
      if (t === 'historyUndo') undo();
      else if (t === 'historyRedo') redo();
      else if (t === 'formatBold') mark('**');
      else if (t === 'formatItalic') mark('*');
      else if (t === 'insertText') replace(e.data ?? '', null, 'type');
      else if (t === 'insertReplacementText') replace(e.data ?? e.dataTransfer?.getData('text/plain') ?? '', targets[0] ?? null);
      else if (t === 'insertLineBreak') replace('\n', null, 'edit', true);
      else if (t === 'insertParagraph') split();
      else if (t.startsWith('delete')) remove(t, targets);
      // anything else (drops, unknown formatting) is ignored: the page only changes through the blocks
    };
    root.addEventListener('beforeinput', before);
    return () => root.removeEventListener('beforeinput', before);
  });

  // what the formatting bar acts on follows the selection
  useEffect(() => {
    if (!editable) return;
    const f = () => {
      const s = span();
      setTarget(t => (s ? (t?.from === s.i && t.to === s.j ? t : { from: s.i, to: s.j }) : host.current?.contains(document.activeElement) ? t : null));
    };
    document.addEventListener('selectionchange', f);
    return () => document.removeEventListener('selectionchange', f);
  }, [editable, blocks]);

  function onKeyDown(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (hr && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); removeHr(); }
    else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 'b') { e.preventDefault(); mark('**'); }
    else if (mod && k === 'i') { e.preventDefault(); mark('*'); }
    else if (mod && k === 'k') { e.preventDefault(); link(); }
    else if (e.key === 'Tab') e.preventDefault();
    else if (e.key === 'Escape') { setHr(null); host.current?.blur(); }
  }

  function selectedBlocks(): Block[] | null {
    const s = span();
    const sel = getSelection();
    if (!s || !sel || sel.isCollapsed) return null;
    const { mid } = pieces(s);
    if (s.i === s.j) return [{ type: typeAt(s.i), text: mid }];
    const first = cut(s.a.el, s.a.point)[1], last = cut(s.b.el, s.b.point)[0];
    return [{ type: blocks[s.i].type, text: first }, ...blocks.slice(s.i + 1, s.j), { type: blocks[s.j].type, text: last }].filter(b => b.type === 'hr' || b.text.trim());
  }
  function onCopy(e: React.ClipboardEvent, isCut = false) {
    const bs = selectedBlocks();
    if (!bs) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', blocksToText(bs));
    e.clipboardData.setData('text/html', blocksToHtml(bs));
    e.clipboardData.setData(MD_TYPE, serializeBlocks(bs));
    if (isCut) replace('');
  }
  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const cd = e.clipboardData;
    const md = cd.getData(MD_TYPE), html = cd.getData('text/html'), text = cd.getData('text/plain');
    const bs = md ? parseBlocks(md) : html ? htmlToBlocks(html) : textToBlocks(text);
    if (!bs.length) return;
    replace(bs.length === 1 && bs[0].type !== 'hr' ? bs[0].text : bs);
  }
  function onCompositionEnd() {
    composing.current = false;
    // the browser typed this one itself (Chinese, Japanese, dead keys …): read the line back
    const sel = getSelection();
    const s = span();
    if (!sel || !s || s.a.el.tagName === 'HR') return;
    const el = s.a.el;
    const fromEnd = lengthOf(el) - offsetIn(el, s.a.point);
    const [text] = cut(el, { node: el, offset: el.childNodes.length });
    commit(blocks.map((b, k) => (k === s.i ? { ...b, text } : b)), { b: s.i, end: fromEnd }, 'type');
  }

  /* ---------- tailoring one block ---------- */
  /** the block's box relative to the paper */
  function boxOf(el: HTMLElement) {
    const base = paper.current!.getBoundingClientRect();
    let r = el.getBoundingClientRect();
    if (!r.width) { // display:contents (Classic entry headers): use the children's box
      const rs = [...el.children].map(c => c.getBoundingClientRect());
      r = new DOMRect(Math.min(...rs.map(x => x.left)), Math.min(...rs.map(x => x.top)), Math.max(...rs.map(x => x.right)) - Math.min(...rs.map(x => x.left)), Math.max(...rs.map(x => x.bottom)) - Math.min(...rs.map(x => x.top)));
    }
    return new DOMRect(r.left - base.left, r.top - base.top, r.width, r.height);
  }
  async function startReview(i: number, instruction = '', tries: string[] = []) {
    if (!tailor) return;
    const el = host.current && blockEl(host.current, i);
    const b = blocks[i];
    if (!el || !b || b.type === 'hr') return;
    const r = boxOf(el);
    const id = ++reqId.current;
    const base = { i, top: r.bottom + 8, left: Math.max(0, Math.min(r.left - 8, 794 - 470)), width: 470, original: blockToMarkdown(b), instruction, tries, text: '', why: '', unverified: [] as string[], error: '' };
    setReview({ ...base, state: 'loading' });
    try {
      const x = await tailor(serializeBlocks(blocks), i, instruction, tries);
      if (id === reqId.current) setReview({ ...base, state: 'ready', text: x.text, why: x.why, unverified: x.unverified, tries: [...tries, x.text] });
    } catch (err) {
      if (id === reqId.current) setReview({ ...base, state: 'error', error: (err as Error).message });
    }
  }
  function closeReview() { reqId.current++; setReview(null); }
  function accept(text: string) {
    if (!review) return;
    const next = replaceBlock(blocks, review.i, text);
    closeReview();
    commit(next, null, 'ai', { version: true });
  }
  /** keep the suggestion, then adjust it on the page */
  function editSuggestion() {
    if (!review) return;
    const next = replaceBlock(blocks, review.i, review.text);
    const i = review.i;
    closeReview();
    commit(next, { b: i, end: 0 }, 'ai', { version: true });
  }

  function onClick(e: React.MouseEvent) {
    if (readOnly) return;
    const el = (e.target as HTMLElement).closest('[data-b]') as HTMLElement | null;
    if ((e.target as HTMLElement).closest('a')) e.preventDefault();
    if (tailorMode) {
      if (review) { closeReview(); }
      if (el && tailor) startReview(indexOf(el));
      return;
    }
    if (el?.tagName === 'HR') { const r = boxOf(el); setHr({ i: indexOf(el), top: r.top }); getSelection()?.removeAllRanges(); host.current?.focus({ preventScroll: true }); }
    else setHr(null);
  }

  useEffect(() => {
    if (!review) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeReview(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [review]);

  const barTarget = hr ? { type: null, many: 0 } : target ? { type: rangeKind(blocks.slice(target.from, target.to + 1)), many: target.to > target.from ? target.to - target.from + 1 : 0 } : null;

  return (
    <div className="paper-wrap" style={{ position: 'relative' }}>
      {!readOnly && <FormatBar style={meta.style ?? {}} target={tailorMode ? null : barTarget} wrap={m => mark(m as '**' | '*')} link={link} setType={setType} divider={divider}
        undo={hist.current.past.length ? undo : undefined} redo={hist.current.future.length ? redo : undefined}
        setStyle={onMeta && (st => onMeta({ style: st }))} />}
      <div ref={paper} className={'paper paged-view' + (readOnly ? '' : ' editable') + (tailorMode ? ' tailoring' : '')} style={{ width: 794, height: pages * PITCH - GAP }} onClick={onClick}>
        {Array.from({ length: pages }, (_, k) => <div key={k} className="page-card" style={{ top: k * PITCH, height: PAGE_H }} />)}
        <div ref={host} style={{ paddingTop: MARGIN }} className="page-host" dangerouslySetInnerHTML={{ __html: html }}
          contentEditable={editable} suppressContentEditableWarning spellCheck={editable}
          onKeyDown={editable ? onKeyDown : undefined} onCopy={editable ? e => onCopy(e) : undefined} onCut={editable ? e => onCopy(e, true) : undefined}
          onPaste={editable ? onPaste : undefined} onDragStart={e => editable && e.preventDefault()} onDrop={e => editable && e.preventDefault()}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={editable ? onCompositionEnd : undefined} />
        {/* the page margins and the gap between pages, over anything (a coloured column) that runs through them */}
        {Array.from({ length: pages }, (_, k) => (
          <div key={k}>
            {k > 0 && <div className="page-mask" style={{ top: k * PITCH - GAP, height: GAP }} />}
            <div className="page-margin" style={{ top: k * PITCH, height: MARGIN }} />
            <div className="page-margin" style={{ top: k * PITCH + MARGIN + CONTENT, height: MARGIN }}><span>{pages > 1 ? `${k + 1} / ${pages}` : ''}</span></div>
          </div>
        ))}
        {hr && editable && (
          <div className="blk-tools" style={{ top: hr.top - 30, right: 40 }} onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}>
            <button onClick={removeHr}>Remove divider (Delete)</button>
            <button className="soft" onClick={() => setHr(null)}>Keep</button>
          </div>
        )}
        {review && (
          <div className="rv" style={{ top: review.top, left: review.left, width: review.width }} onClick={e => e.stopPropagation()}>
            {review.state === 'loading' && <div className="rv-wait"><span className="spin" /> Tailoring this {review.tries.length ? 'again' : 'part'}…</div>}
            {review.state === 'error' && <div className="rv-err">{review.error}</div>}
            {review.state === 'ready' && (review.text === review.original
              ? <div className="rv-wait">No change suggested: this part already fits. Add a wish below and press Retry.</div>
              : <>
                  <div className="rv-diff">{wordDiff(review.original, review.text).map((p, k) =>
                    p.op === 'same' ? <span key={k}>{p.text}</span> : p.op === 'del' ? <del key={k}>{p.text}</del> : <ins key={k}>{p.text}</ins>)}</div>
                  {review.why && <div className="rv-why">{review.why}</div>}
                  {review.unverified.length > 0 && <div className="rv-warn">Not in your documents yet: <b>{review.unverified.join(', ')}</b>. Only accept if that's true for you.</div>}
                </>)}
            <form className="rv-ask" onSubmit={e => { e.preventDefault(); startReview(review.i, review.instruction, review.tries); }}>
              <input className="input" placeholder="Wish (optional), e.g. shorter · mention SQL · more concrete" value={review.instruction}
                onChange={e => setReview({ ...review, instruction: e.target.value })} />
            </form>
            <div className="rv-btns">
              <button className="btn sm pri" disabled={review.state !== 'ready' || review.text === review.original} onClick={() => accept(review.text)}>Accept</button>
              <button className="btn sm" disabled={review.state !== 'ready' || review.text === review.original} onClick={editSuggestion} title="Accept, then adjust it yourself">Accept &amp; edit</button>
              <button className="btn sm" disabled={review.state === 'loading'} onClick={() => startReview(review.i, review.instruction, review.tries)}>Retry</button>
              <span className="sp" />
              <button className="btn sm" onClick={closeReview}>{review.state === 'ready' ? 'Reject' : 'Close'}</button>
            </div>
          </div>
        )}
      </div>
      {!readOnly && tailorMode && <p className="muted" style={{ textAlign: 'center', fontSize: 12, margin: '14px 0 0' }}>✨ Tailor mode: click a line to get a version tailored to this job. Nothing changes until you press Accept.</p>}
      {!readOnly && !tailorMode && <p className="muted" style={{ textAlign: 'center', fontSize: 12, margin: '14px 0 0' }}>Type anywhere on the page. Enter starts a new line, Shift+Enter breaks a line, "- " starts a bullet. Ctrl+Z undoes, Ctrl+Shift+Z redoes.</p>}
    </div>
  );
}


/** the type all selected lines share, or null when they differ */
const rangeKind = (bs: { type: string }[]): LineType | null => { const t = new Set(bs.filter(b => b.type !== 'hr').map(b => b.type)); return t.size === 1 ? [...t][0] as LineType : null; };
const TYPES: [LineType, string, string][] = [['p', 'Text', 'Paragraph'], ['li', 'Bullet', 'Bullet point'], ['h2', 'Section', 'Section heading'], ['h3', 'Entry', 'Entry: "Title | dates", with the place on the next line']];
const SIZES = [85, 90, 95, 100, 105, 110, 115, 120];

/**
  Sticky bar above the page. Line tools (type, bold, italic, link, divider) act on the lines the selection
  touches; the bar never takes the focus from the page (mousedown is cancelled). Size, spacing, alignment and
  margins apply to the whole document: a CV reads better when it is consistent.
*/
function FormatBar({ target, style, wrap, link, setType, divider, setStyle, undo, redo }: {
  /** the selected lines (many > 1 when several); null when the caret is not on the page */
  target: { type: LineType | null; many: number } | null; style: DocStyle;
  wrap: (m: string) => void; link: () => void; setType: (t: LineType) => void; divider: () => void;
  setStyle?: (s: DocStyle) => void; undo?: () => void; redo?: () => void;
}) {
  const keep = (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('select')) e.preventDefault(); };
  // stick just below the screen's own sticky toolbar (.edbar), whose height changes when it wraps
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const above = ref.current?.closest('.content')?.querySelector('.edbar');
    if (!above) return;
    const ro = new ResizeObserver(() => setTop(above.getBoundingClientRect().height));
    ro.observe(above);
    return () => ro.disconnect();
  }, []);
  const off = !target;
  const editing = target?.type ?? null;
  const many = target?.many ?? 0;
  const hint = off ? 'Click into the page, or select several lines' : undefined;
  const size = style.size ?? 100;
  const set = (patch: Partial<DocStyle>) => {
    const next: DocStyle = { ...style, ...patch };
    for (const k of Object.keys(next) as (keyof DocStyle)[]) if (next[k] === undefined || (k === 'size' && next.size === 100)) delete next[k];
    setStyle?.(next);
  };
  const step = (d: number) => {
    const i = SIZES.indexOf(size) < 0 ? SIZES.indexOf(100) : SIZES.indexOf(size);
    set({ size: SIZES[Math.max(0, Math.min(SIZES.length - 1, i + d))] });
  };

  return (
    <div ref={ref} className="fmtbar" style={{ top: top + 8 }} onMouseDown={keep} onClick={e => e.stopPropagation()}>
      <div className="fg">
        <button disabled={!undo} title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
        <button disabled={!redo} title="Redo (Ctrl+Shift+Z)" onClick={redo}>↷</button>
      </div>
      <div className="fg" title={hint}>
        {TYPES.map(([t, label, title]) => (
          <button key={t} className={editing === t ? 'on' : ''} disabled={off || editing === 'h1'} title={title} onClick={() => setType(t)}>{label}</button>
        ))}
      </div>
      <div className="fg" title={hint}>
        <button disabled={off} title="Bold (Ctrl+B)" onClick={() => wrap('**')}><b>B</b></button>
        <button disabled={off} title="Italic (Ctrl+I)" onClick={() => wrap('*')}><i>I</i></button>
        <button disabled={off || many > 0} title={many ? 'Links work on one line at a time' : 'Link (Ctrl+K)'} onClick={link}>Link</button>
        <button disabled={off} title="Insert a divider (horizontal line) below" onClick={divider}>Divider</button>
      </div>
      {many > 0 && <span className="fmt-count">{many} lines</span>}
      {setStyle && <>
        <div className="fg" title="Text size for the whole document">
          <button onClick={() => step(-1)} disabled={size <= SIZES[0]} title="Smaller">A−</button>
          <span className="val">{size}%</span>
          <button onClick={() => step(1)} disabled={size >= SIZES[SIZES.length - 1]} title="Bigger">A+</button>
        </div>
        <select title="Line spacing for the whole document" value={style.lineHeight ?? ''} onChange={e => set({ lineHeight: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Lines</option><option value="1.15">Tight</option><option value="1.3">Normal</option><option value="1.5">Relaxed</option>
        </select>
        <div className="fg" title="Alignment of paragraphs and bullets">
          <button className={style.align === 'left' ? 'on' : ''} onClick={() => set({ align: style.align === 'left' ? undefined : 'left' })}>Left</button>
          <button className={style.align === 'justify' ? 'on' : ''} onClick={() => set({ align: style.align === 'justify' ? undefined : 'justify' })}>Justify</button>
        </div>
        <select title="Page margins" value={style.margins ?? ''} onChange={e => set({ margins: (e.target.value || undefined) as DocStyle['margins'] })}>
          <option value="">Margins</option><option value="narrow">Narrow</option><option value="wide">Wide</option>
        </select>
        {Object.keys(style).length > 0 && <button className="reset" onClick={() => setStyle({})} title="Back to the theme's own size, spacing and margins">Reset</button>}
      </>}
    </div>
  );
}
