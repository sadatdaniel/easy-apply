// Builds the sample files of a made-up person, Alex Example, used by the end-to-end checks and the README
// screenshots: a Word CV (alex-cv.docx) and a PDF with a cover letter followed by the CV (alex-letter-and-cv.pdf).
//   npx tsx test/fixtures/make-fixtures.mts      (writes the Word CV; the PDF was exported from the app)
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

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

/* ---------- Word: contact table, bold headings, entries as "Title" + table row, real bullet lists, and a look
   of its own (Georgia text, blue capital headings with a line under them, 2 cm side margins) ---------- */
function docx(): Uint8Array {
  const p = (text: string, o: { bold?: boolean; size?: number; bullet?: boolean; style?: string; color?: string } = {}) => {
    const pPr = (o.style ? `<w:pStyle w:val="${o.style}"/>` : '') + (o.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '');
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  };
  const row = (cells: string[]) => `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr>${cells.map(c => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr></w:tbl>`;
  const body = [
    p('Alex Example', { bold: true, size: 44, color: '2E5597' }),
    p('Data Engineer'),
    row(['+49 151 000 0000', '| alex@example.com', '| github.com/alex-example', '| 20095 Hamburg']),
    p('Data engineer with five years of experience turning messy operational data into reliable pipelines and clear reports.'),
    p('SKILLS', { style: 'Section' }),
    ...SKILLS.map(([k, v]) => p(`${k}: ${v}`, { bullet: true })),
    p('EXPERIENCE', { style: 'Section' }),
    ...JOBS.flatMap(j => [p(j.title, { bold: true }), row([j.org, j.dates]), ...j.bullets.map(b => p(b, { bullet: true }))]),
    p('EDUCATION', { style: 'Section' }),
    p('B.Sc. Computer Science', { bold: true }), row(['University of Hamburg', '2020']),
    p('LANGUAGES', { style: 'Section' }),
    p('English – C1'), p('German – native'),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>',
  ].join('');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'word/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="21"/><w:color w:val="333333"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Section"><w:name w:val="Section"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="2E5597"/></w:pBdr><w:spacing w:before="240"/></w:pPr><w:rPr><w:b/><w:caps/><w:color w:val="2E5597"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`),
    'word/numbering.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
  });
}

fs.writeFileSync(path.join(DIR, 'alex-cv.docx'), docx());
// alex-letter-and-cv.pdf is the made-up letter and CV exported from the app (Export: letter, then CV)
console.log('wrote alex-cv.docx');
