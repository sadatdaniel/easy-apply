import { chromium, type Browser } from 'playwright-core';

/*
  HTML → PDF with real, selectable text (what applicant tracking systems read), using the Edge or Chrome
  that is already installed: nothing is downloaded. EASYCV_BROWSER can point at another Chromium.
  The page runs with JavaScript off and may not load anything: fonts and images arrive embedded as data: URLs.
  At most two PDFs render at a time, each within 30 seconds.
*/
let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | undefined;

async function launch(): Promise<Browser> {
  const tries: Parameters<typeof chromium.launch>[0][] = process.env.EASYCV_BROWSER
    ? [{ executablePath: process.env.EASYCV_BROWSER }]
    : [{ channel: 'msedge' }, { channel: 'chrome' }, { channel: 'chromium' }];
  for (const t of tries) {
    try { return await chromium.launch({ ...t, headless: true }); } catch { /* try the next one */ }
  }
  throw Object.assign(new Error('No Edge or Chrome found to create PDFs. Install one, or set EASYCV_BROWSER to a Chromium-based browser.'), { statusCode: 501 });
}

function getBrowser() {
  clearTimeout(idle);
  idle = setTimeout(async () => { const b = browser; browser = null; (await b)?.close().catch(() => {}); }, 120_000);
  browser ??= launch().catch(e => { browser = null; throw e; });
  return browser;
}

const ALLOWED = /^data:/;

let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>(r => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

export function htmlToPdf(html: string): Promise<Buffer> {
  return slot(async () => {
    const ctx = await (await getBrowser()).newContext({ javaScriptEnabled: false, offline: true });
    try {
      await ctx.route('**/*', r => (ALLOWED.test(r.request().url()) ? r.continue() : r.abort()));
      const page = await ctx.newPage();
      page.setDefaultTimeout(30_000);
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await ctx.close().catch(() => {});
    }
  });
}
