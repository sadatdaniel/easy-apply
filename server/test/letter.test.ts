import { describe, expect, it } from 'vitest';
import { findLetterDetails, generalizeLetter } from '../../shared/letter';

// a typical letter, as the PDF import reads it
const lumen = `# Alex Example

Software Developer & Data Analyst

alex@example.com

---

May 2026

**Lumen Labs**

Hamburg, Germany

**Re: Senior Full-Stack Developer / Data Scientist**

Dear Lumen Labs Team,

Building smarter tools for music discovery is exactly the kind of mission that excites me. I am confident I can grow alongside Lumen Labs.

I am excited by what Lumen Labs is building and would love to join as Senior Full-Stack Developer / Data Scientist.

Warm regards,

**Alex Example**`;

describe('reusing an uploaded cover letter', () => {
  it('finds the job details in an English letter', () => {
    expect(findLetterDetails(lumen)).toEqual({ company: 'Lumen Labs', role: 'Senior Full-Stack Developer / Data Scientist', date: 'May 2026', location: 'Hamburg, Germany' });
  });

  it('replaces every mention, keeps the sender header and formatting', () => {
    const r = generalizeLetter(lumen, findLetterDetails(lumen));
    expect(r.counts).toEqual({ company: 4, role: 2, date: 1, location: 1 });
    expect(r.markdown).toContain('# Alex Example');
    expect(r.markdown).toContain('**{{company}}**');
    expect(r.markdown).toContain('**Re: {{job_title}}**');
    expect(r.markdown).toContain('Dear {{company}} Team,');
    expect(r.markdown).toContain('{{today}}');
    expect(r.markdown).toContain('{{job_location}}');
    expect(r.markdown).toContain('grow alongside {{company}}.');
    expect(r.markdown).not.toMatch(/Lumen Labs|May 2026|Hamburg, Germany/);
  });

  it('finds the details in a German letter with the recipient before the date', () => {
    const de = `# Alex Beispiel\n\nalex@example.com\n\n---\n\nHafenblick Analytics GmbH\nPersonalabteilung\n20457 Hamburg\n\nHamburg, den 27.10.2026\n\n**Bewerbung als Junior Datenanalyst (m/w/d)**\n\nSehr geehrte Damen und Herren,\n\nbei der Hafenblick Analytics GmbH möchte ich …`;
    const d = findLetterDetails(de);
    expect(d).toEqual({ company: 'Hafenblick Analytics GmbH', role: 'Junior Datenanalyst (m/w/d)', date: '27.10.2026', location: '20457 Hamburg' });
    const r = generalizeLetter(de, d);
    expect(r.markdown).toContain('bei der {{company}} möchte');
    expect(r.markdown).toContain('Hamburg, den {{today}}');
  });

  it('falls back to "Dear X Team" and does not touch partial words', () => {
    const md = `# A\n\na@x.test\n\n---\n\nDear Nordlicht Team,\n\nNordlicht and Nordlichter are different words.`;
    const d = findLetterDetails(md);
    expect(d.company).toBe('Nordlicht');
    expect(generalizeLetter(md, d).markdown).toContain('{{company}} and Nordlichter are different');
  });

  it('a letter that is already a template stays as it is', () => {
    const md = `# {{name}}\n\n{{email}}\n\n---\n\n{{today}}\n\n{{company}}\n\n**Application for {{job_title}}**\n\nDear Hiring Team,\n\nText.`;
    const r = generalizeLetter(md, findLetterDetails(md));
    expect(r.markdown).toBe(md);
  });
});
