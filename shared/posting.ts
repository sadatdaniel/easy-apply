import { Readability } from '@mozilla/readability';
import type { ExtractedFields } from './types';

// Runs in the browser (DOMParser) and in Node (pass a jsdom-based parser).
export type ParseHtml = (html: string, url?: string) => Document;

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'TR', 'BR', 'HEADER', 'FOOTER']);

/** HTML → readable plain text that keeps headings, paragraphs and bullets on their own lines. */
export function htmlToText(html: string, parse: ParseHtml): string {
  const doc = parse(`<body>${html}</body>`);
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out += (n.textContent ?? '').replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return;
    if (el.tagName === 'LI') out += '\n- ';
    else if (BLOCK.has(el.tagName)) out += '\n';
    el.childNodes.forEach(walk);
    if (BLOCK.has(el.tagName) || el.tagName === 'LI') out += '\n';
  };
  doc.body.childNodes.forEach(walk);
  return out.split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^- *$/gm, '').trim();
}

interface LdJob { '@type'?: string | string[]; title?: string; description?: string; validThrough?: string; hiringOrganization?: { name?: string }; jobLocation?: unknown; baseSalary?: unknown; jobLocationType?: string }

function findJobPosting(doc: Document): LdJob | null {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? '');
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const x = stack.shift();
        if (!x || typeof x !== 'object') continue;
        const t = (x as LdJob)['@type'];
        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return x as LdJob;
        if (Array.isArray((x as { '@graph'?: unknown[] })['@graph'])) stack.push(...(x as { '@graph': unknown[] })['@graph']);
      }
    } catch { /* ignore malformed blocks */ }
  }
  return null;
}

function ldLocation(loc: unknown): string {
  const one = (l: any) => [l?.address?.addressLocality, l?.address?.addressCountry?.name ?? l?.address?.addressCountry].filter(x => typeof x === 'string').join(', ');
  return (Array.isArray(loc) ? loc.map(one) : [one(loc)]).filter(Boolean).join(' / ');
}

function ldSalary(s: any): string {
  const v = s?.value;
  if (!v) return '';
  const cur = s.currency ?? '';
  const range = v.minValue && v.maxValue ? `${v.minValue}–${v.maxValue}` : v.value ?? v.minValue ?? '';
  return [cur, range, v.unitText ? `/${String(v.unitText).toLowerCase()}` : ''].filter(Boolean).join(' ');
}

export interface FetchedPosting { url: string; title: string; text: string; html: string; fields: ExtractedFields; warning?: string }

/** Turns a fetched job page into text plus whatever structured fields it carries. */
export function parsePosting(html: string, url: string, parse: ParseHtml): FetchedPosting {
  const doc = parse(html, url);
  const fields: ExtractedFields = {};

  // Many job boards (Greenhouse, Lever, Workday, Personio, StepStone …) embed schema.org JobPosting data.
  const ld = findJobPosting(doc);
  let text = '';
  if (ld?.description) {
    text = htmlToText(ld.description, parse);
    fields.title = ld.title ?? '';
    fields.company = ld.hiringOrganization?.name ?? '';
    fields.location = [ldLocation(ld.jobLocation), ld.jobLocationType === 'TELECOMMUTE' ? 'remote' : ''].filter(Boolean).join(' · ');
    fields.salary = ldSalary(ld.baseSalary);
    if (ld.validThrough) fields.deadline = ld.validThrough.slice(0, 10);
    text = [fields.title, [fields.company, fields.location].filter(Boolean).join(' · '), '', text].join('\n').trim();
  } else {
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    text = article?.content ? htmlToText(article.content, parse) : (doc.body?.textContent ?? '').trim();
    if (article?.title) text = `${article.title}\n\n${text}`;
  }
  const warning = text.length < 600
    ? 'Only a little text came back. The site may need a login or block automated access. Paste the full posting if this looks incomplete.'
    : undefined;
  return { url, title: doc.title, text, html, fields, warning };
}
