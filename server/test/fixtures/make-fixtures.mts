// Builds the sample files of a made-up person, Alex Example, used by the end-to-end checks and the README
// screenshots: a Word CV (alex-cv.docx) and a PDF with a cover letter followed by the CV (alex-letter-and-cv.pdf).
//   npx tsx test/fixtures/make-fixtures.mts      (the PDF needs the local helper running: npm run dev)
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { parseBlocks } from '../../../shared/blocks';
import { renderDoc } from '../../../shared/render';

const DIR = import.meta.dirname;
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- the person ---------- */
const JOBS = [
  { title: 'Data Engineer', org: 'Harbour Foods, Hamburg', dates: '03/2023 – present', bullets: [
    'Built Python and SQL pipelines that feed the daily sales and delivery dashboards',
    'Moved weekly Excel reports to automated jobs, saving the team about four hours a week',
    'Designed the PostgreSQL data model for orders, customers and deliveries',
  ] },
  { title: 'Junior Developer', org: 'Kiel Apps, Kiel', dates: '09/2020 – 02/2023', bullets: [
    'Developed REST APIs in Flask for a mobile app with 20,000 users',
    'Introduced automated tests and code reviews for the backend team',
  ] },
];
const SKILLS = [['Languages', 'Python, SQL, TypeScript'], ['Tools', 'PostgreSQL, Airflow, Docker, Git'], ['Data', 'Pandas, dbt, Power BI']];

const CV_MD = `# Alex Example

Data Engineer

+49 151 000 0000 | alex@example.com | github.com/alex-example | 20095 Hamburg

Data engineer with five years of experience turning messy operational data into reliable pipelines and clear reports.

## Skills

${SKILLS.map(([k, v]) => `- **${k}:** ${v}`).join('\n')}

## Experience

${JOBS.map(j => `### ${j.title} | ${j.dates}\n${j.org}\n\n${j.bullets.map(b => `- ${b}`).join('\n')}`).join('\n\n')}

## Education

### B.Sc. Computer Science | 2020
University of Hamburg

## Languages

- English – C1
- German – native
`;

const LETTER_MD = `# Alex Example

Data Engineer
alex@example.com

---

May 2026

**Lumen Labs**

Berlin, Germany

**Re: Data Engineer**

Dear Lumen Labs Team,

Building smarter tools for music discovery is exactly the kind of mission that excites me, and I believe my background in data engineering makes me a strong fit for your team.

At Harbour Foods I build the Python and SQL pipelines behind our daily dashboards, and I moved our weekly reports to automated jobs that save the team hours every week.

I would love to help Lumen Labs turn listening data into features people enjoy, and I am available for a conversation at your convenience.

Kind regards,

**Alex Example**
`;

/* ---------- Word: contact table, bold headings, entries as "Title" + table row, real bullet lists ---------- */
function docx(): Uint8Array {
  const p = (text: string, o: { bold?: boolean; size?: number; bullet?: boolean } = {}) =>
    `<w:p>${o.bullet ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ''}<w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  const row = (cells: string[]) => `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr>${cells.map(c => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr></w:tbl>`;
  const body = [
    p('Alex Example', { bold: true, size: 40 }),
    p('Data Engineer'),
    row(['+49 151 000 0000', '| alex@example.com', '| github.com/alex-example', '| 20095 Hamburg']),
    p('Data engineer with five years of experience turning messy operational data into reliable pipelines and clear reports.'),
    p('SKILLS', { bold: true }),
    ...SKILLS.map(([k, v]) => p(`${k}: ${v}`, { bullet: true })),
    p('EXPERIENCE', { bold: true }),
    ...JOBS.flatMap(j => [p(j.title, { bold: true }), row([j.org, j.dates]), ...j.bullets.map(b => p(b, { bullet: true }))]),
    p('EDUCATION', { bold: true }),
    p('B.Sc. Computer Science', { bold: true }), row(['University of Hamburg', '2020']),
    p('LANGUAGES', { bold: true }),
    p('English – C1'), p('German – native'),
  ].join('');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`),
    'word/numbering.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
  });
}

/* ---------- PDF: the letter, then the CV, printed by the helper like an export ---------- */
async function pdf(): Promise<Uint8Array> {
  const css = fs.readFileSync(path.join(DIR, '../../../web/src/themes.css'), 'utf8');
  const one = async (md: string, kind: 'cv' | 'cover') => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0}</style></head><body>${renderDoc(parseBlocks(md), 'classic', kind, 'en')}</body></html>`;
    const r = await fetch('http://127.0.0.1:4317/api/pdf', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' }, body: JSON.stringify({ html }) });
    if (!r.ok) throw new Error(`helper: ${r.status} ${await r.text()}`);
    return PDFDocument.load(new Uint8Array(await r.arrayBuffer()));
  };
  const out = await PDFDocument.create();
  for (const d of [await one(LETTER_MD, 'cover'), await one(CV_MD, 'cv')]) (await out.copyPages(d, d.getPageIndices())).forEach(pg => out.addPage(pg));
  out.setTitle('Alex Example – letter and CV');
  return out.save();
}

fs.writeFileSync(path.join(DIR, 'alex-cv.docx'), docx());
fs.writeFileSync(path.join(DIR, 'alex-letter-and-cv.pdf'), await pdf());
console.log('wrote alex-cv.docx and alex-letter-and-cv.pdf');
