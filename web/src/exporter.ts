import { parseBlocks } from '@shared/blocks';
import { renderMeta } from '@shared/render';
import { api, type Doc } from './api';
import { drawPdf } from './pdfdraw';

/*
  Final bucket → one merged PDF, or a zip of separate files, in the bucket's order.
  - Documents (.md) become PDFs right here in the browser (pdfdraw.ts): laid out with the app's own fonts and
    broken into pages as the editor shows them, with real text that applicant tracking systems can read.
  - Attached PDFs are copied in page by page; images become one A4 page each.
  - Anything else (a .docx, say) can't be merged; it still goes into the zip.
  pdf-lib and fflate load only when exporting.
*/
export interface BundleItem { name: string; title: string; kind: 'doc' | 'pdf' | 'image' | 'other'; pages: number; note?: string }
export interface Bundle { pdf: Uint8Array; items: BundleItem[]; parts: { name: string; file: string; bytes: Uint8Array }[]; pages: number }

const kindOf = (n: string): BundleItem['kind'] => n.endsWith('.md') ? 'doc' : /\.pdf$/i.test(n) ? 'pdf' : /\.(png|jpe?g)$/i.test(n) ? 'image' : 'other';
export const safe = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'file';

/* ---------- PDFs ---------- */
const pdfCache = new Map<string, Promise<Uint8Array>>(); // same document text and look → same PDF

async function docPdf(d: Doc, author: string): Promise<Uint8Array> {
  const key = JSON.stringify([d.body, d.meta, author]);
  if (!pdfCache.has(key)) {
    pdfCache.set(key, drawPdf(renderMeta(parseBlocks(d.body), d.meta), { title: d.meta.title, author }));
    pdfCache.get(key)!.catch(() => pdfCache.delete(key));
  }
  return pdfCache.get(key)!;
}
/** forget the PDFs made so far (the fonts they could use changed) */
export const forgetPdfs = () => pdfCache.clear();

const A4 = [595.28, 841.89] as const;

export async function buildBundle(jobId: string, order: string[], docs: Doc[], meta: { title: string; author: string }, onProgress: (msg: string) => void = () => {}): Promise<Bundle> {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const items: BundleItem[] = [];
  const parts: Bundle['parts'] = [];

  for (const [i, name] of order.entries()) {
    const kind = kindOf(name);
    const doc = docs.find(d => d.name === name);
    const title = doc?.meta.title ?? name;
    const n = String(i + 1).padStart(2, '0');
    onProgress(`Preparing ${title} (${i + 1} of ${order.length})…`);
    if (kind === 'doc') {
      if (!doc) continue;
      const bytes = await docPdf(doc, meta.author);
      const src = await PDFDocument.load(bytes);
      (await merged.copyPages(src, src.getPageIndices())).forEach(p => merged.addPage(p));
      items.push({ name, title, kind, pages: src.getPageCount() });
      parts.push({ name, file: `${n}_${safe(title)}.pdf`, bytes });
      continue;
    }
    const bytes = new Uint8Array(await (await api.fileBlob(jobId, name)).arrayBuffer());
    parts.push({ name, file: `${n}_${name}`, bytes });
    if (kind === 'pdf') {
      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        (await merged.copyPages(src, src.getPageIndices())).forEach(p => merged.addPage(p));
        items.push({ name, title, kind, pages: src.getPageCount() });
      } catch {
        items.push({ name, title, kind: 'other', pages: 0, note: "this PDF can't be read (damaged or protected), so it is only in the zip" });
      }
    } else if (kind === 'image') {
      const img = /\.png$/i.test(name) ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
      const page = merged.addPage([...A4]);
      const m = 36, s = Math.min((A4[0] - 2 * m) / img.width, (A4[1] - 2 * m) / img.height, 1);
      page.drawImage(img, { x: (A4[0] - img.width * s) / 2, y: (A4[1] - img.height * s) / 2, width: img.width * s, height: img.height * s });
      items.push({ name, title, kind, pages: 1 });
    } else {
      items.push({ name, title, kind, pages: 0, note: "can't be merged into a PDF, so it is only in the zip" });
    }
  }
  merged.setTitle(meta.title); merged.setAuthor(meta.author); merged.setCreator('Easy Apply'); merged.setProducer('Easy Apply');
  onProgress('');
  return { pdf: await merged.save(), items, parts, pages: merged.getPageCount() };
}

/** the zip: the merged PDF plus every file on its own, numbered in bucket order */
export async function bundleZip(b: Bundle, name: string): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = { [`${name}.pdf`]: b.pdf };
  for (const p of b.parts) files[`${name}/${p.file}`] = p.bytes;
  return new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/zip' });
}

export function download(data: Blob | Uint8Array, file: string, type = 'application/pdf') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: file });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
