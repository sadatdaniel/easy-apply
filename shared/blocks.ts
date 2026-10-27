// A document is markdown split into blocks: one heading, paragraph, bullet or rule each.
// Blocks are the unit you click to edit (and later, the unit AI rewrites).

export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'hr';
export interface Block { type: BlockType; text: string }

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*•]\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

export function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ type: 'p', text: para.join('\n') }); para = []; } };

  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const last = blocks[blocks.length - 1];
    // indented continuation of a bullet
    if (!para.length && last?.type === 'li' && /^\s{2,}\S/.test(line)) { last.text += ' ' + line.trim(); continue; }
    const t = line.trim();
    let m: RegExpMatchArray | null;
    if (RULE.test(t)) { flush(); blocks.push({ type: 'hr', text: '' }); }
    else if ((m = t.match(HEADING))) { flush(); blocks.push({ type: ('h' + m[1].length) as BlockType, text: m[2] }); }
    else if ((m = t.match(BULLET))) { flush(); blocks.push({ type: 'li', text: m[1] }); }
    else para.push(t);
  }
  flush();
  return blocks;
}

export function blockToMarkdown(b: Block): string {
  switch (b.type) {
    case 'h1': return '# ' + b.text;
    case 'h2': return '## ' + b.text;
    case 'h3': return '### ' + b.text;
    case 'li': return '- ' + b.text;
    case 'hr': return '---';
    default: return b.text;
  }
}

export function serializeBlocks(blocks: Block[]): string {
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) out += b.type === 'li' && blocks[i - 1].type === 'li' ? '\n' : '\n\n';
    out += blockToMarkdown(b);
  });
  return out + '\n';
}

/** Replace block i with whatever markdown the user typed (may become 0..n blocks). */
export function replaceBlock(blocks: Block[], i: number, md: string): Block[] {
  return [...blocks.slice(0, i), ...parseBlocks(md), ...blocks.slice(i + 1)];
}

export type LineType = 'h1' | 'h2' | 'h3' | 'li' | 'p';

/**
  Changes the type of blocks from..to (inclusive) for the formatting bar. A paragraph of several lines turned
  into bullets becomes one bullet per line; the name (h1) and dividers stay as they are.
  Returns the new blocks and where the selection now ends.
*/
export function setTypes(blocks: Block[], from: number, to: number, type: LineType): { blocks: Block[]; to: number } {
  const out: Block[] = [...blocks.slice(0, from)];
  for (const b of blocks.slice(from, to + 1)) {
    if (b.type === 'h1' || b.type === 'hr') { out.push(b); continue; }
    const lines = type === 'li' ? b.text.split('\n').map(l => l.trim()).filter(Boolean) : [b.text.replace(/\n+/g, type === 'p' ? '\n' : ' ')];
    for (const l of lines.length ? lines : ['']) out.push({ type, text: type === 'h3' && !l.includes(' | ') ? `${l} | dates` : l });
  }
  const end = out.length - 1;
  return { blocks: [...out, ...blocks.slice(to + 1)], to: end };
}

/** Bold or italic on whole lines: if every selected line already is, remove it; otherwise add it. */
export function toggleMark(blocks: Block[], from: number, to: number, mark: '**' | '*'): Block[] {
  const target = (b: Block) => b.type === 'p' || b.type === 'li';
  const has = (t: string) => (mark === '**' ? /^\*\*[\s\S]+\*\*$/.test(t) : /^\*(?!\*)[\s\S]+(?<!\*)\*$/.test(t));
  const picked = blocks.slice(from, to + 1).filter(target);
  const remove = picked.length > 0 && picked.every(b => has(b.text.trim()));
  return blocks.map((b, i) => {
    if (i < from || i > to || !target(b) || !b.text.trim()) return b;
    const t = b.text.trim();
    if (remove) return { ...b, text: t.slice(mark.length, -mark.length) };
    if (has(t)) return b;
    // like Word: the whole line becomes bold (or italic), so inner marks of the same kind go
    const inner = mark === '**' ? t.replace(/\*\*/g, '') : t.replace(/(?<!\*)\*(?!\*)/g, '');
    return { ...b, text: `${mark}${inner}${mark}` };
  });
}

export function fillPlaceholders(md: string, values: Record<string, string>): string {
  return md.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, key) => (values[key] ?? '').trim() || all);
}
