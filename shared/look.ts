import type { DocLook, TextLook } from './types';

/*
  "Your file's own look": the fonts, sizes and colours read from an uploaded Word file (docxlook.ts), stored in
  the document's frontmatter and drawn by the .t-original design in themes.css through CSS variables.
  The values come from a file, so each is checked before it gets near a style attribute.
*/

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : undefined);
const font = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .&'-]/gu, '').trim().slice(0, 48) || undefined : undefined);
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
const flag = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

function cleanText(t: unknown, maxSize: number): TextLook | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const x = t as Record<string, unknown>;
  const out: TextLook = { font: font(x.font), size: num(x.size, 6, maxSize), color: color(x.color), bold: flag(x.bold), caps: flag(x.caps), italic: flag(x.italic) };
  for (const k of Object.keys(out) as (keyof TextLook)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** a look read from a file (or a hand-edited frontmatter), with anything odd left out */
export function cleanLook(v: unknown): DocLook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const x = v as Record<string, unknown>;
  const out: DocLook = {
    body: cleanText(x.body, 24), name: cleanText(x.name, 72), entry: cleanText(x.entry, 30),
    heading: cleanText(x.heading, 36),
    lineHeight: num(x.lineHeight, 0.9, 2.5), after: num(x.after, 0, 24), margin: num(x.margin, 5, 40),
    align: x.align === 'justify' || x.align === 'left' ? x.align : undefined,
  };
  if (out.heading && x.heading && (x.heading as Record<string, unknown>).rule === true) out.heading.rule = true;
  for (const k of Object.keys(out) as (keyof DocLook)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

// Word fonts with a free look-alike the app ships: the same letter widths (so the same line breaks), except
// EB Garamond, the same design only; Arial and Times New Roman have theirs (Arimo, Tinos) in every stack below
const LOOK_ALIKE: [RegExp, string][] = [[/^calibri/i, 'Carlito'], [/^cambria/i, 'Caladea'], [/^georgia/i, 'Gelasio'], [/garamond/i, 'EB Garamond']];

/** a font with a close stand-in that ships with the app, for computers that don't have it */
function stack(f: string) {
  const serif = /times|garamond|georgia|cambria|book|palatino|baskerville|minion|caslon|serif|didot|bodoni|constantia/i.test(f) && !/sans/i.test(f);
  const twin = LOOK_ALIKE.find(([re]) => re.test(f))?.[1];
  return `"${f}", ${twin && twin.toLowerCase() !== f.toLowerCase() ? `"${twin}", ` : ''}${serif ? 'Tinos, "Times New Roman", serif' : 'Arimo, Arial, sans-serif'}`;
}
const pt = (n: number) => `${n}pt`;

/** the look as CSS variables for the page's style attribute (every value already checked by cleanLook) */
export function lookVars(look: DocLook | undefined): string {
  const l = cleanLook(look);
  if (!l) return '';
  const v: string[] = [];
  const text = (prefix: string, t: TextLook | undefined) => {
    if (!t) return;
    if (t.font) v.push(`--o-${prefix}font:${stack(t.font)}`);
    if (t.size) v.push(`--o-${prefix}size:${pt(t.size)}`);
    if (t.color) v.push(`--o-${prefix}color:${t.color}`);
    if (t.bold !== undefined) v.push(`--o-${prefix}weight:${t.bold ? 700 : 400}`);
    if (t.caps !== undefined) v.push(`--o-${prefix}case:${t.caps ? 'uppercase' : 'none'}`);
    if (t.italic !== undefined) v.push(`--o-${prefix}style:${t.italic ? 'italic' : 'normal'}`);
  };
  text('', l.body);
  text('name-', l.name);
  text('h-', l.heading);
  text('e-', l.entry);
  if (l.heading?.rule) v.push('--o-h-rule:1px solid currentColor', '--o-h-pad:2px');
  if (l.lineHeight) v.push(`--o-lh:${l.lineHeight}`);
  if (l.after !== undefined) v.push(`--o-after:${pt(l.after)}`);
  if (l.margin) v.push(`--o-mx:${l.margin}mm`);
  if (l.align) v.push(`--o-align:${l.align}`);
  return v.join(';').replace(/"/g, '&quot;');
}
