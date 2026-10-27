// The PDF importer on a real file (not part of `npm test`): npx tsx test/live/pdf-import.mts <file.pdf>
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { importDocxHtml } from '../../../shared/docx';
import { pdfItems, pdfToHtml } from '../../../shared/pdftext';

const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), isEvalSupported: false }).promise;
for (const part of pdfToHtml(await pdfItems(doc as never))) {
  const r = importDocxHtml(part.html, h => new JSDOM(h).window.document);
  console.log(`===== pages ${part.pages.join(', ')} · kind ${r.kind} · lang ${r.lang} · found ${JSON.stringify(r.found)}`);
  console.log(r.markdown);
}
