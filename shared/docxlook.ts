import { parseBlocks, type Block } from './blocks';
import { cleanLook } from './look';
import type { DocLook, TextLook } from './types';

/*
  Reads a Word file's own look: which fonts, sizes, colours and spacing its name, section headings, job titles
  and body text use. Word keeps this in layers (document defaults → styles → the paragraph → the run), so each
  paragraph's look is worked out through them. The paragraphs are then matched to what the import made of
  them (name, heading, entry, text), and the most common look of each kind wins.
*/

export interface DocxXml { document: string; styles?: string; theme?: string }
type Parse = (xml: string) => Document;

type RunLook = TextLook;
interface ParaLook { jc?: string; line?: number; lineRule?: string; after?: number; rule?: boolean }

const kid = (el: Element | null | undefined, name: string) => (el ? [...el.children].find(c => c.tagName === 'w:' + name) ?? null : null);
const val = (el: Element | null | undefined, name = 'val') => el?.getAttribute('w:' + name) ?? null;
const on = (el: Element | null) => (el ? !['0', 'false', 'off'].includes(val(el) ?? '') : undefined);

function readRun(rPr: Element | null, themeFont: (t: string) => string | undefined): RunLook {
  if (!rPr) return {};
  const f = kid(rPr, 'rFonts');
  const sz = val(kid(rPr, 'sz'));
  const c = val(kid(rPr, 'color'));
  return {
    font: val(f, 'ascii') ?? val(f, 'hAnsi') ?? (val(f, 'asciiTheme') ? themeFont(val(f, 'asciiTheme')!) : undefined) ?? undefined,
    size: sz ? Number(sz) / 2 : undefined,
    color: c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c.toLowerCase() : undefined,
    bold: on(kid(rPr, 'b')), caps: on(kid(rPr, 'caps')), italic: on(kid(rPr, 'i')),
  };
}
function readPara(pPr: Element | null): ParaLook {
  if (!pPr) return {};
  const sp = kid(pPr, 'spacing');
  const jc = val(kid(pPr, 'jc'));
  return {
    jc: jc ?? undefined,
    line: val(sp, 'line') ? Number(val(sp, 'line')) : undefined,
    lineRule: val(sp, 'lineRule') ?? undefined,
    after: val(sp, 'after') ? Number(val(sp, 'after')) / 20 : undefined,
    rule: kid(kid(pPr, 'pBdr'), 'bottom') ? true : undefined,
  };
}
/** later layers win, where they say something */
const over = <T extends object>(...layers: T[]): T => Object.assign({}, ...layers.map(l => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined))));

const norm = (s: string) => s.replace(/\*\*|\*|\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40);

export function readDocxLook(xml: DocxXml, markdown: string, parse: Parse): DocLook | undefined {
  const doc = parse(xml.document);
  const styles = xml.styles ? parse(xml.styles) : null;
  const theme = xml.theme ? parse(xml.theme) : null;

  // the theme's two fonts: "major" for headings, "minor" for text
  const themeFace = (which: 'major' | 'minor') => theme?.getElementsByTagName(`a:${which}Font`)[0]?.getElementsByTagName('a:latin')[0]?.getAttribute('typeface') ?? undefined;
  const themeFont = (t: string) => (/^major/i.test(t) ? themeFace('major') : themeFace('minor'));

  // styles: each with what it is based on
  const defs = styles?.getElementsByTagName('w:docDefaults')[0];
  const base = {
    run: readRun(kid(kid(defs, 'rPrDefault'), 'rPr'), themeFont),
    para: readPara(kid(kid(defs, 'pPrDefault'), 'pPr')),
  };
  const byId = new Map<string, Element>();
  let normal: string | null = null;
  for (const s of styles ? [...styles.getElementsByTagName('w:style')] : []) {
    const id = val(s, 'styleId');
    if (id) byId.set(id, s);
    if (val(s, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(s.getAttribute('w:default') ?? '')) normal ??= id;
  }
  const chain = (id: string | null, seen = new Set<string>()): Element[] => {
    const s = id ? byId.get(id) : undefined;
    if (!s || seen.has(id!)) return [];
    seen.add(id!);
    return [...chain(val(kid(s, 'basedOn')), seen), s];
  };
  const styleRun = (id: string | null) => over<RunLook>({}, ...chain(id).map(s => readRun(kid(s, 'rPr'), themeFont)));
  const stylePara = (id: string | null) => over<ParaLook>({}, ...chain(id).map(s => readPara(kid(s, 'pPr'))));

  // every paragraph with text: its text and its look
  const paras: { key: string; run: RunLook; para: ParaLook }[] = [];
  for (const p of [...doc.getElementsByTagName('w:p')]) {
    const text = [...p.getElementsByTagName('w:t')].map(t => t.textContent ?? '').join('');
    if (!text.trim()) continue;
    const pPr = kid(p, 'pPr');
    const sid = val(kid(pPr, 'pStyle')) ?? normal;
    const first = [...p.getElementsByTagName('w:r')].find(r => [...r.getElementsByTagName('w:t')].some(t => (t.textContent ?? '').trim()));
    const rPr = kid(first, 'rPr');
    paras.push({
      key: norm(text),
      run: over<RunLook>(base.run, styleRun(sid), styleRun(val(kid(rPr, 'rStyle'))), readRun(rPr, themeFont)),
      para: over<ParaLook>(base.para, stylePara(sid), readPara(pPr)),
    });
  }
  if (!paras.length) return undefined;
  const find = (text: string) => { const k = norm(text); return k ? paras.find(p => p.key === k || (k.length > 12 && p.key.startsWith(k.slice(0, 30)))) : undefined; };

  // what the import made of them
  const blocks: Block[] = parseBlocks(markdown);
  const firstH2 = blocks.findIndex(b => b.type === 'h2');
  const of = (pick: (b: Block, i: number) => boolean, text = (b: Block) => b.text) =>
    blocks.map((b, i) => (pick(b, i) ? find(text(b)) : undefined)).filter((x): x is NonNullable<typeof x> => !!x);
  const name = of(b => b.type === 'h1');
  const heads = of(b => b.type === 'h2');
  const entries = of(b => b.type === 'h3', b => b.text.split(' | ')[0]);
  const body = of((b, i) => (b.type === 'p' || b.type === 'li') && !(i < firstH2 && b.text.includes(' | ')));

  /** the look most of them share */
  const common = (list: typeof paras): typeof paras[number] | undefined => {
    const count = new Map<string, { n: number; p: typeof paras[number] }>();
    for (const p of list) {
      const k = JSON.stringify([p.run.font, p.run.size, p.run.color, p.run.bold, p.run.caps]);
      const c = count.get(k) ?? { n: 0, p };
      c.n++; count.set(k, c);
    }
    return [...count.values()].sort((a, b) => b.n - a.n)[0]?.p;
  };
  const text = (p: typeof paras[number] | undefined): TextLook | undefined => p && { font: p.run.font, size: p.run.size, color: p.run.color, bold: p.run.bold ?? false, caps: p.run.caps ?? false, italic: p.run.italic ?? false };

  const b = common(body) ?? { key: '', run: over<RunLook>(base.run, styleRun(normal)), para: over<ParaLook>(base.para, stylePara(normal)) };
  const size = b.run.size ?? 10;
  // Word's "single" spacing is the font's own line height, a little more than the type size
  const lineHeight = b.para.lineRule === 'exact' || b.para.lineRule === 'atLeast'
    ? (b.para.line ?? 240) / 20 / size
    : ((b.para.line ?? 240) / 240) * 1.17;
  const sect = [...doc.getElementsByTagName('w:sectPr')].pop();
  const mar = kid(sect, 'pgMar');
  const side = [val(mar, 'left'), val(mar, 'right')].map(Number).filter(n => n > 0);
  const h = common(heads);

  return cleanLook({
    body: text(b), name: text(common(name)), entry: text(common(entries)),
    heading: h && { ...text(h), rule: heads.some(x => x.para.rule) },
    lineHeight: Math.round(lineHeight * 100) / 100,
    after: b.para.after ?? 0,
    margin: side.length ? Math.round((side.reduce((a, c) => a + c, 0) / side.length / 1440) * 25.4) : undefined,
    align: b.para.jc === 'both' ? 'justify' : 'left',
  });
}

/**
  Paragraph styles that make their text bold. A heading is often bold only through its style ("Section",
  "CV Heading" …), which the Word reader leaves out; the import needs to know, to tell headings from text.
*/
export function boldParagraphStyles(stylesXml: string, parse: Parse): string[] {
  const styles = parse(stylesXml);
  const byId = new Map<string, Element>();
  for (const s of [...styles.getElementsByTagName('w:style')]) { const id = val(s, 'styleId'); if (id) byId.set(id, s); }
  const bold = (id: string | null, seen = new Set<string>()): boolean | undefined => {
    const s = id ? byId.get(id) : undefined;
    if (!s || seen.has(id!)) return undefined;
    seen.add(id!);
    return on(kid(kid(s, 'rPr'), 'b')) ?? bold(val(kid(s, 'basedOn')), seen);
  };
  return [...byId.entries()]
    .filter(([id, s]) => val(s, 'type') === 'paragraph' && !/^(heading|title)/i.test(id) && bold(id))
    .map(([, s]) => val(kid(s, 'name')))
    .filter((n): n is string => !!n && !/^heading \d|^title$/i.test(n));
}
