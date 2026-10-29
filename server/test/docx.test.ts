import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { importDocxHtml, toPlaceholders } from '../../shared/docx';

const parse = (h: string) => new JSDOM(h).window.document;
const md = (html: string) => importDocxHtml(html, parse);

describe('docx import', () => {
  it('reads a table-based CV: name, contact table, sections, entries, bullets', () => {
    const r = md(`
      <p><strong>Alex Example</strong></p>
      <table><tr><td><p>+49 151 000 0000 </p></td><td><p>| <a href="mailto:alex@example.com">alex@example.com</a></p></td><td><p>| Berlin</p></td></tr></table>
      <p>Data engineer who likes tidy pipelines.</p>
      <p><strong>SKILLS</strong></p>
      <ul><li>Languages: Python, SQL</li><li>Built things</li></ul>
      <p><strong>Professional Experience</strong></p>
      <p><strong>Data Engineer</strong></p>
      <table><tr><td><p>Acme GmbH, Berlin</p></td><td><p>01/2023 – present</p></td></tr></table>
      <ul><li>Moved reports to <strong>Airflow</strong></li></ul>
      <p><strong>CERTIFICATES</strong></p>
      <table><tr><td><p>Cloud Cert <a href="https://x.test/c">[Link]</a></p></td><td><p>Google | Coursera</p></td></tr></table>`);
    expect(r.markdown.split('\n').filter(Boolean)).toEqual([
      '# Alex Example',
      '+49 151 000 0000 | alex@example.com | Berlin',
      'Data engineer who likes tidy pipelines.',
      '## SKILLS',
      '- **Languages:** Python, SQL',
      '- Built things',
      '## Professional Experience',
      '### Data Engineer | 01/2023 – present',
      'Acme GmbH, Berlin',
      '- Moved reports to **Airflow**',
      '## CERTIFICATES',
      '### Cloud Cert [Link](https://x.test/c) | Google · Coursera',
    ]);
    expect(r.found).toMatchObject({ name: 'Alex Example', email: 'alex@example.com', phone: '+49 151 000 0000', location: 'Berlin' });
    expect(r.kind).toBe('cv');
    expect(r.lang).toBe('en');
  });

  it('reads heading styles and "Title<TAB>dates" lines, and detects German', () => {
    const r = md(`<h1>Alex Beispiel</h1><p>alex@example.com | Hamburg</p><h2>Berufserfahrung</h2>
      <p>Datenanalyst bei der Firma\t\t03/2021 – heute</p><p>Analyse von Daten und Berichte für die Abteilung mit Python</p>`);
    expect(r.markdown).toContain('### Datenanalyst bei der Firma | 03/2021 – heute');
    expect(r.lang).toBe('de');
  });

  it('keeps a bold line that is neither a section nor followed by an entry as bold text', () => {
    const r = md(`<p><strong>Name</strong></p><p><strong>EXPERIENCE</strong></p><p><strong>Selected highlights from ten years of work</strong></p><p>Text.</p>`);
    expect(r.markdown).toContain('**Selected highlights from ten years of work**');
  });

  it('recognises a cover letter', () => {
    const r = md(`<p><strong>Alex Example</strong></p><p>Dear Hiring Team,</p><p>I am writing to apply.</p><p>Kind regards,</p>`);
    expect(r.kind).toBe('cover');
  });

  it('turns header details into placeholders, but only exact matches', () => {
    const profile = { fields: [
      { key: 'name', label: '', value: 'Alex Example' }, { key: 'email', label: '', value: 'alex@example.com' },
      { key: 'phone', label: '', value: '+49 (151) 0000000' }, { key: 'website', label: '', value: 'https://alex.dev/' },
      { key: 'location', label: '', value: 'Berlin' },
    ] };
    const r = toPlaceholders('# Alex Example\n\n+49 151 000 0000 | alex@example.com | alex.dev | Berlin\n\n## Skills\n\n- Berlin wall of text', profile);
    expect(r.markdown).toBe('# {{name}}\n\n{{phone}} | {{email}} | {{website}} | {{location}}\n\n## Skills\n\n- Berlin wall of text');
    const longer = toPlaceholders('# Khan Alex Example\n\nalex@example.com', profile);
    expect(longer.markdown.startsWith('# Khan Alex Example')).toBe(true); // a different full name is kept
  });

  it('a layout table (photo beside the name and contact lines) is read as text, not as job rows', () => {
    const r = md(`
      <table><tr><td><p><img src=""></p></td><td><p><strong>Jamie Sample</strong></p><p>Projektmanagerin</p><p>Musterstraße 1, 20095 Hamburg</p><p>+49 170 000 0000 | jamie@example.com</p></td></tr></table>
      <p><strong>Berufserfahrung</strong></p><p><strong>Projektmanagerin</strong></p><ul><li>Leitung von 12 Projekten</li></ul>`);
    const lines = r.markdown.split('\n').filter(Boolean);
    expect(lines[0]).toBe('# Jamie Sample');
    expect(lines).toContain('Projektmanagerin');
    expect(r.markdown).toContain('+49 170 000 0000 | jamie@example.com');
    expect(r.markdown).toContain('## Berufserfahrung');
    expect(r.markdown).not.toMatch(/Jamie Sample.*Projektmanagerin.*Musterstra/);
  });
});
