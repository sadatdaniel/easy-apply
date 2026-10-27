import { parseBlocks, serializeBlocks, type Block } from './blocks';

/*
  A cover letter is written for one job: it names the company, the role, a date and where the job is.
  To reuse an uploaded letter, those parts become placeholders ({{company}}, {{job_title}}, {{today}},
  {{job_location}}) that every new application fills in. Detection reads the usual letter layout:
    header (sender) · --- · date · recipient (company, address/place) · subject · salutation · body
  in English and German, and only proposes; the user confirms or corrects each value.
*/
export interface LetterDetails { company: string; role: string; date: string; location: string }
export const LETTER_FIELDS: { key: keyof LetterDetails; placeholder: string; label: string }[] = [
  { key: 'company', placeholder: '{{company}}', label: 'Company' },
  { key: 'role', placeholder: '{{job_title}}', label: 'Role' },
  { key: 'date', placeholder: '{{today}}', label: 'Date' },
  { key: 'location', placeholder: '{{job_location}}', label: 'Job location' },
];

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|okt|nov|dec|dez';
const DATE = new RegExp(`(\\d{1,2}\\.?\\s+(?:${MONTHS})\\.?\\s+\\d{4}|(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4}|(?:${MONTHS})\\.?\\s+\\d{4}|\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`, 'i');
const SALUTATION = /^(dear|hello|hi|to whom|sehr geehrte|liebe|lieber|hallo|guten tag)\b/i;
const SUBJECT = /^(?:re|subject|betreff|ref)\s*:\s*|^(?:application|applying)\s+(?:for|as)\s+(?:the\s+)?(?:position\s+(?:of|as)\s+)?|^bewerbung\s+(?:als|um\s+(?:die\s+stelle\s+(?:als\s+)?)?|für\s+(?:die\s+stelle\s+(?:als\s+)?)?)/i;

const plain = (t: string) => t.replace(/\*\*|\*/g, '').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** whole-word matches only: "Lumen" but not "Lumens" */
const wordRe = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(s)}(?![\\p{L}\\p{N}])`, 'gu');

export function findLetterDetails(md: string): LetterDetails {
  const blocks = parseBlocks(md);
  const hr = blocks.findIndex(b => b.type === 'hr');
  const start = hr >= 0 ? hr + 1 : blocks[0]?.type === 'h1' ? 1 : 0;
  const greet = blocks.findIndex((b, i) => i >= start && SALUTATION.test(plain(b.text)));
  const head = blocks.slice(start, greet < 0 ? Math.min(blocks.length, start + 8) : greet).filter(b => b.type !== 'hr');

  const out: LetterDetails = { company: '', role: '', date: '', location: '' };
  const recipient: string[] = [];
  for (const b of head) {
    for (const line of plain(b.text).split('\n').map(l => l.trim()).filter(Boolean)) {
      if (line.includes('{{')) continue; // already a placeholder: nothing to detect
      const d = line.match(DATE);
      if (d && !out.date && line.length <= d[0].length + 30) { out.date = d[0]; continue; }
      const subj = line.match(SUBJECT);
      if (subj || (/^\*\*[\s\S]+\*\*$/.test(b.text.trim()) && recipient.length && !out.role && line.length > 12)) {
        out.role = line.slice(subj?.[0].length ?? 0).replace(/[.:]+$/, '').trim();
        continue;
      }
      if (/@|^\+?\d[\d\s()/-]{6,}$|^(attn|z\.\s?hd)/i.test(line)) continue;
      recipient.push(line);
    }
  }
  out.company = recipient[0] ?? '';
  // the last recipient line, if it looks like a place ("Hamburg, Germany", "20457 Hamburg")
  const last = recipient.length > 1 ? recipient[recipient.length - 1] : '';
  if (last && /\p{Lu}/u.test(last) && last.length <= 60 && !/\b(gmbh|ag|inc|ltd|llc|team|department|abteilung)\b/i.test(last)) out.location = last;
  // no recipient block: "Dear Lumen Labs Team," names the company
  if (!out.company && greet >= 0) {
    const m = plain(blocks[greet].text).match(/^dear\s+(.+?)\s+(?:team|hiring team|recruiting team)\b/i);
    if (m && !/^(hiring|recruiting|sir|madam)/i.test(m[1])) out.company = m[1];
  }
  return out;
}

/** Puts placeholders where the old job's details were; only in the letter, never in the sender header. */
export function generalizeLetter(md: string, d: Partial<LetterDetails>): { markdown: string; counts: Record<keyof LetterDetails, number> } {
  const blocks = parseBlocks(md);
  const hr = blocks.findIndex(b => b.type === 'hr');
  const start = hr >= 0 ? hr + 1 : blocks[0]?.type === 'h1' ? 1 : 0;
  const counts: Record<keyof LetterDetails, number> = { company: 0, role: 0, date: 0, location: 0 };
  const swap = (text: string, key: keyof LetterDetails, value: string | undefined, placeholder: string, whole = false) => {
    const v = value?.trim();
    if (!v || v.length < 2 || v.includes('{{')) return text;
    if (whole) return text.split('\n').map(l => (plain(l) === v ? (counts[key]++, l.replace(plain(l), placeholder)) : l)).join('\n');
    return text.replace(wordRe(v), () => { counts[key]++; return placeholder; });
  };
  const out: Block[] = blocks.map((b, i) => {
    if (i < start) return b;
    let text = b.text;
    // longer values first, so a role that contains the company name stays one placeholder
    for (const f of [...LETTER_FIELDS].sort((x, y) => (d[y.key]?.length ?? 0) - (d[x.key]?.length ?? 0)))
      text = swap(text, f.key, d[f.key], f.placeholder, f.key === 'location');
    return { ...b, text };
  });
  // nothing replaced: hand the letter back exactly as it was
  return { markdown: Object.values(counts).some(Boolean) ? serializeBlocks(out) : md, counts };
}
