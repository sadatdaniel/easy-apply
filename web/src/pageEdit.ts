import { parseBlocks, type Block } from '@shared/blocks';
import { inline } from '@shared/render';

/*
  The page editor's link between the themed page (HTML from shared/render.ts, one element per block with
  data-b="<index>") and the document (Markdown blocks). The browser never changes the page itself: every
  edit is read as "replace this range with that", applied to the blocks, and the page is drawn again.

  Positions inside a block are counted in visible characters (what Range.toString() counts), so they
  survive a redraw even when bold or links change the HTML around them.
*/

const MARK = '';

/** a point in the page, as the browser reports it */
export interface Point { node: Node; offset: number }
/** where to put the caret after a redraw: `off` visible characters into block `b`, or `end` from its end */
export type Caret = { b: number; off: number; to?: { b: number; off: number }; later?: boolean } | { b: number; end: number; later?: boolean };

export const blockEl = (root: HTMLElement, i: number) => root.querySelector(`[data-b="${i}"]`) as HTMLElement | null;
export const blockOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest('[data-b]') as HTMLElement | null;
export const indexOf = (el: HTMLElement) => Number(el.dataset.b);

/** a block element's content as inline Markdown (markers included) */
export function elToMd(n: Node): string {
  if (n.nodeType === 3) return (n.nodeValue ?? '').replace(/​/g, '');
  if (!(n instanceof HTMLElement)) return '';
  if (n.tagName === 'BR') return n.hasAttribute('data-pad') ? '' : '\n';
  if (n.classList.contains('ph')) return `{{${n.textContent}}}`;
  const kids = () => [...n.childNodes].map(elToMd).join('');
  // entry header (title | dates) and contact line: parts joined back with the separator
  if (n.classList.contains('eh') || n.classList.contains('contact')) {
    const parts = [...n.childNodes].map(c => [c, elToMd(c)] as const);
    let out = '';
    parts.forEach(([c, s], k) => { out += k > 0 && c instanceof HTMLElement && parts[k - 1][0] instanceof HTMLElement ? ' | ' + s : s; });
    return out;
  }
  const inner = kids();
  if (!inner) return '';
  if (n.tagName === 'B' || n.tagName === 'STRONG') return `**${inner}**`;
  if (n.tagName === 'I' || n.tagName === 'EM') return `*${inner}*`;
  if (n.tagName === 'A') return `[${inner}](${n.getAttribute('href') ?? ''})`;
  return inner;
}

/** visible characters between the start of `el` and a point */
export function offsetIn(el: HTMLElement, p: Point): number {
  const r = document.createRange();
  r.setStart(el, 0);
  try { r.setEnd(p.node, p.offset); } catch { return 0; }
  return r.toString().length;
}
export const lengthOf = (el: HTMLElement) => { const r = document.createRange(); r.selectNodeContents(el); return r.toString().length; };

/**
  The block's Markdown cut at one or two points: [before, after] or [before, middle, after].
  Inline marks cut in half are closed and reopened, so "**Bo|ld**" splits into "**Bo**" and "**ld**".
*/
export function cut(el: HTMLElement, a: Point, b?: Point): string[] {
  // work on a copy: the page itself stays as it is, so the same points can be read again
  const copy = el.cloneNode(true) as HTMLElement;
  const into = (p: Point): Point => {
    const path: number[] = [];
    for (let n: Node = p.node; n !== el; n = n.parentNode!) { if (!n.parentNode) return { node: copy, offset: 0 }; path.unshift([...n.parentNode.childNodes].indexOf(n as ChildNode)); }
    return { node: path.reduce<Node>((n, i) => n.childNodes[i], copy), offset: p.offset };
  };
  const ranges = [a, b].filter((p): p is Point => !!p).map(p => { const q = into(p); const r = document.createRange(); r.setStart(q.node, q.offset); return r; });
  // insert the later marker first; live ranges follow the change
  for (const r of [...ranges].reverse()) r.insertNode(document.createTextNode(MARK));
  const md = elToMd(copy);
  const parts = md.split(MARK);
  return parts.length === ranges.length + 1 ? balance(parts) : [md, ...ranges.map(() => '')];
}

/** close inline marks left open at the end of a piece and reopen them in the next */
function balance(parts: string[]): string[] {
  const out = [...parts];
  const ends = (s: string, m: string) => s.endsWith(m) && (m === '**' || !s.endsWith('**'));
  const starts = (s: string, m: string) => s.startsWith(m) && (m === '**' || !s.startsWith('**'));
  for (let k = 0; k < out.length - 1; k++) {
    for (const m of ['**', '*']) {
      if (count(out[k], m) % 2 === 0) continue;
      // a mark opened right at the cut is dropped rather than closed empty ("**" + "**")
      out[k] = ends(out[k], m) ? out[k].slice(0, -m.length) : out[k] + m;
      out[k + 1] = starts(out[k + 1], m) ? out[k + 1].slice(m.length) : m + out[k + 1];
    }
  }
  return out;
}
const count = (s: string, m: string) => m === '**' ? (s.match(/\*\*/g) ?? []).length : (s.replace(/\*\*/g, '').match(/\*/g) ?? []).length;

/** where a page point lands among the blocks; points outside any block snap to the nearest one */
export function resolve(root: HTMLElement, p: Point, side: 'start' | 'end'): { el: HTMLElement; point: Point } | null {
  const own = blockOf(p.node);
  if (own && root.contains(own)) {
    if (own.tagName === 'HR') return { el: own, point: { node: own.parentNode!, offset: [...own.parentNode!.childNodes].indexOf(own) } };
    return { el: own, point: p };
  }
  const all = [...root.querySelectorAll<HTMLElement>('[data-b]')];
  const probe = document.createRange();
  probe.setStart(p.node, p.offset);
  const after = all.filter(el => probe.comparePoint(el, 0) >= 0);
  const pick = side === 'start' ? after[0] ?? all[all.length - 1] : all.filter(el => !after.includes(el)).pop() ?? all[0];
  if (!pick) return null;
  const atStart = side === 'start' && after.includes(pick);
  return { el: pick, point: { node: pick, offset: atStart ? 0 : pick.childNodes.length } };
}

/** puts the caret (or a selection) back after a redraw */
export function placeCaret(root: HTMLElement, c: Caret) {
  const el = blockEl(root, c.b);
  if (!el) return;
  const point = (target: HTMLElement, off: number, later = false): Point => {
    const walk = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let acc = 0;
    for (let t = walk.nextNode() as Text | null; t; t = walk.nextNode() as Text | null) {
      const len = t.length;
      if (off < acc + len || (off === acc + len && !later)) {
        // never inside a placeholder chip: just after it
        const chip = t.parentElement?.closest('[contenteditable="false"]');
        if (chip && target.contains(chip)) return { node: chip.parentNode!, offset: [...chip.parentNode!.childNodes].indexOf(chip as ChildNode) + 1 };
        return { node: t, offset: off - acc };
      }
      acc += len;
    }
    if (off <= 0 && !later) return { node: target, offset: 0 };
    const pad = target.lastChild instanceof HTMLElement && target.lastChild.hasAttribute('data-pad') ? 1 : 0;
    return { node: target, offset: target.childNodes.length - pad };
  };
  const start = 'end' in c ? point(el, Math.max(0, lengthOf(el) - c.end), c.later) : point(el, c.off, c.later);
  const sel = getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.setStart(start.node, start.offset);
  if ('to' in c && c.to) {
    const el2 = blockEl(root, c.to.b);
    if (el2) { const e = point(el2, c.to.off, true); try { r.setEnd(e.node, e.offset); } catch { /* keep it collapsed */ } }
  }
  sel.removeAllRanges();
  sel.addRange(r);
}

/** after a redraw: chips and generated headings can't be typed into; empty lines get room for the caret */
export function prepare(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.ph, h2:not([data-b])').forEach(e => { e.contentEditable = 'false'; });
  root.querySelectorAll<HTMLElement>('[data-b]').forEach(el => {
    if (el.tagName === 'HR') { el.contentEditable = 'false'; return; }
    if (el.querySelector('[data-pad]')) return;
    // an empty line, or a line ending in a line break, needs one more <br> to show (and hold) the caret
    const last = el.lastChild;
    if (!el.textContent || (last instanceof HTMLElement && last.tagName === 'BR')) {
      const pad = document.createElement('br');
      pad.setAttribute('data-pad', '');
      (el.matches('.eh') ? el.firstElementChild ?? el : el).append(pad);
    }
  });
}

/* ---------- clipboard ---------- */
export const MD_TYPE = 'application/x-easy-apply-md';

export function blocksToHtml(bs: Block[]): string {
  let out = '', list = false;
  for (const b of bs) {
    if (b.type === 'li' && !list) { out += '<ul>'; list = true; }
    if (b.type !== 'li' && list) { out += '</ul>'; list = false; }
    const t = inline(b.text).replace(/<span class="ph">([^<]*)<\/span>/g, '{{$1}}');
    out += b.type === 'hr' ? '<hr>' : b.type === 'li' ? `<li>${t}</li>` : b.type === 'p' ? `<p>${t}</p>` : `<${b.type}>${t}</${b.type}>`;
  }
  return out + (list ? '</ul>' : '');
}

export function blocksToText(bs: Block[]): string {
  const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  return bs.map(b => b.type === 'hr' ? '———' : b.type === 'li' ? '• ' + plain(b.text) : plain(b.text.replace(/ \| /g, b.type === 'h3' ? '   ' : ' | '))).join('\n');
}

/** pasted HTML (Word, Google Docs, a web page, another document) → blocks */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, meta, title, head').forEach(e => e.remove());
  const out: Block[] = [];
  const BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|HR|TABLE|TR|TD|TH|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER|PRE)$/;
  const BLOCK_SEL = 'p, div, h1, h2, h3, h4, h5, h6, li, ul, ol, hr, table, blockquote, section, article, pre';
  const inl = (n: Node): string => {
    if (n.nodeType === 3) return (n.nodeValue ?? '').replace(/\s+/g, ' ');
    if (!(n instanceof Element)) return '';
    if (n.tagName === 'BR') return '\n';
    const inner = [...n.childNodes].map(inl).join('');
    const t = inner.trim();
    if (!t) return inner;
    const style = n.getAttribute('style') ?? '';
    const bold = n.tagName === 'B' || n.tagName === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(style);
    const ital = n.tagName === 'I' || n.tagName === 'EM' || /font-style:\s*italic/.test(style);
    const keep = (s: string, m: string) => inner.match(/^\s*/)![0] + m + s + m + inner.match(/\s*$/)![0];
    if (n.tagName === 'A') { const h = n.getAttribute('href') ?? ''; return /^(https?:|mailto:)/.test(h) ? `[${t}](${h})` : inner; }
    // Google Docs wraps everything in <b style="font-weight:normal">
    if (n.tagName === 'B' && /font-weight:\s*normal/.test(style)) return inner;
    if (bold) return keep(t, '**');
    if (ital) return keep(t, '*');
    return inner;
  };
  const push = (type: Block['type'], md: string) => {
    const text = md.split('\n').map(l => l.trim()).join('\n').replace(/\n{2,}/g, '\n').trim();
    if (type === 'hr') out.push({ type, text: '' });
    else if (text) out.push({ type, text: type === 'li' ? text.replace(/^[•●▪◦\-–]\s*/, '') : text });
  };
  const walk = (el: Element) => {
    let run = '';
    const flush = () => { if (run.trim()) push('p', run); run = ''; };
    for (const n of el.childNodes) {
      if (n instanceof Element && BLOCK.test(n.tagName)) {
        flush();
        const tag = n.tagName;
        if (tag === 'HR') push('hr', '');
        else if (/^H[1-2]$/.test(tag)) push('h2', inl(n));
        else if (/^H[3-6]$/.test(tag)) push('h3', inl(n));
        else if (tag === 'LI') { push('li', inl(n)); }
        else if (tag === 'TR') push('p', [...n.children].map(c => inl(c).trim()).filter(Boolean).join(' | '));
        else if ([...n.children].some(c => BLOCK.test(c.tagName))) walk(n);
        else push(/^\s*[•●▪◦]\s/.test(n.textContent ?? '') ? 'li' : 'p', inl(n));
      } else if (n instanceof Element && n.querySelector(BLOCK_SEL)) { flush(); walk(n); } // Google Docs wraps everything in one <b>
      else run += inl(n);
    }
    flush();
  };
  walk(doc.body);
  return out;
}

/** pasted plain text → blocks: one block per line, "- " and "•" become bullets */
export function textToBlocks(text: string): Block[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
    .flatMap(l => /^[•●▪◦]\s*/.test(l) ? [{ type: 'li' as const, text: l.replace(/^[•●▪◦]\s*/, '') }] : parseBlocks(l));
}
