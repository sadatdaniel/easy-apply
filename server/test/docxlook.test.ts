import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../../shared/blocks';
import { boldParagraphStyles, readDocxLook } from '../../shared/docxlook';
import { cleanLook, lookVars } from '../../shared/look';
import { renderDoc } from '../../shared/render';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const parse = (x: string) => new JSDOM(x, { contentType: 'application/xml' }).window.document;

// a CV the way Word writes one: theme fonts, a Normal style, a heading style based on it, runs that override
const theme = `<a:theme ${W}><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
const styles = `<w:styles ${W}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Section"><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr></w:pPr>
    <w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/><w:b/><w:caps/><w:color w:val="1F4E79"/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;
const p = (text: string, opts: { style?: string; rPr?: string } = {}) =>
  `<w:p>${opts.style ? `<w:pPr><w:pStyle w:val="${opts.style}"/></w:pPr>` : ''}<w:r>${opts.rPr ? `<w:rPr>${opts.rPr}</w:rPr>` : ''}<w:t>${text}</w:t></w:r></w:p>`;
const document = `<w:document ${W}><w:body>
  ${p('Alex Example', { rPr: '<w:rFonts w:ascii="Cambria"/><w:b/><w:sz w:val="48"/><w:color w:val="1F4E79"/>' })}
  ${p('Data engineer with five years of experience.')}
  ${p('Experience', { style: 'Section' })}
  ${p('Data Engineer', { rPr: '<w:b/>' })}
  ${p('Built pipelines for the whole company.')}
  ${p('Education', { style: 'Section' })}
  <w:sectPr><w:pgMar w:left="1134" w:right="1134" w:top="1134" w:bottom="1134"/></w:sectPr>
</w:body></w:document>`;
const markdown = '# Alex Example\n\nData engineer with five years of experience.\n\n## Experience\n\n### Data Engineer | 2023\n\n- Built pipelines for the whole company.\n\n## Education\n';

describe("a Word file's own look", () => {
  it('reads fonts through theme, defaults, styles and runs, and matches them to name, headings, titles and text', () => {
    const look = readDocxLook({ document, styles, theme }, markdown, parse)!;
    expect(look.body).toEqual({ font: 'Calibri', size: 11, bold: false, caps: false, italic: false });
    expect(look.name).toMatchObject({ font: 'Cambria', size: 24, color: '#1f4e79', bold: true });
    expect(look.heading).toMatchObject({ font: 'Cambria', size: 13, color: '#1f4e79', bold: true, caps: true, rule: true });
    expect(look.entry).toMatchObject({ font: 'Calibri', size: 11, bold: true });
    expect(look.lineHeight).toBeCloseTo(1.35, 2); // 276/240 × Word's single line
    expect(look.after).toBe(6);                  // 120 twips
    expect(look.margin).toBe(20);                 // 1134 twips = 2 cm
    expect(look.align).toBe('justify');
  });

  it('a file without styles still gives a look from its runs, and an unreadable one gives none', () => {
    const plain = `<w:document ${W}><w:body>${p('Alex', { rPr: '<w:sz w:val="40"/>' })}${p('Text here')}</w:body></w:document>`;
    expect(readDocxLook({ document: plain }, '# Alex\n\nText here\n', parse)?.name?.size).toBe(20);
    expect(readDocxLook({ document: `<w:document ${W}><w:body/></w:document>` }, '', parse)).toBeUndefined();
  });

  it('values from a file can not escape into the page: fonts, colours and sizes are checked', () => {
    const evil = cleanLook({ body: { font: 'X"; background:url(https://evil.test/a)', size: 999, color: 'red;position:fixed' }, heading: { font: 'A}</style><script>', rule: 'yes' }, margin: -5 })!;
    expect(evil.body).toEqual({ font: 'X backgroundurlhttpsevil.testa' });
    expect(evil.heading).toEqual({ font: 'Astylescript' });
    expect(evil.margin).toBeUndefined();
    const html = renderDoc(parseBlocks('# A'), 'original', 'cv', 'en', {}, evil);
    const sheet = new JSDOM(html).window.document.querySelector('.sheet')!;
    expect(sheet.getAttributeNames().sort()).toEqual(['class', 'style']);
    expect(sheet.getAttribute('style')).not.toMatch(/url\(|<|;\s*position/);
    expect(lookVars(undefined)).toBe('');
  });

  it('draws the look with the page and keeps the formatting bar settings on top', () => {
    const look = readDocxLook({ document, styles, theme }, markdown, parse);
    const html = renderDoc(parseBlocks(markdown), 'original', 'cv', 'en', { align: 'left' }, look);
    const style = new JSDOM(html).window.document.querySelector('.sheet')!.getAttribute('style')!;
    expect(style).toContain('--o-font:"Calibri", Arimo, Arial, sans-serif');
    expect(style).toContain('--o-h-case:uppercase');
    expect(style).toContain('--o-mx:20mm');
    expect(html).toContain('st-left');
    // other looks ignore it
    expect(renderDoc(parseBlocks(markdown), 'classic', 'cv', 'en', {}, look)).not.toContain('--o-');
  });

  it('knows which paragraph styles are bold (through what they are based on), so headings bold by style are found', () => {
    const s = `<w:styles ${W}>
      <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Section"><w:name w:val="Section"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="SubSection"><w:name w:val="Sub section"/><w:basedOn w:val="Section"/></w:style>
      <w:style w:type="paragraph" w:styleId="Quiet"><w:name w:val="Quiet"/><w:basedOn w:val="Section"/><w:rPr><w:b w:val="0"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
    </w:styles>`;
    // Word's own headings are already headings for the reader; character styles are not paragraphs
    expect(boldParagraphStyles(s, parse)).toEqual(['Section', 'Sub section']);
  });
});
