import { parseBlocks } from '@shared/blocks';
import { renderDoc } from '@shared/render';
import { api, HELPER, type Doc } from './api';
import themesCss from './themes.css?raw';

/*
  Final bucket → one merged PDF, or a zip of separate files, in the bucket's order.
  - Documents (.md) become PDFs through the local helper, which prints them with the installed Edge/Chrome:
    real text, selectable and readable by applicant tracking systems. The page carries its own fonts
    (embedded below), so the PDF looks the same online and offline.
  - Attached PDFs are copied in page by page; images become one A4 page each.
  - Anything else (a .docx, say) can't be merged; it still goes into the zip.
  pdf-lib and fflate load only when exporting.
*/
export interface BundleItem { name: string; title: string; kind: 'doc' | 'pdf' | 'image' | 'other'; pages: number; note?: string }
export interface Bundle { pdf: Uint8Array; items: BundleItem[]; parts: { name: string; file: string; bytes: Uint8Array }[]; pages: number }

const kindOf = (n: string): BundleItem['kind'] => n.endsWith('.md') ? 'doc' : /\.pdf$/i.test(n) ? 'pdf' : /\.(png|jpe?g)$/i.test(n) ? 'image' : 'other';
export const safe = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'file';

/* ---------- fonts: inline the ones a theme uses, as data URLs ---------- */
const fontCache = new Map<string, Promise<string>>();

function familiesFor(theme: string) {
  const fams = new Set<string>(['Inter']); // placeholder chips
  for (const m of themesCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].includes(`.t-${theme}`) && !/^\s*\.sheet\b/.test(m[1])) continue;
    for (const f of m[2].matchAll(/font-family:\s*([^;]+)/g))
      for (const name of f[1].split(',')) fams.add(name.trim().replace(/^['"]|['"]$/g, ''));
  }
  return fams;
}

async function fontFaces(theme: string): Promise<string> {
  const want = familiesFor(theme);
  const out: Promise<string>[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of [...rules]) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const fam = r.style.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '');
      const src = r.style.getPropertyValue('src').match(/url\(["']?([^"')]+\.woff2)["']?\)/)?.[1];
      if (!want.has(fam) || !src) continue;
      const url = new URL(src, sheet.href ?? location.href).href;
      if (!fontCache.has(url)) fontCache.set(url, fetch(url).then(r => r.blob()).then(blobToDataUrl));
      out.push(fontCache.get(url)!.then(data => `@font-face{font-family:'${fam}';font-style:${r.style.getPropertyValue('font-style') || 'normal'};font-weight:${r.style.getPropertyValue('font-weight') || '400'};${r.style.getPropertyValue('unicode-range') ? `unicode-range:${r.style.getPropertyValue('unicode-range')};` : ''}src:url(${data}) format('woff2');}`));
    }
  }
  return (await Promise.all(out)).join('\n');
}

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = rej; f.readAsDataURL(new Blob([b], { type: 'font/woff2' })); });

/** a complete, self-contained HTML page for one document */
export async function docHtml(d: Doc): Promise<string> {
  const page = renderDoc(parseBlocks(d.body), d.meta.theme, d.meta.kind, d.meta.lang, d.meta.style);
  const esc = (s: string) => s.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'));
  return `<!doctype html><html lang="${esc(d.meta.lang)}"><head><meta charset="utf-8"><title>${esc(d.meta.title)}</title><style>
${await fontFaces(d.meta.theme)}
${themesCss}
body{margin:0;background:#fff}
/* an unfilled placeholder prints as plain text, not as an on-screen chip */
.sheet .ph{background:none;color:inherit;font:inherit;padding:0}
</style></head><body>${page}</body></html>`;
}

/* ---------- PDFs ---------- */
const pdfCache = new Map<string, Promise<Uint8Array>>(); // same document text and look → same PDF

async function docPdf(d: Doc): Promise<Uint8Array> {
  const key = JSON.stringify([d.body, d.meta]);
  if (!pdfCache.has(key)) {
    pdfCache.set(key, (async () => {
      const r = await fetch(`${HELPER}/api/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html: await docHtml(d) }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `The helper could not create the PDF (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    })());
    pdfCache.get(key)!.catch(() => pdfCache.delete(key));
  }
  return pdfCache.get(key)!;
}

export async function pdfReady(): Promise<boolean> {
  try { const r = await fetch(`${HELPER}/api/helper`, { signal: AbortSignal.timeout(1500) }); return r.ok && !!(await r.json()).pdf; } catch { return false; }
}

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
      const bytes = await docPdf(doc);
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
