/*
  PDF text (positioned pieces from pdf.js) → simple HTML the Word importer already understands
  (p / strong / ul-li / one-row tables), split into documents when one PDF holds several
  (a cover letter followed by a CV is common).

  PDFs have no paragraphs, only positioned runs of text: justified lines come word by word and
  ligatures arrive split ("Beru" "fl" "icher"), so lines are rebuilt from positions:
    - same baseline → same line; pieces close together join, a wide gap starts a new column (dates on the right)
    - a line starting with ● • ▪ – etc. is a bullet; a following line indented like its text continues it
    - consecutive full-width lines with the same left edge and size are one wrapped paragraph
    - a line in a bold font is bold; the largest line at the top of a document is the name
*/
export interface PdfItem { str: string; x: number; y: number; w: number; size: number; bold: boolean }
export interface PdfPart { pages: number[]; html: string }

interface Line { x: number; y: number; right: number; size: number; bold: boolean; cells: string[]; page: number }

const BULLET = /^[●•▪◦○■□►▸‣∙·–-]\s*$/;
const BULLET_START = /^[●•▪◦○■□►▸‣∙·]\s*/;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toLines(items: PdfItem[], page: number): Line[] {
  const rows: PdfItem[][] = [];
  // whitespace pieces can stretch across a column gap (to a right-aligned date); words are spaced by position instead
  for (const it of [...items].filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r[0].y - it.y) <= Math.max(2, it.size * 0.25));
    row ? row.push(it) : rows.push([it]);
  }
  return rows.map(r => {
    r.sort((a, b) => a.x - b.x);
    const size = Math.max(...r.map(i => i.size));
    const cells: string[] = [''];
    let end = r[0].x;
    for (const it of r) {
      const gap = it.x - end;
      if (gap > Math.max(36, size * 3.5) && cells[cells.length - 1].trim()) cells.push('');
      else if (gap > size * 0.15 && cells[cells.length - 1] && !/\s$/.test(cells[cells.length - 1])) cells[cells.length - 1] += ' ';
      cells[cells.length - 1] += it.str;
      end = Math.max(end, it.x + it.w);
    }
    const textItems = r.filter(i => i.str.trim() && !BULLET.test(i.str.trim()));
    return {
      x: r[0].x, y: r[0].y, right: end, size, page,
      bold: textItems.length > 0 && textItems.every(i => i.bold),
      cells: cells.map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean),
    };
  }).filter(l => l.cells.length);
}

/** a new document starts on a page whose first line is a big, bold name-like line */
function startsDocument(first: Line | undefined, body: number) {
  return !!first && first.bold && first.size >= body * 1.25 && first.cells.length === 1 && first.cells[0].split(/\s+/).length <= 6;
}

export function pdfToHtml(pages: PdfItem[][]): PdfPart[] {
  const all = pages.map((items, i) => toLines(items, i + 1));
  const sizes = all.flat().map(l => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] ?? 10;
  const parts: Line[][] = [];
  all.forEach((lines, i) => { if (!parts.length || (i > 0 && startsDocument(lines[0], body))) parts.push([]); parts[parts.length - 1].push(...lines); });
  return parts.filter(p => p.length).map(lines => ({ pages: [...new Set(lines.map(l => l.page))], html: linesToHtml(lines, body) }));
}

function linesToHtml(lines: Line[], body: number): string {
  const out: string[] = [];
  const maxRight = Math.max(...lines.map(l => l.right));
  const letter = /\b(dear|sehr geehrte|kind regards|best regards|warm regards|sincerely|mit freundlichen grüßen)\b/i.test(lines.map(l => l.cells.join(' ')).join(' '));
  let list: string[] | null = null;
  let bulletX = 0;
  let para: { text: string; x: number; size: number; lastY: number; full: boolean } | null = null;
  const flushList = () => { if (list) { out.push(`<ul>${list.map(li => `<li>${li}</li>`).join('')}</ul>`); list = null; } };
  const flushPara = () => { if (para) { out.push(`<p>${esc(para.text)}</p>`); para = null; } };
  let headerDone = !letter;

  lines.forEach((l, i) => {
    const text = l.cells.join(' ');
    const prev = lines[i - 1];
    // the name: the biggest line at the top
    if (i === 0 && l.size >= body * 1.2) { out.push(`<h1>${esc(text)}</h1>`); return; }
    // bullets and their continuation lines
    if (BULLET_START.test(text) || (l.cells.length > 1 && BULLET.test(l.cells[0]))) {
      flushPara();
      const t = text.replace(BULLET_START, '').replace(/^[–-]\s+/, '');
      (list ??= []).push(esc(t));
      bulletX = l.cells.length > 1 ? l.x + 12 : l.x;
      return;
    }
    if (list && prev && prev.page === l.page && Math.abs(prev.y - l.y) <= l.size * 1.8 && l.x > (lines.find(x => x === prev)?.x ?? 0) + 4 && Math.abs(l.x - bulletX) < 24 && !l.bold) {
      list[list.length - 1] += ' ' + esc(text);
      return;
    }
    flushList();
    // two or more columns: "Company | dates", "Project | stack"
    if (l.cells.length > 1) {
      flushPara();
      out.push(`<table><tr>${l.cells.map(c => `<td><p>${l.bold ? `<strong>${esc(c)}</strong>` : esc(c)}</p></td>`).join('')}</tr></table>`);
      return;
    }
    if (l.bold) { flushPara(); out.push(`<p><strong>${esc(text)}</strong></p>`); return; }
    // wrapped paragraph lines join up; short lines (addresses, header lines) stay separate
    const full = l.right >= maxRight * 0.8;
    if (para && para.full && prev && prev.page === l.page && Math.abs(para.x - l.x) < 4 && para.size === l.size && para.lastY - l.y <= l.size * 1.8) {
      para.text += (/-$/.test(para.text) && /^\p{Ll}/u.test(text) ? '' : ' ') + text;
      para.lastY = l.y; para.full = full;
      return;
    }
    flushPara();
    para = { text, x: l.x, size: l.size, lastY: l.y, full };
    // a letter's own address block ends with the line holding the email or phone: mark it off
    if (!headerDone && /[\w.+-]+@[\w-]+\.|\+?\d[\d\s()/-]{6,}\d/.test(text)) { flushPara(); out.push('<hr>'); headerDone = true; }
  });
  flushList(); flushPara();
  return out.join('\n');
}

/** the parts of a pdf.js document this needs (same API in the browser and in Node's legacy build) */
interface PdfJsDoc {
  numPages: number;
  getPage(n: number): Promise<{
    getOperatorList(): Promise<unknown>;
    getTextContent(): Promise<{ items: unknown[] }>;
    commonObjs: { has(id: string): boolean; get(id: string): { name?: string } };
  }>;
}

/** positioned text of every page; bold comes from the font's name (e.g. "ABCDEF+FiraSans-Bold") */
export async function pdfItems(doc: PdfJsDoc, maxPages = 12): Promise<PdfItem[][]> {
  const pages: PdfItem[][] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    await page.getOperatorList(); // loads the fonts, so their names are known
    const { items } = await page.getTextContent();
    pages.push((items as { str?: string; transform?: number[]; width?: number; fontName?: string }[])
      .filter(i => typeof i.str === 'string' && Array.isArray(i.transform))
      .map(i => {
        const font = i.fontName && page.commonObjs.has(i.fontName) ? page.commonObjs.get(i.fontName).name ?? '' : '';
        return { str: i.str!, x: i.transform![4], y: i.transform![5], w: i.width ?? 0, size: Math.abs(i.transform![3]) || Math.abs(i.transform![0]), bold: /bold|black|heavy|semibold|demi/i.test(font) };
      }));
  }
  return pages;
}
