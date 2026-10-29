import type { Block } from './blocks';
import type { DocKind, DocStyle } from './types';

// Themes are CSS (web/src/themes.css). The only layout decision a theme makes here is
// whether some sections move into a side column.
export const THEMES: Record<string, { name: string; layout: 'single' | 'sidebar'; fonts: string; note: string }> = {
  classic:  { name: 'Classic',  layout: 'single',  fonts: 'Fira Sans + Roboto · letter: Arial', note: 'Clean sans-serif with a slim header; the letter uses Arial.' },
  sidebar:  { name: 'Sidebar',  layout: 'sidebar', fonts: 'Poppins + Open Sans', note: 'Skills, education and languages in a side column.' },
  serif:    { name: 'Serif',    layout: 'single',  fonts: 'Fraunces + Source Serif', note: 'Calm and editorial.' },
  academic: { name: 'Academic', layout: 'single',  fonts: 'Times New Roman', note: 'Times 10pt with grey section rules.' },
};

const SIDE_SECTIONS = /skill|education|certif|language|interest|fähigkeit|kenntnis|ausbildung|bildung|zertifikat|sprache/i;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inline(md: string): string {
  return esc(md)
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, '<span class="ph">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
}

const at = (i: number) => ` data-b="${i}"`;

/** "Title | right side" → [title, right] */
function splitRight(text: string): [string, string] {
  const k = text.lastIndexOf(' | ');
  return k < 0 ? [text, ''] : [text.slice(0, k), text.slice(k + 3)];
}

interface Section { title: string; idx: number; html: string }

function renderSections(blocks: Block[], from: number): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  let entry: string[] | null = null;   // open .entry parts
  let hasOrg = false;
  let list: string[] | null = null;    // open <ul>

  const closeList = () => { if (list) { (entry ?? sink()).push(`<ul>${list.join('')}</ul>`); list = null; } };
  const closeEntry = () => { closeList(); if (entry && cur) { cur.html += `<div class="entry${hasOrg ? ' has-org' : ''}">${entry.join('')}</div>`; } entry = null; hasOrg = false; };
  const loose: string[] = [];
  const sink = () => loose;
  const flushLoose = () => { if (cur && loose.length) { cur.html += loose.join(''); loose.length = 0; } };

  for (let i = from; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'h2') {
      closeEntry(); flushLoose();
      cur = { title: b.text, idx: i, html: '' };
      out.push(cur);
      continue;
    }
    if (!cur) { cur = { title: '', idx: -1, html: '' }; out.push(cur); }
    if (b.type === 'h3') {
      closeEntry(); flushLoose();
      const [t, r] = splitRight(b.text);
      entry = [`<div class="eh"${at(i)}><span class="et">${inline(t)}</span>${r ? `<span class="ed">${inline(r)}</span>` : ''}</div>`];
      continue;
    }
    if (b.type === 'li') { (list ??= []).push(`<li${at(i)}>${inline(b.text)}</li>`); continue; }
    closeList();
    if (b.type === 'p') {
      if (entry && !entry.some(x => x.startsWith('<ul'))) { entry.push(`<div class="eo"${at(i)}>${inline(b.text)}</div>`); hasOrg = true; }
      else { closeEntry(); loose.push(`<p${at(i)}>${inline(b.text)}</p>`); }
    } else if (b.type === 'hr') { closeEntry(); loose.push(`<hr${at(i)}>`); }
    flushLoose();
  }
  closeEntry(); flushLoose();
  return out;
}

const sectionHtml = (s: Section) => s.idx < 0 ? s.html : `<section><h2${at(s.idx)}>${inline(s.title)}</h2>${s.html}</section>`;

export function renderDoc(blocks: Block[], themeName: string, kind: DocKind, lang = 'en', style: DocStyle = {}): string {
  // the theme name ends up in a class attribute: only known names, never text from a file
  const theme = Object.hasOwn(THEMES, themeName) ? themeName : 'classic';
  const t = THEMES[theme];
  const html = kind === 'cover' ? renderLetter(blocks, theme, t.layout) : renderCV(blocks, theme, t.layout, lang);
  return applyStyle(html, style);
}

/** The formatting bar's whole-document settings become classes and CSS variables on the sheet (see themes.css). */
function applyStyle(html: string, s: DocStyle): string {
  // values come from a file's frontmatter: numbers within range and known words only
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : 0);
  const size = num(s.size, 70, 140), lh = num(s.lineHeight, 1, 2);
  const align = s.align === 'left' || s.align === 'justify' ? s.align : '';
  const margins = s.margins === 'narrow' || s.margins === 'wide' ? s.margins : '';
  const cls = [size && size !== 100 ? 'st-size' : '', lh ? 'st-lh' : '', align ? `st-${align}` : '', margins ? `st-${margins}` : ''].filter(Boolean);
  if (!cls.length) return html;
  const vars = [size ? `--st-size:${size / 100}` : '', lh ? `--st-lh:${lh}` : ''].filter(Boolean).join(';');
  return html.replace(/^<div class="sheet ([^"]*)"/, `<div class="sheet $1 ${cls.join(' ')}"${vars ? ` style="${vars}"` : ''}`);
}

function renderCV(blocks: Block[], theme: string, layout: string, lang: string): string {
  // header: everything before the first ## heading
  let i = 0, name = '', tagline = '', contact = '', rule = '';
  const summary: string[] = [];
  for (; i < blocks.length && blocks[i].type !== 'h2'; i++) {
    const b = blocks[i];
    if (b.type === 'h1') name = `<h1${at(i)}>${inline(b.text)}</h1>`;
    else if (b.type === 'p' && b.text.includes(' | ') && !contact)
      contact = `<div class="contact"${at(i)}>${b.text.split(' | ').map(c => `<span>${inline(c.trim())}</span>`).join('')}</div>`;
    else if (b.type === 'p' && !contact && !tagline) tagline = `<div class="tag"${at(i)}>${inline(b.text)}</div>`;
    else if (b.type === 'li') {
      // bullets above the first section: one list, like anywhere else
      const li = `<li${at(i)}>${inline(b.text)}</li>`;
      if (summary.length && summary[summary.length - 1].startsWith('<ul')) summary[summary.length - 1] = summary[summary.length - 1].replace(/<\/ul>$/, li + '</ul>');
      else summary.push(`<ul class="summary">${li}</ul>`);
    }
    // a divider right under the name and contact line is the header's own line (the design draws it in its style)
    else if (b.type === 'hr' && !summary.length && !rule) rule = `<hr class="lh-rule"${at(i)}>`;
    else if (b.type === 'hr') summary.push(`<hr${at(i)}>`);
    else summary.push(`<p class="summary"${at(i)}>${inline(b.text)}</p>`);
  }
  const sections = renderSections(blocks, i);

  if (layout === 'sidebar') {
    const side = sections.filter(s => SIDE_SECTIONS.test(s.title));
    const main = sections.filter(s => !SIDE_SECTIONS.test(s.title));
    const profile = summary.length ? `<section><h2>${lang.startsWith('de') ? 'Profil' : 'Profile'}</h2>${summary.join('')}</section>` : '';
    return `<div class="sheet t-${theme}"><div class="side">${name}${tagline}${contact}${rule}${side.map(sectionHtml).join('')}</div>`
      + `<div class="main">${profile}${main.map(sectionHtml).join('')}</div></div>`;
  }
  return `<div class="sheet t-${theme}"><header>${name}${tagline}${contact}${rule}</header>${summary.join('')}${sections.map(sectionHtml).join('')}</div>`;
}

function renderLetter(blocks: Block[], theme: string, layout: string): string {
  // header = everything before the first --- rule (or just the # name line)
  let split = blocks.findIndex(b => b.type === 'hr');
  if (split < 0) split = blocks[0]?.type === 'h1' ? 1 : 0;
  // the rule under the header is a real divider: it can be picked and removed like any other
  const rule = blocks[split]?.type === 'hr' ? `<hr class="lh-rule"${at(split)}>` : '';
  const head = blocks.slice(0, split).map((b, k) =>
    b.type === 'h1' ? `<h1${at(k)}>${inline(b.text)}</h1>` : `<div${at(k)}>${inline(b.text)}</div>`).join('') + rule;
  const body = blocks.slice(split).map((b, n) => {
    const k = split + n;
    if (b.type === 'hr') return k === split ? '' : `<hr${at(k)}>`; // the first one only separates the header
    if (b.type === 'li') return `<ul><li${at(k)}>${inline(b.text)}</li></ul>`;
    if (b.type.startsWith('h')) return `<div class="subject"${at(k)}>${inline(b.text)}</div>`;
    const subject = /^\*\*[^*]+\*\*$/.test(b.text.trim());
    return `<p${subject ? ' class="subject"' : ''}${at(k)}>${inline(subject ? b.text.trim().slice(2, -2) : b.text)}</p>`;
  }).join('');
  if (layout === 'sidebar') return `<div class="sheet t-${theme} letter"><div class="side">${head}</div><div class="main">${body}</div></div>`;
  return `<div class="sheet t-${theme} letter"><header class="lh">${head}</header>${body}</div>`;
}

/** Simple keyword coverage until AI scoring exists. */
export function keywordMatch(text: string, keywords: string[]) {
  // compare letters and digits only, so "English – C1" matches "English C1" and "REST-APIs" matches "REST APIs"
  const norm = (s: string) => ' ' + s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim() + ' ';
  const hay = norm(text);
  const found = keywords.filter(k => hay.includes(norm(k)));
  const missing = keywords.filter(k => !found.includes(k));
  return { score: keywords.length ? Math.round((found.length / keywords.length) * 100) : null, found, missing };
}
