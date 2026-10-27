import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { importDocxHtml } from '../../shared/docx';
import { pdfToHtml, type PdfItem } from '../../shared/pdftext';

const parse = (h: string) => new JSDOM(h).window.document;
/** a run of text at (x, y) in a 10pt font; width ≈ 5pt per character, like a real PDF */
const t = (str: string, x: number, y: number, o: Partial<PdfItem> = {}): PdfItem => ({ str, x, y, w: str.length * 5, size: 10, bold: false, ...o });

const letter: PdfItem[] = [
  t('Alex Example', 72, 760, { size: 13, bold: true }),
  t('Data Engineer', 72, 746), t('alex@example.com', 72, 733),
  t('Acme GmbH', 72, 700, { bold: true }),
  t('Dear Hiring Team,', 72, 670),
  // a justified paragraph: wrapped over two full-width lines
  t('I would like to apply for the data engineering role at Acme because it fits my experience well and', 72, 640),
  t('my interests too.', 72, 627),
  t('Kind regards,', 72, 600),
];
const cv: PdfItem[] = [
  t('Alex Example', 36, 790, { size: 20, bold: true }),
  t('+49 151 000 0000', 36, 770), t('|', 120, 770), t('alex@example.com', 132, 770),
  t('SKILLS', 36, 740, { size: 12, bold: true }),
  t('●', 36, 720), t('Languages: Python, SQL', 54, 720),
  t('EXPERIENCE', 36, 690, { size: 12, bold: true }),
  t('Data Engineer', 36, 670, { bold: true }),
  t('Acme GmbH, Berlin', 36, 658), t(' ', 121, 658, { w: 350 }), t('01/2023 – now', 476, 658),
  // justified words and a split ligature ("Work" "fl" "ows")
  t('●', 36, 640), t('Built', 54, 640), t('Work', 90, 640), t('fl', 110, 640, { w: 6 }), t('ows', 116, 640), t('in', 140, 640), t('Airflow', 154, 640),
  t('●', 36, 626), t('Moved all weekly reports from manual Excel exports to automated pipelines that', 54, 626),
  t('run every night', 54, 614),
];

describe('PDF import', () => {
  it('splits a cover letter and a CV in one file into two documents', () => {
    const parts = pdfToHtml([letter, cv]);
    expect(parts.map(p => p.pages)).toEqual([[1], [2]]);
  });

  it('reads the letter: header, divider, bold lines stay text, wrapped paragraph joined', () => {
    const [l] = pdfToHtml([letter]);
    const r = importDocxHtml(l.html, parse);
    expect(r.kind).toBe('cover');
    expect(r.markdown.split('\n').filter(Boolean)).toEqual([
      '# Alex Example', 'Data Engineer', 'alex@example.com', '---', '**Acme GmbH**', 'Dear Hiring Team,',
      'I would like to apply for the data engineering role at Acme because it fits my experience well and my interests too.',
      'Kind regards,',
    ]);
  });

  it('reads the CV: name, contact, sections, entry with right-aligned dates, rejoined words, wrapped bullet', () => {
    const [c] = pdfToHtml([cv]);
    const r = importDocxHtml(c.html, parse);
    expect(r.kind).toBe('cv');
    expect(r.markdown.split('\n').filter(Boolean)).toEqual([
      '# Alex Example',
      '+49 151 000 0000 | alex@example.com',
      '## SKILLS',
      '- **Languages:** Python, SQL',
      '## EXPERIENCE',
      '### Data Engineer | 01/2023 – now',
      'Acme GmbH, Berlin',
      '- Built Workflows in Airflow',
      '- Moved all weekly reports from manual Excel exports to automated pipelines that run every night',
    ]);
    expect(r.found).toMatchObject({ name: 'Alex Example', email: 'alex@example.com', phone: '+49 151 000 0000' });
  });

  it('a PDF without text gives no documents', () => {
    expect(pdfToHtml([[], []])).toEqual([]);
  });
});
