import { parseBlocks } from './blocks';
import { cleanLook } from './look';
import type { PdfItem } from './pdftext';
import type { DocLook, TextLook } from './types';

/*
  A PDF's own look, as far as its text tells: which fonts and sizes the name, section headings, job titles and
  body use, the line spacing and the side margins. (A PDF's text carries no colours the reader can see.)
*/

/** "ABCDEF+TimesNewRomanPS-BoldMT" → "Times New Roman" */
export function fontFamily(postscript: string): string {
  const base = postscript.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0]
    .replace(/(PS)?MT$|PS$|Std$|Pro$|LT$/, '')
    .replace(/(Bold|Italic|Regular|Light|Medium|Semibold|SemiBold|Black|Oblique)+$/, '');
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').trim();
}

const norm = (s: string) => s.replace(/\*\*|\*|\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 30);

export function readPdfLook(pages: PdfItem[][], markdown: string): DocLook | undefined {
  const items = pages.flat().filter(i => i.str.trim());
  if (!items.length) return undefined;
  const key = (i: PdfItem) => `${i.font ?? ''}|${Math.round(i.size * 2) / 2}`;
  // the body: the font and size most of the characters are in
  const weight = new Map<string, number>();
  for (const i of items) weight.set(key(i), (weight.get(key(i)) ?? 0) + i.str.length);
  const bodyKey = [...weight].sort((a, b) => b[1] - a[1])[0][0];
  const body = items.find(i => key(i) === bodyKey)!;
  const look = (i: PdfItem | undefined, caps = false): TextLook | undefined => i && { font: i.font ? fontFamily(i.font) : undefined, size: Math.round(i.size * 2) / 2, bold: i.bold, caps };

  // the lines the import turned into the name, headings and titles
  const lines = new Map<string, PdfItem>();
  for (const i of items) { const k = norm(i.str); if (k && !lines.has(k)) lines.set(k, i); }
  const blocks = parseBlocks(markdown);
  const find = (text: string) => { const k = norm(text); return k ? lines.get(k) ?? [...lines].find(([l]) => l.startsWith(k) || k.startsWith(l))?.[1] : undefined; };
  const first = (type: string, text = (t: string) => t) => blocks.filter(b => b.type === type).map(b => ({ b, i: find(text(b.text)) })).find(x => x.i);
  const name = first('h1');
  const head = first('h2');
  const entry = first('h3', t => t.split(' | ')[0]);

  // line spacing: the usual distance between two body lines on a page
  const gaps: number[] = [];
  for (const page of pages) {
    const ys = [...new Set(page.filter(i => key(i) === bodyKey).map(i => Math.round(i.y)))].sort((a, b) => b - a);
    for (let k = 1; k < ys.length; k++) { const g = ys[k - 1] - ys[k]; if (g > body.size * 0.9 && g < body.size * 2) gaps.push(g); }
  }
  gaps.sort((a, b) => a - b);
  const lineHeight = gaps.length ? gaps[Math.floor(gaps.length / 2)] / body.size : undefined;
  // side margins: where the text starts on an A4 page (595 pt wide)
  const left = Math.min(...items.map(i => i.x));
  const right = 595 - Math.max(...items.map(i => i.x + i.w));
  const margin = Math.round((Math.max(0, Math.min(left, right > 0 ? right : left)) / 72) * 25.4);

  return cleanLook({
    body: look(body), name: look(name?.i), entry: look(entry?.i),
    heading: look(head?.i, !!head && head.b.text === head.b.text.toUpperCase() && /\p{L}/u.test(head.b.text)),
    lineHeight: lineHeight && Math.round(lineHeight * 100) / 100, after: 0, margin, align: 'left',
  });
}
