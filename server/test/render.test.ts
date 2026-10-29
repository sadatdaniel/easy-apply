import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { blockToMarkdown, fillPlaceholders, parseBlocks, replaceBlock, serializeBlocks, setTypes, toggleMark } from '../../shared/blocks';
import { wordDiff } from '../../shared/diff';
import { inline, keywordMatch, renderDoc } from '../../shared/render';

const dom = (html: string) => new JSDOM(`<body>${html}</body>`).window.document;

describe('rendering is safe with hostile document text', () => {
  const evil = [
    '# <img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '- [click](javascript:alert(1))',
    '- [x](https://ok.test" onmouseover="alert(1))',
    '### Title | <svg onload=alert(1)>',
    '{{x" onclick="alert(1)}}',
  ].join('\n\n');

  for (const theme of ['classic', 'sidebar', 'serif', 'academic']) for (const kind of ['cv', 'cover'] as const) {
    it(`${theme} ${kind}: no scripts, handlers or javascript: links`, () => {
      const d = dom(renderDoc(parseBlocks(evil), theme, kind));
      expect(d.querySelectorAll('script, img, svg, iframe, object').length).toBe(0);
      for (const el of d.querySelectorAll('*'))
        for (const a of el.attributes) expect(a.name.startsWith('on')).toBe(false);
      for (const a of d.querySelectorAll('a')) expect(a.getAttribute('href')).toMatch(/^(https?:|mailto:)/);
    });
  }

  it('a theme or style from a file cannot inject attributes', () => {
    const html = renderDoc(parseBlocks('# A'), 'classic" onmouseover="alert(1)', 'cv', 'en',
      { size: '110;}</style><script>' as never, align: 'left" onclick="x' as never, lineHeight: 1.3 });
    const sheet = dom(html).querySelector('.sheet')!;
    expect(sheet.className).toBe('sheet t-classic st-lh');
    expect(sheet.getAttribute('style')).toBe('--st-lh:1.3');
    expect([...sheet.attributes].map(a => a.name).sort()).toEqual(['class', 'style']);
  });

  it('inline markdown: bold, italic, safe links, placeholders', () => {
    expect(inline('**b** *i* [t](https://x.test/a?b=1&c=2) {{name}}')).toBe('<b>b</b> <i>i</i> <a href="https://x.test/a?b=1&amp;c=2">t</a> <span class="ph">name</span>');
    expect(inline('[t](javascript:alert(1))')).toBe('[t](javascript:alert(1))');
  });
});

describe('blocks', () => {
  const md = '# Name\n\nline one\nline two\n\n## Skills\n\n- a\n  continued\n- b\n\n---\n\n### Dev | 2020 – now\nAcme';
  it('parse → serialize keeps the document', () => {
    const b = parseBlocks(md);
    expect(b.map(x => x.type)).toEqual(['h1', 'p', 'h2', 'li', 'li', 'hr', 'h3', 'p']);
    expect(b[3].text).toBe('a continued');
    expect(parseBlocks(serializeBlocks(b))).toEqual(b);
  });
  it('Windows line endings and blank documents', () => {
    expect(parseBlocks('# A\r\n\r\n- b\r\n')).toEqual([{ type: 'h1', text: 'A' }, { type: 'li', text: 'b' }]);
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('   \n\n  ')).toEqual([]);
  });
  it('editing one block into two, or deleting it', () => {
    const b = parseBlocks('# A\n\n- x\n\n- y');
    expect(serializeBlocks(replaceBlock(b, 1, '- x1\n- x2')).split('\n').filter(Boolean)).toEqual(['# A', '- x1', '- x2', '- y']);
    expect(replaceBlock(b, 1, '')).toHaveLength(2);
    expect(blockToMarkdown({ type: 'hr', text: '' })).toBe('---');
  });
  it('several lines become bullets; a paragraph of several lines becomes one bullet per line; the name stays', () => {
    const b = parseBlocks('# Name\n\nPython\nSQL\n\nGit\n\n---\n\n## Skills');
    const r = setTypes(b, 0, 4, 'li');
    expect(serializeBlocks(r.blocks).split('\n').filter(Boolean)).toEqual(['# Name', '- Python', '- SQL', '- Git', '---', '- Skills']);
    expect(r.to).toBe(5);
    const back = setTypes(r.blocks, 1, 3, 'p');
    expect(back.blocks.slice(1, 4).every(x => x.type === 'p')).toBe(true);
    expect(setTypes(parseBlocks('Dev'), 0, 0, 'h3').blocks[0].text).toBe('Dev | dates');
  });
  it('bold on several lines: on, then off again; headings and dividers untouched', () => {
    const b = parseBlocks('## S\n\n- a\n\n- **b**\n\n---');
    const on = toggleMark(b, 0, 3, '**');
    expect(on.map(x => x.text)).toEqual(['S', '**a**', '**b**', '']);
    expect(toggleMark(on, 0, 3, '**').map(x => x.text)).toEqual(['S', 'a', 'b', '']);
    expect(toggleMark(parseBlocks('x\n\n**y**'), 0, 1, '*').map(x => x.text)).toEqual(['*x*', '***y***']);
    // a line with a bold label becomes bold as a whole, without broken markers
    expect(toggleMark(parseBlocks('- **Languages:** Python'), 0, 0, '**')[0].text).toBe('**Languages: Python**');
  });
  it('a letter: the first divider closes the header, and both can be picked on the page', () => {
    for (const theme of ['classic', 'sidebar', 'serif', 'academic']) {
      const d = dom(renderDoc(parseBlocks('# A\n\nme@x.test\n\n---\n\nDear X,\n\n---\n\nRegards'), theme, 'cover'));
      expect([...d.querySelectorAll('hr')].map(h => [h.className, h.getAttribute('data-b')])).toEqual([['lh-rule', '2'], ['', '4']]);
      expect(d.querySelector('.lh-rule')!.parentElement!.matches('header, .side')).toBe(true);
    }
  });

  it('placeholders: known ones fill, unknown and empty ones stay visible', () => {
    expect(fillPlaceholders('{{name}} {{ email }} {{missing}} {{empty}}', { name: 'A', email: 'a@x', empty: '' })).toBe('A a@x {{missing}} {{empty}}');
  });
});

describe('helpers', () => {
  it('keyword match ignores case, dashes and spacing', () => {
    const r = keywordMatch('English – C1, REST-APIs, Python', ['english c1', 'REST APIs', 'Go', 'C++']);
    expect(r.found).toEqual(['english c1', 'REST APIs']);
    expect(r.score).toBe(50);
    expect(keywordMatch('x', []).score).toBeNull();
  });
  it('word diff marks only what changed', () => {
    expect(wordDiff('a b c', 'a x c')).toEqual([{ op: 'same', text: 'a ' }, { op: 'del', text: 'b' }, { op: 'ins', text: 'x' }, { op: 'same', text: ' c' }]);
    expect(wordDiff('', 'new')).toEqual([{ op: 'ins', text: 'new' }]);
    expect(wordDiff('same', 'same')).toEqual([{ op: 'same', text: 'same' }]);
  });
});

describe('bullets and dividers above the first section', () => {
  it('are drawn (and can be clicked) in every theme', () => {
    const blocks = parseBlocks('# Alex\n\nTagline\n\nA summary.\n\n- one\n- two\n\n---\n\n## Skills\n\n- SQL\n');
    for (const theme of ['classic', 'sidebar', 'serif', 'academic']) {
      const d = dom(renderDoc(blocks, theme, 'cv'));
      expect(d.querySelectorAll('ul.summary li').length).toBe(2);
      expect(d.querySelector('hr')?.getAttribute('data-b')).toBe('5');
      for (const i of [3, 4, 5]) expect(d.querySelectorAll(`[data-b="${i}"]`).length).toBe(1);
    }
  });
});
