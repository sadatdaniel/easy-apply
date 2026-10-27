import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { blockToMarkdown, parseBlocks, replaceBlock, serializeBlocks, setTypes, toggleMark, type LineType } from '@shared/blocks';
import { renderDoc } from '@shared/render';
import { wordDiff } from '@shared/diff';
import type { DocMeta, DocStyle } from '@shared/types';

const PAGE_H = 1123; // A4 at 96 dpi

interface Editing { i: number; text: string; top: number; left: number; width: number; height: number; font: Partial<CSSStyleDeclaration> }
interface Review {
  i: number; top: number; left: number; width: number;
  original: string; state: 'loading' | 'ready' | 'error';
  text: string; why: string; unverified: string[]; error: string; instruction: string; tries: string[];
}
export type Tailor = (body: string, block: number, instruction: string, avoid: string[]) => Promise<{ text: string; why: string; unverified: string[] }>;

/** The themed page itself is the editor: click a block, edit its markdown in place, Enter to keep. */
export function DocEditor({ body, meta, onChange, onMeta, readOnly = false, tailor, tailorMode = false }: {
  body: string; meta: DocMeta; onChange?: (body: string, opts?: { version?: boolean }) => void; readOnly?: boolean;
  /** saves document settings (the formatting bar's text size, spacing …) */
  onMeta?: (patch: Partial<DocMeta>) => void;
  /** asks the AI for a rewrite of one block; enables the ✨ tools */
  tailor?: Tailor;
  /** clicking a line asks for a rewrite instead of opening it for editing */
  tailorMode?: boolean;
}) {
  const blocks = useMemo(() => parseBlocks(body), [body]);
  const html = useMemo(() => renderDoc(blocks, meta.theme, meta.kind, meta.lang, meta.style), [blocks, meta.theme, meta.kind, meta.lang, meta.style]);
  const paper = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [edit, setEdit] = useState<Editing | null>(null);
  const [pages, setPages] = useState(1);
  const [review, setReview] = useState<Review | null>(null);
  // several lines selected for formatting together (drag across lines, or click one and Shift+click another)
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null);
  const anchor = useRef<number | null>(null);
  const swallowClick = useRef(false);
  const reqId = useRef(0);

  // measure where A4 pages break
  useLayoutEffect(() => {
    const sheet = paper.current?.querySelector('.sheet') as HTMLElement | null;
    if (sheet) setPages(Math.max(1, Math.ceil((sheet.scrollHeight - 2) / PAGE_H)));
  });

  // hide the block being edited so the textarea sits in its place; mark the one under review
  useLayoutEffect(() => {
    paper.current?.querySelectorAll('.editing, .reviewing, .picked').forEach(e => e.classList.remove('editing', 'reviewing', 'picked'));
    if (edit) paper.current?.querySelectorAll(`[data-b="${edit.i}"]`).forEach(e => e.classList.add('editing'));
    if (review) paper.current?.querySelectorAll(`[data-b="${review.i}"]`).forEach(e => e.classList.add('reviewing'));
    if (sel) for (let i = sel.from; i <= sel.to; i++) paper.current?.querySelectorAll(`[data-b="${i}"]`).forEach(e => e.classList.add('picked'));
  }, [edit, review?.i, sel, html]);

  useEffect(() => { if (edit && ta.current) { ta.current.focus(); autosize(ta.current); } }, [edit?.i]);

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

  function open(el: HTMLElement) {
    const i = Number(el.dataset.b);
    anchor.current = i;
    setSel(null);
    const r = boxOf(el);
    // entry headers and contact lines are wrappers; take the font from their first part
    const cs = getComputedStyle((el.matches('.eh, .contact') && el.firstElementChild) || el);
    setEdit({
      i, text: blockToMarkdown(blocks[i]),
      top: r.top - 5, left: r.left - 7, width: Math.max(r.width + 14, 260), height: r.height + 10,
      font: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight },
    });
  }

  function commit(text = edit?.text) {
    if (!edit || text === undefined) return;
    const next = serializeBlocks(replaceBlock(blocks, edit.i, text));
    setEdit(null);
    if (next !== serializeBlocks(blocks)) onChange?.(next);
  }

  function insertAfter(kind: 'li' | 'p') {
    if (!edit) return;
    const cur = parseBlocks(edit.text);
    const all = [...blocks.slice(0, edit.i), ...cur, kind === 'li' ? { type: 'li' as const, text: '…' } : { type: 'p' as const, text: '…' }, ...blocks.slice(edit.i + 1)];
    onChange?.(serializeBlocks(all));
    setEdit(null);
  }

  /** ask for a rewrite of block i; `src` is the body to rewrite from (it may hold an edit not saved yet) */
  async function startReview(i: number, src = body, instruction = '', tries: string[] = []) {
    if (!tailor) return;
    const el = paper.current?.querySelector(`[data-b="${i}"]`) as HTMLElement | null;
    const b = parseBlocks(src)[i];
    if (!el || !b || b.type === 'hr') return;
    const r = boxOf(el);
    const id = ++reqId.current;
    const base = { i, top: r.bottom + 8, left: Math.max(0, Math.min(r.left - 8, 794 - 470)), width: 470, original: blockToMarkdown(b), instruction, tries, text: '', why: '', unverified: [] as string[], error: '' };
    setReview({ ...base, state: 'loading' });
    try {
      const x = await tailor(src, i, instruction, tries);
      if (id === reqId.current) setReview({ ...base, state: 'ready', text: x.text, why: x.why, unverified: x.unverified, tries: [...tries, x.text] });
    } catch (err) {
      if (id === reqId.current) setReview({ ...base, state: 'error', error: (err as Error).message });
    }
  }

  function closeReview() { reqId.current++; setReview(null); }

  function accept(text: string) {
    if (!review) return;
    const next = serializeBlocks(replaceBlock(blocks, review.i, text));
    closeReview();
    if (next !== body) onChange?.(next, { version: true });
  }

  /** open the suggestion in the in-place editor, to adjust it before keeping */
  function editSuggestion() {
    if (!review) return;
    const el = paper.current?.querySelector(`[data-b="${review.i}"]`) as HTMLElement | null;
    const text = review.text;
    closeReview();
    if (el) { open(el); setEdit(e => e && { ...e, text }); }
  }

  function tailorFromEdit() {
    if (!edit) return;
    const src = serializeBlocks(replaceBlock(blocks, edit.i, edit.text));
    const i = edit.i;
    setEdit(null);
    if (src !== body) onChange?.(src);
    // wait for the page to re-render with the edited text before measuring the block
    requestAnimationFrame(() => startReview(i, src));
  }

  /* ---- formatting the open line (Markdown) ---- */
  function setText(text: string, from?: number, to?: number) {
    setEdit(e => e && { ...e, text });
    requestAnimationFrame(() => {
      const t = ta.current;
      if (!t) return;
      autosize(t); t.focus();
      if (from !== undefined) t.setSelectionRange(from, to ?? from);
    });
  }

  /** **bold** / *italic*: wraps the selection (or the word at the cursor); again removes it */
  function wrap(m: string) {
    if (sel) return rangeMark(m as '**' | '*');
    const t = ta.current;
    if (!t) return;
    let { selectionStart: a, selectionEnd: b } = t;
    const v = t.value;
    if (v.slice(a - m.length, a) === m && v.slice(b, b + m.length) === m && !(m === '*' && v.slice(a - 2, a) === '**'))
      return setText(v.slice(0, a - m.length) + v.slice(a, b) + v.slice(b + m.length), a - m.length, b - m.length);
    if (a === b) { // no selection: take the word under the cursor
      while (a > 0 && /[\p{L}\p{N}_-]/u.test(v[a - 1])) a--;
      while (b < v.length && /[\p{L}\p{N}_-]/u.test(v[b])) b++;
    }
    setText(v.slice(0, a) + m + v.slice(a, b) + m + v.slice(b), a + m.length, b + m.length);
  }

  /** [text](https://…) with the address selected, ready to type over */
  function link() {
    const t = ta.current;
    if (!t) return;
    const { selectionStart: a, selectionEnd: b, value: v } = t;
    const label = v.slice(a, b) || 'link text';
    const md = `[${label}](https://)`;
    setText(v.slice(0, a) + md + v.slice(b), a + label.length + 3, a + md.length - 1);
  }

  const lineType = (text: string): LineType => /^### /.test(text) ? 'h3' : /^## /.test(text) ? 'h2' : /^# /.test(text) ? 'h1' : /^[-*•] /.test(text) ? 'li' : 'p';

  /* ---- several lines at once ---- */
  /** the blocks a mouse selection on the page covers, if it spans more than one */
  function selectedBlocks(): { from: number; to: number } | null {
    const s = getSelection();
    if (!s || s.isCollapsed || !paper.current) return null;
    const blockOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest('[data-b]') as HTMLElement | null;
    const a = blockOf(s.anchorNode), f = blockOf(s.focusNode);
    if (!a || !f || !paper.current.contains(a) || !paper.current.contains(f)) return null;
    const x = Number(a.dataset.b), y = Number(f.dataset.b);
    return x === y ? null : { from: Math.min(x, y), to: Math.max(x, y) };
  }
  function pickRange(from: number, to: number) {
    if (edit) commit();
    getSelection()?.removeAllRanges();
    setSel({ from: Math.min(from, to), to: Math.max(from, to) });
  }
  function onMouseUp(e: React.MouseEvent) {
    if (readOnly || edit || e.shiftKey) return; // Shift+click is handled by onClick, from our own anchor
    const r = selectedBlocks();
    if (r) { swallowClick.current = true; pickRange(r.from, r.to); }
  }
  const apply = (next: typeof blocks) => { const md = serializeBlocks(next); if (md !== body) onChange?.(md); };
  function rangeType(type: LineType) {
    if (!sel) return;
    const r = setTypes(blocks, sel.from, sel.to, type);
    apply(r.blocks);
    setSel({ from: sel.from, to: r.to });
  }
  function rangeMark(m: '**' | '*') { if (sel) apply(toggleMark(blocks, sel.from, sel.to, m)); }
  /** a divider after the open line or the selection */
  function divider() {
    if (edit) {
      const cur = parseBlocks(edit.text);
      const all = [...blocks.slice(0, edit.i), ...cur, { type: 'hr' as const, text: '' }, ...blocks.slice(edit.i + 1)];
      setEdit(null);
      apply(all);
    } else if (sel) {
      apply([...blocks.slice(0, sel.to + 1), { type: 'hr' as const, text: '' }, ...blocks.slice(sel.to + 1)]);
      setSel(null);
    }
  }
  useEffect(() => {
    if (!sel) return;
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') setSel(null);
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); rangeMark('**'); }
      else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); rangeMark('*'); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });
  // the selection belongs to this document's text; a new text (another document, an undo) clears it
  useEffect(() => { setSel(s => (s && s.to < blocks.length ? s : null)); }, [blocks.length]);

  function setType(type: LineType) {
    if (sel) return rangeType(type);
    if (!edit) return;
    let rest = edit.text.replace(/^(#{1,3}\s+|[-*•]\s+)/, '');
    if (type === 'h3' && !rest.includes(' | ')) rest += ' | dates';
    const text = LINE_PREFIX[type] + rest;
    setText(text, text.length);
  }

  function onClick(e: React.MouseEvent) {
    if (readOnly) return;
    if (swallowClick.current) { swallowClick.current = false; return; } // the end of a drag-selection
    const el = (e.target as HTMLElement).closest('[data-b]') as HTMLElement | null;
    if ((e.target as HTMLElement).closest('a')) e.preventDefault();
    if (e.shiftKey && el && anchor.current !== null) { pickRange(anchor.current, Number(el.dataset.b)); return; }
    if (sel) setSel(null);
    if (edit) { commit(); return; }
    if (review) { closeReview(); if (!tailorMode) return; }
    if (!el) return;
    if (tailorMode && tailor) startReview(Number(el.dataset.b));
    else open(el);
  }

  useEffect(() => {
    if (!review) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeReview(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [review]);

  return (
    <div className="paper-wrap" style={{ position: 'relative' }}>
      {!readOnly && <FormatBar style={meta.style ?? {}} wrap={wrap} link={link} setType={setType} divider={divider}
        target={edit ? { type: lineType(edit.text), many: 0 } : sel ? { type: rangeKind(blocks.slice(sel.from, sel.to + 1)), many: sel.to - sel.from + 1 } : null}
        setStyle={onMeta && (st => onMeta({ style: st }))} />}
      <div ref={paper} className={'paper' + (readOnly ? '' : ' editable')} style={{ width: 794 }} onClick={onClick} onMouseUp={onMouseUp}
        onMouseDown={e => { if (e.shiftKey && anchor.current !== null) e.preventDefault(); /* no browser text selection on Shift+click */ }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {Array.from({ length: pages - 1 }, (_, k) => (
          <div key={k} className="pbreak" style={{ top: (k + 1) * PAGE_H }}><span>page {k + 2}</span></div>
        ))}
        {edit && (
          <>
            <textarea
              ref={ta} className="blk-edit" value={edit.text} spellCheck
              style={{ top: edit.top, left: edit.left, width: edit.width, minHeight: edit.height, ...edit.font } as React.CSSProperties}
              onClick={e => e.stopPropagation()}
              onChange={e => { setEdit({ ...edit, text: e.target.value }); autosize(e.target); }}
              onBlur={() => commit()}
              onKeyDown={e => {
                const mod = e.ctrlKey || e.metaKey;
                if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); }
                else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*'); }
                else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); link(); }
                else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
                else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              }}
            />
            <div className="blk-tools" style={{ top: edit.top - 26, left: edit.left }} onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}>
              <button onClick={() => commit()}>✓ Keep (Enter)</button>
              <button className="soft" onClick={() => insertAfter('li')}>+ bullet below</button>
              <button className="soft" onClick={() => insertAfter('p')}>+ paragraph below</button>
              {tailor && <button className="ai" onClick={tailorFromEdit}>✨ Tailor</button>}
              <button className="soft" onClick={() => commit('')}>Delete</button>
              <button className="soft" onClick={() => setEdit(null)}>Cancel (Esc)</button>
            </div>
          </>
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
            <form className="rv-ask" onSubmit={e => { e.preventDefault(); startReview(review.i, body, review.instruction, review.tries); }}>
              <input className="input" placeholder="Wish (optional), e.g. shorter · mention SQL · more concrete" value={review.instruction}
                onChange={e => setReview({ ...review, instruction: e.target.value })} />
            </form>
            <div className="rv-btns">
              <button className="btn sm pri" disabled={review.state !== 'ready' || review.text === review.original} onClick={() => accept(review.text)}>Accept</button>
              <button className="btn sm" disabled={review.state !== 'ready'} onClick={editSuggestion}>Edit</button>
              <button className="btn sm" disabled={review.state === 'loading'} onClick={() => startReview(review.i, body, review.instruction, review.tries)}>Retry</button>
              <span className="sp" />
              <button className="btn sm" onClick={closeReview}>{review.state === 'ready' ? 'Reject' : 'Close'}</button>
            </div>
          </div>
        )}
      </div>
      {!readOnly && tailorMode && <p className="muted" style={{ textAlign: 'center', fontSize: 12, margin: '14px 0 0' }}>✨ Tailor mode: click a line to get a version tailored to this job. Nothing changes until you press Accept.</p>}
      {!readOnly && !tailorMode && <p className="muted" style={{ textAlign: 'center', fontSize: 12, margin: '14px 0 0' }}>Click any line to edit it. Markdown works: **bold**, *italic*, "- " for bullets, "## " for a section, "### Title | date" for an entry. Shift+Enter adds a line break.</p>}
    </div>
  );
}

function autosize(t: HTMLTextAreaElement) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }

export const pageCount = (h: number) => Math.max(1, Math.ceil(h / PAGE_H));

/** the type all selected lines share, or null when they differ */
const rangeKind = (bs: { type: string }[]): LineType | null => { const t = new Set(bs.filter(b => b.type !== 'hr').map(b => b.type)); return t.size === 1 ? [...t][0] as LineType : null; };
const LINE_PREFIX: Record<LineType, string> = { h1: '# ', h2: '## ', h3: '### ', li: '- ', p: '' };
const TYPES: [LineType, string, string][] = [['p', 'Text', 'Paragraph'], ['li', 'Bullet', 'Bullet point'], ['h2', 'Section', 'Section heading'], ['h3', 'Entry', 'Entry: "Title | dates", with the place on the next line']];
const SIZES = [85, 90, 95, 100, 105, 110, 115, 120];

/**
  Sticky bar above the page. Line tools (type, bold, italic, link) act on the open line, so they keep the
  textarea's focus (mousedown is cancelled). Size, spacing, alignment and margins apply to the whole
  document: a CV reads better when it is consistent, and these are what you adjust to fit a page.
*/
function FormatBar({ target, style, wrap, link, setType, divider, setStyle }: {
  /** the open line, or several selected lines (many > 0); null when nothing is selected */
  target: { type: LineType | null; many: number } | null; style: DocStyle;
  wrap: (m: string) => void; link: () => void; setType: (t: LineType) => void; divider: () => void;
  setStyle?: (s: DocStyle) => void;
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
  const hint = off ? 'Click a line on the page, or select several lines (drag across them, or Shift+click)' : undefined;
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
