/*
  Where the pages break, decided once for the editor and the PDF alike, so both look the same.

  A page is A4 with 12 mm margins at the top and bottom (as the PDF is printed: see themes.css, @page).
  The page is measured as it is laid out: each line, bullet, heading or entry ("unit") that would run past
  the bottom of a page starts the next one instead; a heading (or an entry's title and company) never stays
  behind alone at the bottom.
  The editor shows that by pushing the unit down to the next page; the PDF gets a page break before it.
*/

const MM = 96 / 25.4;
export const PAGE_H = 297 * MM;          // 1122.5 px
export const MARGIN = 12 * MM;           // 45.4 px
export const CONTENT = PAGE_H - 2 * MARGIN;

interface Unit { box: HTMLElement; brk: HTMLElement; heading: boolean; col: Element }

/** the blocks of a rendered page, in order; each with what moves to the next page when it does */
function units(sheet: HTMLElement): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<HTMLElement>();
  for (const b of sheet.querySelectorAll<HTMLElement>('[data-b]')) {
    let brk = b;
    if (getComputedStyle(b).display === 'contents') brk = b.parentElement!; // Classic entry header: its entry moves
    // a block that opens its section or list moves together with it
    while (brk.parentElement && brk.parentElement !== sheet && !brk.parentElement.matches('.side, .main, header')
      && brk.parentElement.firstElementChild === brk) brk = brk.parentElement;
    if (seen.has(brk) || brk.closest('header') === brk) continue;
    seen.add(brk);
    out.push({ box: b, brk, heading: false, col: b.closest('.side, .main') ?? sheet });
  }
  // a heading stays with what follows it, as long as that belongs to it: a section's heading with the
  // section, an entry's title and company with the entry (an entry with nothing below them stands alone)
  out.forEach((u, i) => {
    const next = out[i + 1]?.box;
    if (!next || !u.box.matches('h2, .eh, .eo, .subject')) return;
    const group = u.box.matches('h2') ? u.box.closest('section') : u.box.matches('.eh, .eo') ? u.box.closest('.entry') : sheet;
    u.heading = !!group && group.contains(next);
  });
  return out;
}

/** the block's box; an entry header has no box of its own, so it is its parts' */
function rect(el: HTMLElement): { top: number; bottom: number } {
  const r = el.getBoundingClientRect();
  if (r.height || !el.children.length) return r;
  const rs = [...el.children].map(c => c.getBoundingClientRect());
  return { top: Math.min(...rs.map(x => x.top)), bottom: Math.max(...rs.map(x => x.bottom)) };
}

/** moves `el` so its top lands on `y` (page coordinates), whatever margins and zoom it has */
function pushTo(el: HTMLElement, y: number, top0: () => number) {
  el.dataset.push = '';
  el.style.marginTop = '0px';
  let applied = 0, at = el.getBoundingClientRect().top - top0();
  const from = at;
  for (let k = 0; k < 4 && Math.abs(y - at) > 0.25; k++) {
    // zoomed text (the formatting bar's size) moves by more or less than the margin we add
    const scale = applied ? (at - from) / applied || 1 : 1;
    applied += (y - at) / scale;
    el.style.marginTop = `${applied}px`;
    at = el.getBoundingClientRect().top - top0();
  }
}

/**
  Lays `sheet` out in pages. `pitch` is the distance from one page's text to the next one's: in the editor a
  whole page plus the gap between pages; for the PDF just the text height, pages back to back.
  Returns the number of pages and the elements that start a new page.
*/
export function paginate(sheet: HTMLElement, pitch: number): { pages: number; breaks: HTMLElement[] } {
  sheet.querySelectorAll<HTMLElement>('[data-push]').forEach(e => { e.style.marginTop = ''; delete e.dataset.push; });
  const top0 = () => sheet.getBoundingClientRect().top;
  const list = units(sheet);
  const breaks: HTMLElement[] = [];
  const pageOf = (y: number) => Math.floor((y + 0.5) / pitch);
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    const r = rect(u.box), t = r.top - top0(), b = r.bottom - top0();
    const page = pageOf(t);
    if (b <= page * pitch + CONTENT + 0.5 || b - t > CONTENT) continue; // fits (or could never fit: let it run)
    // a heading (or a run of them) right above goes along, unless it already starts its page
    let j = i;
    while (j > 0 && list[j - 1].heading && list[j - 1].col === u.col && !breaks.includes(list[j - 1].brk)) {
      const pt = rect(list[j - 1].box).top - top0();
      if (pageOf(pt) !== page || pt <= page * pitch + 1) break;
      j--;
    }
    pushTo(list[j].brk, (page + 1) * pitch, top0);
    breaks.push(list[j].brk);
    i = j;
  }
  const end = Math.max(0, ...list.map(u => rect(u.box).bottom - top0()));
  return { pages: Math.max(1, pageOf(end - 1) + 1), breaks };
}

/**
  The document's page as the PDF should print it: laid out off screen with the app's own fonts and styles,
  broken into pages exactly as the editor shows them. Returns the page's HTML with the breaks marked.
*/
export async function pagedHtml(html: string): Promise<string> {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-20000px;top:0;width:210mm;pointer-events:none;';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = html;
  document.body.append(box);
  try {
    const sheet = box.querySelector<HTMLElement>('.sheet');
    if (!sheet) return html;
    sheet.classList.add('paged');
    void sheet.offsetHeight;          // lay it out, so the fonts it uses start loading
    await document.fonts.ready;
    const { breaks } = paginate(sheet, CONTENT);
    sheet.querySelectorAll<HTMLElement>('[data-push]').forEach(e => { e.style.marginTop = ''; delete e.dataset.push; });
    for (const e of breaks) e.setAttribute('data-break', '');
    sheet.classList.remove('paged');
    return box.innerHTML;
  } finally {
    box.remove();
  }
}
