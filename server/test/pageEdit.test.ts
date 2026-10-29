// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseBlocks, serializeBlocks } from '../../shared/blocks';
import { renderDoc } from '../../shared/render';
import { blocksToHtml, blocksToText, cut, elToMd, htmlToBlocks, textToBlocks } from '../../web/src/pageEdit';

/** a rendered page and a point `n` visible characters into block `b` */
function page(md: string, kind: 'cv' | 'cover' = 'cv') {
  const root = document.createElement('div');
  root.innerHTML = renderDoc(parseBlocks(md), 'classic', kind);
  const el = (b: number) => root.querySelector(`[data-b="${b}"]`) as HTMLElement;
  const at = (b: number, n: number) => {
    const w = document.createTreeWalker(el(b), NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) { if (n <= t.length) return { node: t as Node, offset: n }; n -= t.length; }
    return { node: el(b) as Node, offset: el(b).childNodes.length };
  };
  return { el, at };
}

describe('page editor: reading the page back as Markdown', () => {
  it('a line reads back exactly as written, entry headers and contact lines included', () => {
    const md = '# Alex\n\nTagline\n\n+49 1 | a@b.c | [site](https://x.test)\n\n## Work\n\n### Data **Engineer** | 2020 – now\nHarbour, Hamburg\n\n- Built *fast* {{company}} pipelines\n';
    const p = page(md);
    const blocks = parseBlocks(md);
    blocks.forEach((b, i) => { if (b.type !== 'hr') expect(elToMd(p.el(i))).toBe(b.text); });
  });

  it('cuts a line at the caret, closing and reopening a mark cut in half', () => {
    const p = page('# A\n\n## S\n\n- one **bold** word\n');
    expect(cut(p.el(2), p.at(2, 6))).toEqual(['one **bo**', '**ld** word']);
    expect(cut(p.el(2), p.at(2, 4), p.at(2, 8))).toEqual(['one ', '**bold**', ' word']);
    // a cut right where a mark starts doesn't leave an empty "****"
    expect(cut(p.el(2), p.at(2, 4))).toEqual(['one ', '**bold** word']);
  });

  it('reading never changes the page, so the same points can be read twice', () => {
    const p = page('# A\n\n## S\n\n- one **bold** word\n');
    const before = p.el(2).innerHTML;
    const a = p.at(2, 6);
    expect(cut(p.el(2), a)).toEqual(cut(p.el(2), a));
    expect(p.el(2).innerHTML).toBe(before);
  });

  it('splits an entry header between title and dates', () => {
    const p = page('# A\n\n## Work\n\n### Engineer | 2020\n');
    expect(cut(p.el(2), p.at(2, 8))).toEqual(['Engineer', ' | 2020']);
    const [before, after] = cut(p.el(2), p.at(2, 4));
    expect(before + 'X' + after).toBe('EngiXneer | 2020');
  });
});

describe('page editor: clipboard', () => {
  it('copies as Markdown, HTML and plain text', () => {
    const bs = parseBlocks('## Skills\n\n- **SQL** and [dbt](https://dbt.test)\n- Python\n\n---\n\nText');
    expect(serializeBlocks(parseBlocks(serializeBlocks(bs)))).toBe(serializeBlocks(bs));
    expect(blocksToHtml(bs)).toBe('<h2>Skills</h2><ul><li><b>SQL</b> and <a href="https://dbt.test">dbt</a></li><li>Python</li></ul><hr><p>Text</p>');
    expect(blocksToText(bs)).toBe('Skills\n• SQL and dbt\n• Python\n———\nText');
  });

  it('reads pasted Word / Google Docs HTML into lines, bullets and bold', () => {
    const word = '<html><head><style>p{}</style></head><body><p class=MsoNormal><b>Experience</b></p><ul><li>Led a <span style="font-weight:700">team</span> of 5</li><li>Shipped it</li></ul><p>Plain <i>text</i></p><hr></body></html>';
    expect(htmlToBlocks(word)).toEqual([
      { type: 'p', text: '**Experience**' }, { type: 'li', text: 'Led a **team** of 5' }, { type: 'li', text: 'Shipped it' },
      { type: 'p', text: 'Plain *text*' }, { type: 'hr', text: '' },
    ]);
    const gdocs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h2>Skills</h2><p><span>Python, SQL</span></p></b>';
    expect(htmlToBlocks(gdocs)).toEqual([{ type: 'h2', text: 'Skills' }, { type: 'p', text: 'Python, SQL' }]);
    expect(htmlToBlocks('<p><a href="javascript:alert(1)">x</a></p>')).toEqual([{ type: 'p', text: 'x' }]);
  });

  it('reads pasted plain text: a line each, bullets kept', () => {
    expect(textToBlocks('First line\r\n\r\n• a point\n- another\n## Head')).toEqual([
      { type: 'p', text: 'First line' }, { type: 'li', text: 'a point' }, { type: 'li', text: 'another' }, { type: 'h2', text: 'Head' },
    ]);
  });
});
