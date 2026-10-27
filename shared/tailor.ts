import { rewriteBlock, type Ask } from './ai';
import { blockToMarkdown, parseBlocks } from './blocks';
import { httpError } from './fs';
import { keywordMatch } from './render';
import type { Store } from './store';

/** ✨ rewrite one block of a job's document against the posting. `body` is the editor's current (maybe unsaved) text. */
export async function tailorBlock(store: Store, ask: Ask, id: string, name: string, body: string, block: number, instruction = '', avoid: string[] = []) {
  const [job, doc, posting] = await Promise.all([store.getJob(id), store.getDoc(id, name), store.getPosting(id)]);
  const blocks = parseBlocks(body);
  const b = blocks[block];
  if (!b || b.type === 'hr') throw httpError(400, 'That part cannot be rewritten.');
  // name, contact line, entry title/dates and the company line under it are facts: edit those by hand
  const prev = blocks[block - 1];
  const header = !blocks.slice(0, block).some(x => x.type === 'h2');
  if (b.type === 'h1' || b.type === 'h3' || (b.type === 'p' && prev?.type === 'h3') || (doc.meta.kind !== 'cover' && header && b.text.includes(' | ')))
    throw httpError(400, 'This line holds facts (name, contact, title, dates or company), so the AI leaves it alone. Click it to edit it by hand.');
  const before = blocks.slice(0, block);
  const section = before.filter(x => x.type === 'h2').pop()?.text ?? '';
  const lastH = [...before].reverse().find(x => x.type === 'h2' || x.type === 'h3');
  const kinds: Record<string, string> = { h2: 'section heading', li: 'bullet', p: 'paragraph' };
  const original = blockToMarkdown(b);
  const others = await Promise.all(job.docs.filter(n => n !== name).map(async n => ({ name: `${n} (for this job)`, body: (await store.getDoc(id, n)).body })));
  // the main CV holds everything the candidate has done, even what this job's copy left out
  const main = await store.mainCv(doc.meta.lang).catch(() => null);
  if (main && ![body, ...others.map(o => o.body)].includes(main.body)) others.push({ name: `the main CV "${main.meta.title}" (all their experience)`, body: main.body });
  const r = await rewriteBlock(ask, {
    block: original, kind: kinds[b.type] ?? b.type, section, entry: lastH?.type === 'h3' ? lastH.text : '',
    document: body, posting, others,
    job: { title: job.title, company: job.company, keywords: job.keywords },
    instruction: instruction.slice(0, 500), avoid: avoid.slice(-3),
  });
  // keep the block's form even if the model drops or adds markdown markers
  const fixed = parseBlocks(r.text);
  const text = fixed.length === 1 && fixed[0].type === b.type ? blockToMarkdown(fixed[0])
    : blockToMarkdown({ ...b, text: fixed.map(f => f.text).join(b.text.includes('\n') ? '\n' : ' ').trim() || r.text });
  // small models sometimes borrow skills from the posting; flag keywords the candidate's documents never mention
  const facts = [body, ...others.map(o => o.body)].join('\n');
  const known = new Set(keywordMatch(facts, job.keywords).found);
  const flagged = [...keywordMatch(text, job.keywords).found.filter(k => !known.has(k)), ...newNumbers(text, facts), ...newTerms(text, facts, doc.meta.lang)];
  const seen = new Set<string>();
  const unverified = flagged.filter(f => { const k = f.toLowerCase(); return !seen.has(k) && seen.add(k); });
  return { original, text, why: r.why, unverified };
}

/**
  Names, tools and degrees in a suggestion that the candidate's documents never mention (COBOL, PhD, Google,
  "MIT"): likely invented, or planted by instructions hidden in a posting. In English every capitalised word
  counts (not at the start of a sentence); in German all nouns are capitalised, so only acronyms and
  mixed-case words (SQL, PhD, iOS, McKinsey) count.
*/
export function newTerms(suggestion: string, facts: string, lang = 'en'): string[] {
  const plain = suggestion.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[*_[\]#]/g, '');
  const known = new Set((facts.match(/[\p{L}\p{N}+#.]+/gu) ?? []).map(w => w.toLowerCase().replace(/\.$/, '')));
  const out: string[] = [];
  for (const m of plain.matchAll(/[\p{L}\p{N}][\p{L}\p{N}+#.]*/gu)) {
    const w = m[0].replace(/\.$/, '');
    const before = plain.slice(0, m.index).trimEnd();
    const sentenceStart = !before || /[.!?:;\n-]$/.test(before);
    const acronymOrMixed = /\p{Lu}/u.test(w.slice(1)) || (/\d/.test(w) && /\p{L}/u.test(w));
    const capitalised = /^\p{Lu}/u.test(w) && !sentenceStart;
    if ((acronymOrMixed || (lang.startsWith('en') && capitalised)) && !known.has(w.toLowerCase()) && !STOP.has(w.toLowerCase())) out.push(w);
  }
  return [...new Set(out)];
}
const STOP = new Set(['i', 'ii', 'iii', 'ok', 'id']);

/** Numbers (percentages, years, counts) in a suggestion that the candidate's documents never mention: likely invented. */
export function newNumbers(suggestion: string, facts: string): string[] {
  const nums = (s: string) => s.match(/\d+(?:[.,]\d+)?\s?%?/g)?.map(n => n.replace(/\s/g, '').replace(',', '.')) ?? [];
  const known = new Set(nums(facts).map(n => n.replace(/%$/, '')));
  return [...new Set(nums(suggestion).filter(n => !known.has(n.replace(/%$/, ''))))];
}
