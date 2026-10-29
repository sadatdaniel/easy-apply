import { serializeBlocks, type Block } from './blocks';
import type { ParseHtml } from './posting';
import type { DocKind, Profile } from './types';

/*
  Word CV (as HTML from mammoth) → template Markdown. Few CVs use Word's heading styles, so this reads
  the usual shapes instead:
    - the name at the top (Title/Heading 1, or the first bold line) and a contact line or contact table
    - section headings: ALL CAPS, or a known section word (English/German), as a short bold line
    - entries: a bold job title followed by a table row "Company | dates" → "### Title | dates" + company line;
      a two-cell row without a title → "### left | right" (projects, certificates)
    - bullets, bold, italic and links
*/
export interface Imported {
  markdown: string;
  kind: DocKind;
  lang: string;
  found: { name: string; email: string; phone: string; website: string; location: string };
}

const SECTION_WORDS = /^(summary|profile|about( me)?|skills?|technical skills|core skills|competencies|experience|work experience|professional experience|employment( history)?|education|academic background|certifications?|certificates?|licenses|languages?|projects?|publications?|awards?|honou?rs|volunteer(ing)?|interests|hobbies|references|courses|training|research|teaching|profil|kurzprofil|über mich|fähigkeiten|kenntnisse|kompetenzen|berufserfahrung|beruflicher werdegang|praxiserfahrung|ausbildung|bildung|bildungsweg|studium|zertifikate|zertifizierungen|weiterbildung(en)?|sprachen|sprachkenntnisse|projekte|veröffentlichungen|auszeichnungen|ehrenamt|interessen|hobbys|referenzen)$/i;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|januar|februar|märz|mai|juni|juli|august|september|oktober|november|dezember)[a-zä]*\\.?';
const DATE = `(?:\\d{1,2}[./]\\d{4}|\\d{4}|${MONTH}\\s+\\d{4})`;
const DATE_RANGE = new RegExp(`^(?:(?:since|seit|ab)\\s+)?${DATE}(?:\\s*[–—-]\\s*(?:${DATE}|present|now|today|current|heute|jetzt|laufend))?$`, 'i');
const LETTER = /\b(dear|sehr geehrte|kind regards|best regards|warm regards|sincerely|mit freundlichen grüßen)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s()/.-]{6,}\d/;
const WEB = /^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

const clean = (s: string) => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
const plainUrl = (u: string) => u.replace(/^mailto:/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** inline HTML → Markdown: bold, italic, links (a link whose text is its own address stays plain text) */
function inlineMd(el: Element): string {
  let out = '';
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) { out += (n.textContent ?? '').replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const inner = inlineMd(e);
    const t = inner.trim();
    if (!t) { out += inner; return; }
    if (e.tagName === 'STRONG' || e.tagName === 'B') out += wrapKeep(inner, '**');
    else if (e.tagName === 'EM' || e.tagName === 'I') out += wrapKeep(inner, '*');
    else if (e.tagName === 'A') {
      const href = e.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/.test(href) || plainUrl(href) === plainUrl(t.replace(/\*/g, ''))) out += inner;
      else out += `[${t.replace(/^\[|\]$/g, '')}](${href})`;
    } else if (e.tagName === 'BR') out += '\n';
    else out += inner;
  });
  return out;
}
// keep surrounding spaces outside the markers: "**Skills** " not "**Skills **"
const wrapKeep = (s: string, m: string) => { const a = s.match(/^\s*/)![0], b = s.match(/\s*$/)![0]; return `${a}${m}${s.trim()}${m}${b}`; };

/** the paragraph is bold as a whole (a typical heading or job title) */
const allBold = (md: string) => /^\*\*[^*]+\*\*$/.test(md.trim());
const unbold = (md: string) => md.trim().replace(/^\*\*|\*\*$/g, '').trim();
const isSection = (text: string) => {
  const t = text.replace(/[:：]$/, '').trim();
  if (!t || t.length > 40 || /[.!?]$/.test(t)) return false;
  return SECTION_WORDS.test(t) || (t === t.toUpperCase() && /\p{Lu}{3}/u.test(t) && t.split(/\s+/).length <= 5);
};

export function importDocxHtml(html: string, parse: ParseHtml): Imported {
  const body = parse(`<body>${html}</body>`).body;
  const blocks: Block[] = [];
  const found = { name: '', email: '', phone: '', website: '', location: '' };
  let pendingTitle: string | null = null; // a bold line that may turn out to be an entry title
  let sawSection = false;

  const flushTitle = () => {
    if (pendingTitle === null) return;
    // a bold line that wasn't followed by a company/dates row: a section if it looks like one, else bold text
    if (isSection(pendingTitle)) { blocks.push({ type: 'h2', text: pendingTitle }); sawSection = true; }
    else blocks.push({ type: 'p', text: `**${pendingTitle}**` });
    pendingTitle = null;
  };
  const push = (b: Block) => { flushTitle(); blocks.push(b); };

  const contactLine = (parts: string[]) => {
    // contact lines are often set in a heavier font (bold in a PDF); the marks don't belong in the details
    const cells = parts.map(p => clean(p.replace(/\*\*/g, '').replace(/^\s*[|·•]\s*|\s*[|·•]\s*$/g, ''))).filter(Boolean);
    for (const c of cells) {
      const plain = c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      if (!found.email && EMAIL.test(plain)) found.email = plain.match(EMAIL)![0];
      else if (!found.phone && PHONE.test(plain) && !/[a-z]{3}/i.test(plain)) found.phone = plain;
      else if (!found.website && WEB.test(plain)) found.website = plain;
      else if (!found.location && !EMAIL.test(plain)) found.location = plain;
    }
    push({ type: 'p', text: cells.join(' | ') });
  };
  const looksLikeContact = (s: string) => EMAIL.test(s) || (PHONE.test(s) && s.includes('|'));

  // a letter has no sections or job entries: its bold lines (company, subject) stay bold text
  const letter = LETTER.test(body.textContent ?? '');

  const handle = (el: Element): void => {
    const tag = el.tagName;
    if (tag === 'HR') { push({ type: 'hr', text: '' }); return; }
    // a layout table (a photo beside the name and contact lines, two columns): a cell holds several lines;
    // its cells are read as text, in order, rather than as "Company | dates" rows
    if (tag === 'TABLE' && [...el.querySelectorAll('td, th')].some(c => [...c.children].filter(k => clean(k.textContent ?? '')).length > 1)) {
      for (const c of [...el.querySelectorAll('tr')].flatMap(r => [...r.children])) for (const k of [...c.children]) handle(k);
      return;
    }
    if (tag === 'TABLE' && letter) {
      for (const row of [...el.querySelectorAll('tr')]) {
        const t = [...row.children].map(c => clean(inlineMd(c))).filter(Boolean).join(' ');
        if (t) push({ type: 'p', text: t });
      }
      return;
    }
    if (tag === 'TABLE') {
      for (const row of [...el.querySelectorAll('tr')]) {
        const cells = [...row.children].map(c => clean(inlineMd(c).replace(/\n+/g, ' '))).filter(Boolean);
        if (!cells.length) continue;
        if (!sawSection && cells.some(looksLikeContact)) { contactLine(cells); continue; }
        const last = cells[cells.length - 1].replace(/\*\*/g, '');
        const right = cells.length > 1 ? cells[cells.length - 1].replace(/ \| /g, ' · ') : '';
        const left = cells.slice(0, -1).join(' · ');
        if (pendingTitle !== null && cells.length > 1) {
          // "Title" + row "Company | dates"
          blocks.push({ type: 'h3', text: `${pendingTitle} | ${right}` });
          blocks.push({ type: 'p', text: left });
          pendingTitle = null;
        } else if (cells.length > 1) {
          push({ type: 'h3', text: `${unbold(left)} | ${right}` });
        } else if (DATE_RANGE.test(last)) {
          push({ type: 'p', text: last });
        } else push({ type: 'p', text: cells[0] });
      }
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      for (const li of [...el.querySelectorAll(':scope > li')]) {
        // "Label: items" bullets (skills) get a bold label, as in the built-in designs
        const t = clean(inlineMd(li)).replace(/^([^*:\[\]]{2,32}):\s+(?=\S)/, (m, label: string) => (label.split(/\s+/).length <= 4 ? `**${label}:** ` : m));
        if (t) push({ type: 'li', text: t });
      }
      return;
    }
    const md = clean(inlineMd(el));
    if (!md) return;
    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const t = unbold(md);
      if (level === 1 && !blocks.some(b => b.type === 'h1')) { push({ type: 'h1', text: t }); found.name ||= t.replace(/\*/g, ''); }
      else if (level <= 2 || isSection(t)) { push({ type: 'h2', text: t }); sawSection = true; }
      else { flushTitle(); pendingTitle = t; }
      return;
    }
    // name: the first bold line before anything else
    if (!blocks.length && pendingTitle === null && allBold(md) && unbold(md).split(/\s+/).length <= 6) {
      blocks.push({ type: 'h1', text: unbold(md) }); found.name = unbold(md); return;
    }
    if (!sawSection && looksLikeContact(md)) { contactLine(md.split(/\s*\|\s*/)); return; }
    if (allBold(md) && unbold(md).length <= 80 && !letter) {
      const t = unbold(md);
      if (isSection(t)) { push({ type: 'h2', text: t.replace(/[:：]$/, '') }); sawSection = true; }
      else { flushTitle(); pendingTitle = t; }
      return;
    }
    // "Job title<TAB>dates" written as one line
    const tab = el.textContent?.split(/\t+|\s{3,}/).map(clean).filter(Boolean) ?? [];
    if (tab.length === 2 && DATE_RANGE.test(tab[1]) && tab[0].length <= 90) { push({ type: 'h3', text: `${tab[0]} | ${tab[1]}` }); return; }
    push({ type: 'p', text: md });
  };
  for (const el of [...body.children]) handle(el);
  flushTitle();

  const text = blocks.map(b => b.text).join(' ');
  const kind: DocKind = LETTER.test(text) && blocks.filter(b => b.type === 'li').length < 4 ? 'cover' : 'cv';
  const de = (text.match(/\b(und|mit|für|der|die|das|von|bei|zur|im)\b/gi) ?? []).length + (text.match(/[äöüß]/gi) ?? []).length / 3;
  const en = (text.match(/\b(and|with|for|the|of|in|to|at)\b/gi) ?? []).length;
  return { markdown: serializeBlocks(blocks), kind, lang: de > en ? 'de' : 'en', found };
}

/** Replace the user's own details with {{placeholders}}, so the template works for every job. */
export function toPlaceholders(md: string, profile: Profile): { markdown: string; replaced: string[] } {
  const replaced: string[] = [];
  const digits = (s: string) => s.replace(/\D/g, '');
  const lines = md.split('\n');
  // only the header (before the first section) holds contact details
  const end = lines.findIndex(l => l.startsWith('## '));
  for (let i = 0; i < (end < 0 ? lines.length : end); i++) {
    for (const f of profile.fields) {
      const v = f.value.trim();
      if (v.length < 3) continue;
      const before = lines[i];
      if (f.key === 'name' && lines[i].startsWith('# ')) {
        if (clean(lines[i].slice(2)).toLowerCase() === v.toLowerCase()) lines[i] = `# {{name}}`;
      } else if (/phone|tel|mobile/i.test(f.key)) {
        lines[i] = lines[i].split(' | ').map(c => (digits(c).length >= 7 && digits(c) === digits(v) ? `{{${f.key}}}` : c)).join(' | ');
      } else {
        lines[i] = lines[i].split(' | ').map(c => {
          const plain = c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
          return plainUrl(plain).toLowerCase() === plainUrl(v).toLowerCase() || clean(plain).toLowerCase() === v.toLowerCase() ? `{{${f.key}}}` : c;
        }).join(' | ');
      }
      if (lines[i] !== before) replaced.push(f.key);
    }
  }
  return { markdown: lines.join('\n'), replaced: [...new Set(replaced)] };
}
