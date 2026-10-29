import { CONTENT, MARGIN, PAGE_H, paginate } from './paginate';

/*
  A document's PDF, made in the browser: no helper, nothing sent anywhere. The page is laid out off screen
  with the app's own styles and fonts and broken into pages exactly as the editor shows them (paginate.ts);
  then everything is drawn into the PDF where the browser put it: each word at its own position (so
  justified text stays justified), lines and borders, bullet dots, separators, coloured areas. The text is
  real text in embedded fonts, so job portals can read it.
*/

type PDFLib = typeof import('pdf-lib');
type PDFFont = import('pdf-lib').PDFFont;
type PDFPage = import('pdf-lib').PDFPage;

const PT = 0.75;                        // CSS px → PDF points
const W_PT = 595.28, H_PT = 841.89;     // A4

interface Face { family: string; weight: number; style: string; url: string; ranges: [number, number][] }

/** the fonts the app ships: every @font-face rule in the page's style sheets */
function faces(): Face[] {
  const out: Face[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of [...rules]) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      // the .woff file: the PDF library's WOFF2 reader hangs on some fonts (Fira Sans), its WOFF reader does not
      const urls = [...r.style.getPropertyValue('src').matchAll(/url\(["']?([^"')]+\.woff2?)["']?\)/g)].map(m => m[1]);
      const src = urls.find(u => u.endsWith('.woff')) ?? urls[0];
      if (!src) continue;
      const ranges = (r.style.getPropertyValue('unicode-range') || 'U+0-10FFFF').split(',').map(s => {
        const [a, b] = s.trim().replace(/^U\+/i, '').split('-');
        const lo = parseInt(a.replace(/\?/g, '0'), 16), hi = b ? parseInt(b, 16) : parseInt(a.replace(/\?/g, 'F'), 16);
        return [lo, hi] as [number, number];
      });
      const w = r.style.getPropertyValue('font-weight').split(/\s+/).map(Number);
      out.push({ family: r.style.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '').toLowerCase(), weight: w[0] || 400, style: r.style.getPropertyValue('font-style') || 'normal', url: new URL(src, sheet.href ?? location.href).href, ranges });
    }
  }
  return out;
}

// fonts a document may name that the app doesn't ship, and the shipped font with the same letter widths
const STAND_IN: Record<string, string> = { arial: 'arimo', helvetica: 'arimo', 'helvetica neue': 'arimo', 'times new roman': 'tinos', times: 'tinos', 'sans-serif': 'arimo', serif: 'tinos' };

/*
  Fonts installed on this computer: an uploaded Word file keeps its own font (Calibri, Cambria, ...), which the
  app doesn't ship. Chrome and Edge can hand the font's file over, once the person allows it (Local Font
  Access); elsewhere, or when they don't, the page is laid out in the shipped stand-in instead, so what is
  drawn is always the font the words were measured in.
*/
interface LocalFace { family: string; style: string; postscriptName: string; blob(): Promise<Blob> }
interface LocalFile { bytes: Uint8Array; weight: number; italic: boolean; name: string }
const queryLocalFonts = (window as unknown as { queryLocalFonts?: () => Promise<LocalFace[]> }).queryLocalFonts?.bind(window);
let localList: Promise<LocalFace[]> | undefined;
const localFaces = () => localList ??= (async () => {
  // asked only once allowed: without a click to answer it, the browser's question can't be shown anyway
  if (!queryLocalFonts || await fontAccess() !== 'granted') return [];
  try { return await queryLocalFonts(); } catch { return []; }
})();

/** whether the PDF may use the fonts on this computer: 'ask' means the person hasn't been asked yet */
export async function fontAccess(): Promise<'granted' | 'ask' | 'denied' | 'unsupported'> {
  if (!queryLocalFonts) return 'unsupported';
  try {
    const s = (await navigator.permissions.query({ name: 'local-fonts' as PermissionName })).state;
    return s === 'prompt' ? 'ask' : s;
  } catch { return 'unsupported'; }
}
/** asks the browser's question (call it from a click); afterwards the fonts are looked up afresh */
export async function askFontAccess(): Promise<boolean> {
  try { await queryLocalFonts?.(); } catch { /* said no */ }
  localList = undefined; localFiles.clear();
  return (await fontAccess()) === 'granted';
}
/** the fonts a document's own look names that the app doesn't ship: they need the computer's copies */
export function ownFonts(look: unknown): string[] {
  const shipped = new Set(faces().map(f => f.family));
  const names = Object.values((look ?? {}) as Record<string, { font?: string } | unknown>)
    .map(t => (t && typeof t === 'object' ? (t as { font?: string }).font : undefined)).filter((f): f is string => !!f);
  return [...new Set(names)].filter(f => !shipped.has(f.toLowerCase()));
}
const WEIGHTS: [RegExp, number][] = [[/thin|hairline/, 100], [/extra ?light|ultra ?light/, 200], [/semi ?light|light/, 300],
  [/medium/, 500], [/semi ?bold|demi ?bold/, 600], [/extra ?bold|ultra ?bold/, 800], [/black|heavy/, 900], [/bold/, 700]];
const weightOf = (style: string) => WEIGHTS.find(([re]) => re.test(style.toLowerCase()))?.[1] ?? 400;
const localFiles = new Map<string, Promise<LocalFile[]>>();
/** the installed faces of a family, as files: none when it isn't installed or the person said no */
function localFamily(family: string): Promise<LocalFile[]> {
  const key = family.toLowerCase();
  if (!localFiles.has(key)) localFiles.set(key, localFaces().then(all => Promise.all(all
    .filter(f => f.family.toLowerCase() === key)
    .map(async f => ({ bytes: new Uint8Array(await (await f.blob()).arrayBuffer()), weight: weightOf(f.style), italic: /italic|oblique/i.test(f.style), name: f.postscriptName })))));
  return localFiles.get(key)!;
}
// a font collection file (.ttc: Cambria, some system fonts) holds several fonts; the PDF needs the one by name
const inCollection = new WeakMap<Uint8Array, string>();

export async function drawPdf(html: string, meta: { title: string; author: string }): Promise<Uint8Array> {
  const lib: PDFLib = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const pdf = await lib.PDFDocument.create();
  pdf.registerFontkit({ create: (bytes: Uint8Array) => fontkit.create(bytes, inCollection.get(bytes)) } as unknown as typeof fontkit);
  pdf.setTitle(meta.title); pdf.setAuthor(meta.author); pdf.setCreator('Easy Apply'); pdf.setProducer('Easy Apply');

  // lay the page out off screen, in pages
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-20000px;top:0;width:210mm;pointer-events:none;';
  box.innerHTML = html;
  document.body.append(box);
  try {
    const sheet = box.querySelector<HTMLElement>('.sheet');
    if (!sheet) throw new Error('Nothing to print.');
    sheet.classList.add('paged');
    // the file's own fonts (the look's --o-…font): one that can't be put in the PDF is left out of the page too,
    // so it is laid out in the stand-in that will be drawn
    const all = faces();
    const ownFonts = new Set<string>();   // only these are looked for on the computer (the permission is asked for them)
    for (const el of [sheet, ...sheet.querySelectorAll<HTMLElement>('[style*="font"]')]) {
      for (const prop of [...el.style].filter(p => /^--o-(\w+-)?font$/.test(p))) {
        const value = el.style.getPropertyValue(prop);
        const own = value.match(/^\s*"([^"]+)"\s*,\s*(.*)$/);
        if (!own || all.some(f => f.family === own[1].toLowerCase())) continue;
        if ((await localFamily(own[1])).length) ownFonts.add(own[1].toLowerCase());
        else el.style.setProperty(prop, own[2]);
      }
    }
    void sheet.offsetHeight;
    await document.fonts.ready;
    const { pages } = paginate(sheet, PAGE_H);
    const origin = sheet.getBoundingClientRect();
    const pageList: PDFPage[] = Array.from({ length: pages }, () => pdf.addPage([W_PT, H_PT]));

    /** a point of the laid-out sheet → its page and PDF coordinates */
    // snap: when the browser prints, a text baseline sits on a whole pixel within the page's content area, and the
    // margin above it is whole pixels too; ours do the same, or lines land up to a pixel off
    const at = (x: number, y: number, snap = false) => {
      const sy = y - origin.top;
      const k = Math.max(0, Math.min(pages - 1, Math.floor(sy / PAGE_H)));
      const py = snap ? Math.round(MARGIN) + Math.round(sy - k * PAGE_H) : MARGIN + sy - k * PAGE_H;
      return { page: pageList[k], k, x: (x - origin.left) * PT, y: H_PT - py * PT };
    };
    const color = (css: string) => {
      const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      return m ? { c: lib.rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255), a: m[4] === undefined ? 1 : +m[4] } : null;
    };

    /* ---------- fonts ---------- */
    const loaded = new Map<string, Promise<PDFFont>>();
    const fontFor = async (family: string, weight: number, style: string, text: string): Promise<PDFFont> => {
      const names = family.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
      // the weight the browser picks (CSS font matching): above 500 the next heavier one, below 400 the next
      // lighter one, in between 500 or the next lighter one first
      const rank = (w: number) => w === weight ? 0
        : weight > 500 ? (w > weight ? w - weight : 1000 + weight - w)
        : weight < 400 ? (w < weight ? weight - w : 1000 + w - weight)
        : (w > weight && w <= 500 ? w - weight : w < weight ? 500 + weight - w : 1000 + w - weight);
      const italic = style !== 'normal';
      // the first font named that the app ships or this computer has (the layout left out any it hasn't)
      for (const n of names) {
        if (all.some(f => f.family === n)) break;
        if (!ownFonts.has(n)) continue;
        const own = await localFamily(n);
        const pick = [...own].sort((a, b) => (Number(b.italic === italic) - Number(a.italic === italic)) || (rank(a.weight) - rank(b.weight)))[0];
        if (!loaded.has(pick.name)) {
          if (String.fromCharCode(...pick.bytes.subarray(0, 4)) === 'ttcf') inCollection.set(pick.bytes, pick.name);
          loaded.set(pick.name, pdf.embedFont(pick.bytes, { subset: true }));
        }
        return loaded.get(pick.name)!;
      }
      const wanted = names.find(n => all.some(f => f.family === n)) ?? names.map(n => STAND_IN[n]).find(Boolean) ?? 'arimo';
      const cands = all.filter(f => f.family === wanted);
      const cp = [...text].map(ch => ch.codePointAt(0)!).filter(c => c > 32);
      const covers = (f: Face) => cp.every(c => f.ranges.some(([lo, hi]) => c >= lo && c <= hi));
      const pick = [...cands].sort((a, b) =>
        (Number(covers(b)) - Number(covers(a))) || (Number(b.style === style) - Number(a.style === style)) || (rank(a.weight) - rank(b.weight)))[0];
      if (!pick) return fontFor('arimo', weight, style, text);
      if (!loaded.has(pick.url)) loaded.set(pick.url, fetch(pick.url).then(r => r.arrayBuffer()).then(b => pdf.embedFont(b, { subset: true })));
      return loaded.get(pick.url)!;
    };

    /** where the baseline sits below the top of a line of text, for a font (measured in the page, like it lays out) */
    const baselines = new Map<string, number>();
    const baseline = (st: CSSStyleDeclaration) => {
      const key = [st.fontFamily, st.fontWeight, st.fontStyle, st.fontSize].join('|');
      if (!baselines.has(key)) {
        const probe = document.createElement('span');
        probe.style.cssText = `font-family:${st.fontFamily};font-weight:${st.fontWeight};font-style:${st.fontStyle};font-size:${st.fontSize};line-height:normal;white-space:nowrap`;
        probe.innerHTML = '<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>Hg';
        box.append(probe);
        const text = document.createRange(); text.selectNodeContents(probe.lastChild!);
        baselines.set(key, probe.firstElementChild!.getBoundingClientRect().top - text.getBoundingClientRect().top);
        probe.remove();
      }
      return baselines.get(key)!;
    };
    const zoomOf = (el: Element | null) => { let z = 1; for (let e = el; e && e !== box; e = e.parentElement) z *= parseFloat(getComputedStyle(e).zoom || '1') || 1; return z; };

    // texts are drawn in reading order, once their fonts are loaded: the order in the file is the order a job
    // portal reads them in
    const jobs: { font: Promise<PDFFont>; draw: (font: PDFFont) => void }[] = [];
    /** text at a position: x, and the top of its line box, in page pixels */
    /** `src`: where the word is in the page, so its letters can be placed one by one where its width differs */
    const text = (str: string, left: number, top: number, st: CSSStyleDeclaration, zoom: number, src?: { node: Text; start: number; width: number }) => {
      const c = color(st.color);
      if (!c || c.a === 0 || !str.trim()) return;
      // blank characters (no-break, thin and other spaces) as plain spaces, invisible ones left out: the PDF
      // library's font trimming fails on their empty glyphs in some fonts (Arimo, Source Serif)
      const plain = str.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ').replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '');
      const t = st.textTransform === 'uppercase' ? plain.toUpperCase() : st.textTransform === 'lowercase' ? plain.toLowerCase() : plain;
      if (!t.trim()) return;
      const size = parseFloat(st.fontSize) * zoom;
      const spacing = (parseFloat(st.letterSpacing) || 0) * zoom;
      const p = at(left, top + baseline(st) * zoom, true);
      jobs.push({ font: fontFor(st.fontFamily, parseInt(st.fontWeight) || 400, st.fontStyle, t), draw: font => {
        // the browser kerns (fine spacing between letter pairs) and the PDF doesn't: the difference is spread
        // over the word's letters, so it starts and ends where the browser put it and stays one word to read
        const own = font.widthOfTextAtSize(t, size * PT) + spacing * PT * Math.max(0, t.length - 1);
        const fix = src && t.length > 1 ? (src.width * PT - own) / (t.length - 1) : 0;
        const tc = spacing * PT + (Math.abs(fix) > 0.01 ? fix : 0);
        if (tc) p.page.pushOperators(lib.setCharacterSpacing(tc));
        p.page.drawText(t, { x: p.x, y: p.y, size: size * PT, font, color: c.c, opacity: c.a });
        if (tc) p.page.pushOperators(lib.setCharacterSpacing(0));
      } });
    };
    const rect = (x: number, y: number, w: number, h: number, css: string, round = false) => {
      const c = color(css);
      if (!c || c.a === 0 || w <= 0 || h <= 0) return;
      const p = at(x, y, !round);
      // box edges snap to whole pixels like text does (a 1px rule stays 1px, on the same pixel row)
      if (!round) h = Math.max(1, Math.round(y + h - origin.top) - Math.round(y - origin.top));
      if (round) p.page.drawEllipse({ x: p.x + (w * PT) / 2, y: p.y - (h * PT) / 2, xScale: (w * PT) / 2, yScale: (h * PT) / 2, color: c.c, opacity: c.a });
      else p.page.drawRectangle({ x: p.x, y: p.y - h * PT, width: w * PT, height: h * PT, color: c.c, opacity: c.a });
    };

    /* ---------- coloured areas: the page's own (the side column) and any element's ---------- */
    const bgImage = getComputedStyle(sheet).backgroundImage;
    const stripe = bgImage.match(/linear-gradient\(to right, (rgba?\([^)]+\)) ([\d.]+)px/);
    if (stripe) for (let k = 0; k < pages; k++) {
      const top = origin.top + k * PAGE_H, end = Math.min(origin.top + k * PAGE_H + CONTENT, origin.bottom);
      rect(origin.left, top, parseFloat(stripe[2]), end - top, stripe[1]);
    }

    /* ---------- every element: background, borders, ::before / ::after; then its text ---------- */
    // one walk through the page in reading order: an element's background and borders, its ::before, its
    // content (text and elements, in order), its ::after; so the text in the file reads as it does on the page
    const visit = (el: HTMLElement) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      const chip = el.matches('.ph'); // a placeholder chip prints as its plain text
      if (el !== sheet && !chip && r.width && r.height) rect(r.left, r.top, r.width, r.height, st.backgroundColor);
      const z = zoomOf(el);
      for (const side of ['Top', 'Bottom', 'Left', 'Right'] as const) {
        const w = parseFloat(st[`border${side}Width`]) * z;
        if (!w || st[`border${side}Style`] === 'none') continue;
        const css = st[`border${side}Color`];
        if (side === 'Top') rect(r.left, r.top, r.width, w, css);
        if (side === 'Bottom') rect(r.left, r.bottom - w, r.width, w, css);
        if (side === 'Left') rect(r.left, r.top, w, r.height, css);
        if (side === 'Right') rect(r.right - w, r.top, w, r.height, css);
      }
      const pseudoOf = (which: '::before' | '::after') => {
          const ps = getComputedStyle(el, which);
          const content = ps.content;
          if (chip || !content || content === 'none' || content === 'normal') return;
          const str = content.replace(/^["']|["']$/g, '');
          const pz = z;
          if (ps.position === 'absolute') {
            // a drawn bullet dot, or a dash or bullet character, placed inside its line
            const x = r.left + parseFloat(ps.left) * pz, y = r.top + (parseFloat(ps.top) || 0) * pz;
            if (str) text(str, x, r.top, ps, pz);
            else rect(x, y, parseFloat(ps.width) * pz, parseFloat(ps.height) * pz, ps.backgroundColor, parseFloat(ps.borderTopLeftRadius) > 0);
          } else if (str) {
            // a separator before a part of a line ("|", "·"): right before the part's own text
            const first = document.createRange();
            const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent?.trim()) ?? el.firstChild;
            if (!node) return;
            first.setStart(node, 0); first.setEnd(node, Math.min(1, node.textContent?.length ?? 0));
            const fr = first.getBoundingClientRect();
            // what separates it from the text: its margin, or the gap of a flex line
            const gap = (parseFloat(ps.marginRight) || 0) + (st.display.includes('flex') ? parseFloat(st.columnGap) || 0 : 0);
            const width = which === '::before' ? (measure(str, ps) + gap) * pz : 0;
            text(str, which === '::before' ? fr.left - width : r.right, fr.top, ps, pz);
          } else if (ps.backgroundColor && el.matches('h2')) {
            // a line that fills the rest of a heading (the Two-column look)
            const words = document.createRange(); words.selectNodeContents(el);
            const wr = words.getBoundingClientRect();
            const gap = parseFloat(st.columnGap) || 10;
            rect(wr.right + gap * pz, r.top + r.height / 2, r.right - wr.right - gap * pz, parseFloat(ps.height) * pz || 1, ps.backgroundColor);
          }
      };
      // a link: clickable where its text is, on each line it runs over
      const href = el instanceof HTMLAnchorElement && /^(https?:|mailto:|tel:)/i.test(el.href) ? el.href : '';
      if (href) for (const lr of el.getClientRects()) {
        const p = at(lr.left, lr.top);
        p.page.node.addAnnot(pdf.context.register(pdf.context.obj({
          Type: 'Annot', Subtype: 'Link', Border: [0, 0, 0],
          Rect: [p.x, p.y - lr.height * PT, p.x + lr.width * PT, p.y],
          A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of(href) },
        })));
      }
      pseudoOf('::before');
      for (const node of el.childNodes) {
        if (node instanceof HTMLElement) { visit(node); continue; }
        if (node.nodeType !== 3 || !node.textContent?.trim()) continue;
        const s = node.textContent;
        for (const m of s.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, m.index!); range.setEnd(node, m.index! + m[0].length);
          const rects = [...range.getClientRects()].filter(x => x.width > 0);
          if (rects.length <= 1) { if (rects[0]) text(m[0], rects[0].left, rects[0].top, st, z, { node: node as Text, start: m.index!, width: rects[0].width }); continue; }
          // a word broken across lines (a long link): each piece on its own line
          let from = m.index!;
          for (const rr of rects) {
            let to = from;
            const piece = document.createRange();
            while (to < m.index! + m[0].length) { piece.setStart(node, from); piece.setEnd(node, to + 1); if (piece.getBoundingClientRect().right > rr.right + 0.5) break; to++; }
            text(s.slice(from, to), rr.left, rr.top, st, z);
            from = to;
          }
        }
      }
      pseudoOf('::after');
    };
    visit(sheet);
    const fonts = await Promise.all(jobs.map(j => j.font));
    jobs.forEach((j, k) => j.draw(fonts[k]));

    /** the width of a little text in a style, measured by the browser */
    function measure(str: string, st: CSSStyleDeclaration) {
      const probe = document.createElement('span');
      probe.style.cssText = `font-family:${st.fontFamily};font-weight:${st.fontWeight};font-size:${st.fontSize};white-space:pre;letter-spacing:${st.letterSpacing}`;
      probe.textContent = str;
      box.append(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    }
    return await pdf.save();
  } finally {
    box.remove();
  }
}
